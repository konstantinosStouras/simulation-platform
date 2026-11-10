const {readFileSync}=require('fs');
const vm=require('vm');
const assert=require('assert/strict');
const {webcrypto}=require('crypto');
const A=require('../answers.js');
assert.doesNotMatch(readFileSync(__dirname+'/../admin/admin.js','utf8'), /ctx\.D\.(updateDoc|setDoc|deleteDoc|writeBatch)/, 'Verification must never write to a simulation project');
const docs=new Map(), storage=new Map(), writes=[];
const clone=x=>JSON.parse(JSON.stringify(x));
const snap=key=>({exists:()=>docs.has(key),data:()=>clone(docs.get(key))});
const D={
 getFirestore:()=>({}),doc:(_,p)=>p,
 getDoc:async p=>snap(p),getDocFromServer:async p=>snap(p),
 updateDoc:async(p,v)=>{if(!docs.has(p))throw Error('not-found');writes.push(p);docs.set(p,{...docs.get(p),...clone(v)});},
 writeBatch:()=>{const ops=[];return {
   update:(p,v)=>ops.push(['update',p,v]),set:(p,v)=>ops.push(['set',p,v]),delete:p=>ops.push(['delete',p]),
   commit:async()=>{for(const [op,p]of ops)if(op==='update'&&!docs.has(p))throw Error('not-found');
     for(const [op,p,v]of ops){writes.push(p);if(op==='delete')docs.delete(p);else docs.set(p,{...docs.get(p),...clone(v)});}}
 };}
};
const context={window:{SIMP_FIREBASE_CONFIG:{apiKey:'test',projectId:'platform'},SIMP_ANSWERS:A,SIMP_CATALOG:[{key:'game',path:'/game'}]},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 crypto:webcrypto,TextEncoder,URL,location:{href:'https://example.test/simulation/'},console,
 modules:[{initializeApp:()=>({})},{getAuth:()=>({}),onAuthStateChanged:(_,cb)=>{queueMicrotask(()=>cb({uid:'u1'}));return()=>{};}},D]};
vm.createContext(context);
let source=readFileSync(__dirname+'/../platform.js','utf8');
source=source.replace(/Promise\.all\(\[\s*import\(U \+ 'firebase-app.js'\),\s*import\(U \+ 'firebase-auth.js'\),\s*import\(U \+ 'firebase-firestore.js'\)\s*\]\)/,'Promise.resolve(modules)');
vm.runInContext(source,context);
(async()=>{
 const P=context.window.SimPlatform,F=await P.firebase();
 const p={name:'Original Student',email:'old@example.test',studentId:'123',workExperience:'0'};
 for(const [k,v]of Object.entries(A.sets))p[k]=v[0];
 const original={...p,uid:'u1',approved:true,createdAt:'2026-01-01',updatedAt:'2026-01-01',completed:{game:{ts:123}}};
 docs.set('simPlatformStudents/u1',clone(original));
 const gameRecord={profile:clone(p),answers:{result:42}};
 docs.set('games/session/participant',clone(gameRecord));
 const key=async email=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(email))).toString('hex');
 docs.set('simPlatformRecovery/'+await key(p.email),clone(p));
 await F.editStudents(['u1'],{...p,name:'Updated Student',email:'new@example.test'});
 assert.equal(docs.get('simPlatformStudents/u1').name,'Updated Student');
 assert.equal(docs.get('simPlatformStudents/u1').approved,true);
 assert.equal(docs.get('simPlatformStudents/u1').completed.game.ts,123);
 assert.equal(docs.has('simPlatformRecovery/'+await key(p.email)),false);
 assert.equal(docs.get('simPlatformRecovery/'+await key('new@example.test')).name,'Updated Student');
 const latest=await F.profileForLaunch();assert.equal(latest.name,'Updated Student');assert.equal(latest.approved,undefined);
 P.launch('game','SESSION');const handoff=storage.get(P.KEYS.handoff);
 await F.editStudents(['u1'],{...p,name:'Next Student',email:'new@example.test'});
 assert.equal(storage.get(P.KEYS.handoff),handoff,'editing must not mutate a launched snapshot');
 await F.deleteStudents(['u1']);
 assert.equal(docs.has('simPlatformStudents/u1'),false);
 assert.equal(docs.has('simPlatformRecovery/'+await key('new@example.test')),false);
 assert.deepEqual(docs.get('games/session/participant'),gameRecord);
 assert.equal(storage.get(P.KEYS.handoff),handoff);
 await assert.rejects(()=>F.profileForLaunch(),/approved/);
 await assert.rejects(()=>F.saveCompleted({game:{ts:999}}),/not-found/);
 assert.equal(docs.has('simPlatformStudents/u1'),false);
 assert.ok(writes.every(p=>p.startsWith('simPlatformStudents/')||p.startsWith('simPlatformRecovery/')));
 console.log('PASS: edit, recovery migration, fresh launch, immutable handoff, isolated deletion, and no completion resurrection');
})().catch(e=>{console.error(e);process.exitCode=1;});



