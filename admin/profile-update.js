/* Explicit admin action only. Verification, editing and deletion never call this writer. */
window.SIMP_PROFILE_UPDATE = (function () {
  'use strict';
  var keys = ['name','email','studentId','age','gender','nationality','country','levelOfStudy','workExperience','occupation','industry','englishFluency'];
  var labels = [
    [/student\s*id|participant\s*id/i,'studentId'], [/e-?mail/i,'email'],
    [/full\s*name|^name$|your\s+name/i,'name'], [/^age\b/i,'age'], [/^gender/i,'gender'],
    [/nationality/i,'nationality'], [/country/i,'country'], [/level\s+of\s+study/i,'levelOfStudy'],
    [/work\s+experience/i,'workExperience'], [/occupation/i,'occupation'], [/industr/i,'industry'], [/english/i,'englishFluency']
  ];
  function norm(x) { return String(x || '').trim().toLowerCase(); }
  function identities(rows) {
    var all = [];
    rows.forEach(function (r) {
      all.push({ studentId:r.studentId, email:r.email });
      var history = r.completed && r.completed.__profileHistory;
      if (history) all = all.concat(history.identities || []);
    });
    return all;
  }
  function matches(record, ids) {
    return ids.some(function (p) {
      return (record.id && norm(record.id) === norm(p.studentId)) ||
        (record.email && norm(record.email) === norm(p.email));
    });
  }
  function fieldKey(f) {
    if (keys.indexOf(f.id) >= 0) return f.id;
    if (f.id === 'ucdStudentId' || f.system === 'participantId') return 'studentId';
    for (var i=0;i<labels.length;i++) if (labels[i][0].test(f.label || f.text || '')) return labels[i][1];
    return null;
  }
  function formPatch(existing, fields, profile, prefix) {
    var patch = {}, byId = {};
    (fields || []).forEach(function (f) { if (f && f.id) byId[f.id] = f; });
    // Only registration fields: never survey responses or game answers.
    Object.keys(existing || {}).forEach(function (id) { if (!byId[id]) byId[id] = {id:id}; });
    Object.keys(byId).forEach(function (id) {
      if (/[.\[\]*/~]/.test(id)) return;
      var f=byId[id], k=fieldKey(f); if (!k || profile[k] == null) return;
      var value=String(profile[k]);
      if (f.type === 'number' || typeof (existing || {})[id] === 'number') value=Number(value);
      if (Array.isArray(f.options) && f.options.length && !f.options.some(function (o) { return String(typeof o === 'object' ? o.value : o) === String(value); })) return;
      patch[prefix+'.'+id]=value;
    });
    return patch;
  }
  function participantPatch(adapter, r, p, fields) {
    var patch = {};
    if (adapter === 'ideasearchlab') {
      keys.forEach(function (k) { patch['platform.'+k]=String(p[k] == null ? '' : p[k]); });
      patch.name=p.name; patch.email=p.email;
      Object.assign(patch,formPatch(r.data.demographics,fields,p,'demographics'));
    } else {
      patch[adapter === 'answerarena' ? 'participantId' : 'studentId']=p.studentId;
      // Keep the existing schema: no new name/email columns where none existed.
      if (r.data.name != null) patch.name=p.name;
      if (r.data.email != null) patch.email=p.email;
      Object.assign(patch,formPatch(r.data.registration,fields,p,'registration'));
    }
    return patch;
  }
  async function fieldsFor(c,r) {
    if (r.fields && Array.isArray(r.fields.fields)) return r.fields.fields;
    if (c.sim.verify.adapter === 'ideasearchlab') return [];
    var ref = r.data.sessionId ? c.D.doc(c.fs,'sessions',String(r.data.sessionId)) : c.D.doc(c.fs,'config','app');
    var snap=await c.D.getDoc(ref), data=snap.exists()?snap.data():{};
    return data.registrationQuestions || (data.config && data.config.registrationQuestions) || [];
  }
  async function searchUpdates(c,r,p) {
    var x=r.data;
    if (!x.run_id || !x.participant_code) throw new Error('Legacy completion lacks run/participant identifiers; no safe update is possible');
    var qs=await c.D.getDocs(c.D.query(c.D.collection(c.fs,'events'),c.D.where('run_id','==',x.run_id)));
    var jobs=[];
    qs.forEach(function(d) {
      var e=d.data(); if (e.participant_code !== x.participant_code) return;
      var patch={pid:p.studentId};
      if (e.event === 'registration' && /^platform_/.test(e.question_id || '')) {
        var key=e.question_id.slice(9); if(keys.indexOf(key)>=0 && p[key]!=null) patch.answer=String(p[key]);
      }
      if (e.event === 'session_end' && e.info) {
        var info; try {info=JSON.parse(e.info);} catch(_) {throw new Error('Cannot safely update malformed session summary');}
        info.pid=p.studentId; patch.info=JSON.stringify(info);
      }
      jobs.push({ref:c.D.doc(c.fs,'events',d.id),patch:patch});
    });
    var ref=c.D.doc(c.fs,'participants',x.run_id+'__'+String(x.participant_code).toUpperCase());
    var snap=await c.D.getDoc(ref);
    if(snap.exists()) jobs.push({ref:ref,patch:{pid:p.studentId}});
    return jobs;
  }
  async function run(c, records, profile, mine, roster) {
    var own=identities(mine), others=identities(roster.filter(function(r){return !mine.some(function(m){return m.uid===r.uid;});}));
    var updated=0, skipped=0, seen={};
    for (var i=0;i<records.length;i++) {
      var r=records[i]; if(!matches(r,own))continue;
      if(matches(r,others)){skipped++;continue;}
      var signature = c.sim.verify.adapter === 'search-v2' ? r.data.run_id+'|'+r.data.participant_code : r.path;
      if(seen[signature])continue;seen[signature]=true;
      var jobs;
      if(c.sim.verify.adapter==='search-v2') jobs=await searchUpdates(c,r,profile);
      else {
        var fields=await fieldsFor(c,r);
        jobs=[{ref:c.D.doc(c.fs,r.path),patch:participantPatch(c.sim.verify.adapter,r,profile,fields)}];
      }
      // Stop and report errors. Never claim a failed or partial batch succeeded.
      try {
        for(var start=0;start<jobs.length;start+=400){
          var batch=c.D.writeBatch(c.fs);
          jobs.slice(start,start+400).forEach(function(j){batch.update(j.ref,j.patch);});
          await batch.commit();
        }
      } catch(e) { throw new Error(updated+' completed record(s) updated before failure; the current record may be partially updated. '+((e&&e.message)||e)); }
      updated++;
    }
    return {updated:updated,skipped:skipped};
  }
  return {run:run, participantPatch:participantPatch, matches:matches, identities:identities};
})();
