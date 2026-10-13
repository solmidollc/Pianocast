import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{PairingHub,randomCode} from '../src/index.js';
function setup(){
 const data=new Map();let alarm;
 const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),
 transaction:async fn=>fn(storage),getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v;},list:async()=>new Map(data)};
 const hub=new PairingHub({storage,getWebSockets:()=>[]},{});
 const req=(path,body,token,method='POST')=>hub.fetch(new Request('https://pairing.test'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(method==='POST'?{body:JSON.stringify(body ?? {})}:{})}));
 return{data,hub,req};
}
test('generates eight numeric digits including leading zeros',()=>{
 for(let i=0;i<100;i++)assert.match(randomCode(),/^\d{8}$/);
});
test('joins once, rejects unauthorized answers, and cleans completed connection',async()=>{
 const {req}=setup();
 const created=await req('/rooms',{board:'board-a',offer:'0abcdef'});
 assert.equal(created.status,201);const room=await created.json();
 const joined=await req('/rooms/'+room.code+'/join');assert.equal(joined.status,200);
 const guest=await joined.json();assert.equal(guest.board,'board-a');assert.equal(guest.offer,'0abcdef');
 assert.equal((await req('/rooms/'+room.code+'/join')).status,409);
 assert.equal((await req('/rooms/'+room.code+'/answer',{answer:'0xyz'},'wrong')).status,403);
 assert.equal((await req('/rooms/'+room.code+'/answer',{answer:'0xyz'},guest.guestToken)).status,200);
 assert.equal((await req('/rooms/'+room.code+'/answer',{answer:'0xyz'},guest.guestToken)).status,409);
 assert.equal((await req('/rooms/'+room.code,null,'wrong','DELETE')).status,403);
 assert.equal((await req('/rooms/'+room.code,null,room.hostToken,'DELETE')).status,200);
 assert.equal((await req('/rooms/'+room.code+'/join')).status,404);
});
test('expired codes are refused and alarm removes connection metadata',async()=>{
 const {req,data,hub}=setup();const room=await(await req('/rooms',{board:'b',offer:'0abc'})).json();
 data.set('room:'+room.code,{...data.get('room:'+room.code),expires:Date.now()-1});
 assert.equal((await req('/rooms/'+room.code+'/join')).status,404);
 await hub.alarm();assert.equal(data.size,0);
});
test('worker restricts origin, handles preflight and applies attempt limit',async()=>{
 const env={ALLOWED_ORIGIN:'https://solmidollc.github.io',PAIRING_LIMITER:{limit:async()=>({success:false})}};
 assert.equal((await worker.fetch(new Request('https://pairing.test/rooms',{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);
 const good={'Origin':env.ALLOWED_ORIGIN};
 const pre=await worker.fetch(new Request('https://pairing.test/rooms',{method:'OPTIONS',headers:good}),env);
 assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);
 assert.equal((await worker.fetch(new Request('https://pairing.test/rooms',{method:'POST',headers:good}),env)).status,429);
});
