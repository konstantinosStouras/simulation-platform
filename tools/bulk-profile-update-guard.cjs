const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const completionContext={window:{}};vm.createContext(completionContext);vm.runInContext(fs.readFileSync(__dirname+'/../completions.js','utf8'),completionContext);
const source=fs.readFileSync(__dirname+'/../admin/admin.js','utf8');
const start=source.indexOf('  var profileUpdateBusy = false;'),end=source.indexOf('  function editRegistration(row)',start);
assert.ok(start>=0&&end>start);
const rows=[{uid:'a',name:'Alice',updatedAt:'2026-11-10'},{uid:'b',name:'Bob',updatedAt:'2026-11-10'},{uid:'c',name:'Not selected'}];
let reads=0,calls=[],alerts=[],renders=0;const elements={};
const ctx={P:{firebase:async()=>({listStudents:async()=>rows}),catalog:()=>[{key:'one',title:'One',verify:{adapter:'test'}},{key:'two',title:'Two',verify:{adapter:'test'}}]},
 window:{confirm:()=>true,alert:s=>alerts.push(s),SIMP_VERIFY:{test:async()=>{reads++;return{profileRecords:[]};}},SIMP_PROFILE_UPDATE:{run:async(c,r,p)=>{calls.push([c.sim.key,p.uid]);if(c.sim.key==='one'&&p.uid==='a')throw Error('refused');return{updated:1,skipped:0};}}},
 document:{querySelectorAll:()=>[]},C:completionContext.window.SIMP_COMPLETIONS,simFirestore:async sim=>({sim}),
 $:id=>elements[id]??={},rowCompleted:()=>false,lastRows:rows,renderRoster:()=>renders++};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function uidsOf('),source.indexOf('  function renderRoster('))+source.slice(start,end),ctx);
(async()=>{
await ctx.updatePlayedProfilesBatch(rows.slice(0,2),{});
assert.equal(reads,2,'one scan per simulation, not per user');
assert.deepEqual(calls,[['one','a'],['one','b'],['two','a'],['two','b']]);
assert.ok(!calls.some(c=>c[1]==='c'),'unselected user untouched');
assert.match(alerts[0],/Alice: refused/);assert.match(alerts[0],/Two: 2 record\(s\) updated/);
assert.equal(ctx.profileUpdateBusy,false);assert.equal(renders,1);
ctx.profileUpdateBusy=true;await ctx.updatePlayedProfilesBatch(rows,{});assert.equal(reads,2,'concurrent action blocked');
console.log('PASS: bulk selection isolation, one scan per simulation, failure continuation, progress summary and concurrency guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
