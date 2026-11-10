const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../admin/profile-update.js','utf8'),ctx);
const U=ctx.window.SIMP_PROFILE_UPDATE;
const p={uid:'u',name:'Corrected Name',email:'new@example.test',studentId:'NEW',age:'35-44',workExperience:'5',gender:'Female',completed:{__profileHistory:{metadata:true,identities:[{studentId:'OLD',email:'old@example.test'}]}}};
const old={name:'Old',email:'old@example.test',platform:{studentId:'OLD'},demographics:{ucdStudentId:'OLD',age:'25-34',workExperience:2,customAnswer:'keep'},status:'done',surveyAnswers:{score:7},votedFor:['idea'],joinedAt:123};
const clone=x=>JSON.parse(JSON.stringify(x));
let docs=new Map(),writes=[];
function apply(patch,obj){for(const[k,v]of Object.entries(patch)){const a=k.split('.');let x=obj;for(const key of a.slice(0,-1)){x[key]??={};x=x[key];}x[a.at(-1)]=v;}}
const D={doc:(_, ...a)=>a.join('/'),collection:(_, ...a)=>a.join('/'),where:(...a)=>a,query:(...a)=>a,
getDoc:async ref=>({exists:()=>docs.has(ref),data:()=>clone(docs.get(ref))}),
getDocs:async()=>({forEach:cb=>{for(const[path,data]of docs)if(path.startsWith('events/'))cb({id:path.slice(7),data:()=>clone(data)});}}),
writeBatch:()=>{let ops=[];return{update:(ref,patch)=>ops.push({ref,patch}),commit:async()=>{for(const op of ops){assert.ok(docs.has(op.ref));apply(op.patch,docs.get(op.ref));writes.push(op);}}};}};
const c=adapter=>({D,fs:{},sim:{verify:{adapter}}});
(async()=>{
docs.set('sessions/s/participants/u',clone(old));
let r={path:'sessions/s/participants/u',data:clone(old),id:'old',email:'old@example.test'};
let out=await U.run(c('ideasearchlab'),[r],p,[p],[p]);assert.equal(out.updated,1);
let updated=docs.get(r.path);assert.equal(updated.platform.studentId,'NEW');assert.equal(updated.demographics.ucdStudentId,'NEW');assert.equal(updated.demographics.workExperience,5);assert.equal(updated.demographics.customAnswer,'keep');
assert.deepEqual(updated.surveyAnswers,old.surveyAnswers);assert.deepEqual(updated.votedFor,old.votedFor);assert.equal(updated.joinedAt,123);
docs.set(r.path,clone(old));writes=[];
out=await U.run(c('ideasearchlab'),[r],p,[p],[p,{uid:'other',studentId:'OLD'}]);assert.equal(out.skipped,1);assert.equal(writes.length,0);
for(const adapter of ['answerarena','portfoliofit']){
const data={studentId:'OLD',participantId:'OLD',registration:{age:'25-34',workExperience:2,unrelated:'keep'},status:'done',scores:[3,9],updatedAt:123};
docs.set('participants/u',clone(data));
out=await U.run(c(adapter),[{path:'participants/u',id:'old',email:'',data}],p,[p],[p]);assert.equal(out.updated,1);
updated=docs.get('participants/u');assert.deepEqual(updated.scores,data.scores);assert.equal(updated.updatedAt,123);assert.equal(updated.registration.unrelated,'keep');assert.equal(updated.registration.workExperience,5);
}
docs=new Map([
['events/a',{run_id:'run',participant_code:'P',pid:'OLD',event:'registration',question_id:'platform_age',answer:'25-34',t:10}],
['events/b',{run_id:'run',participant_code:'P',pid:'OLD',event:'session_end',info:JSON.stringify({pid:'OLD',total_score:40,wall_clock_ms:50}),t:20}],
['events/c',{run_id:'run',participant_code:'OTHER',pid:'OTHER',event:'session_end',t:30}],
['participants/run__P',{pid:'OLD',total_score:40}]
]);
out=await U.run(c('search-v2'),[{path:'events/b',id:'old',data:clone(docs.get('events/b'))}],p,[p],[p]);assert.equal(out.updated,1);
assert.equal(docs.get('events/a').answer,'35-44');assert.equal(docs.get('events/a').pid,'NEW');assert.equal(docs.get('events/a').t,10);
assert.equal(JSON.parse(docs.get('events/b').info).total_score,40);assert.equal(docs.get('events/c').pid,'OTHER');assert.equal(docs.get('participants/run__P').total_score,40);
console.log('PASS: explicit update supports four adapters, historical identity matching, ambiguous-match refusal, and preserves gameplay/scores/timestamps');
})().catch(e=>{console.error(e);process.exitCode=1;});
