const TTL = 10 * 60 * 1000;
const MAX_BODY = 24000;
const json = (value, status = 200) => Response.json(value, {status,headers:{'Cache-Control':'no-store'}});
const error = (message,status=400) => json({error:message},status);
const validCode = code => /^\d{8}$/.test(code);
const validOffer = text => typeof text === 'string' && /^[01][A-Za-z0-9_-]+$/.test(text) && text.length <= 16000;
export function randomCode() {
  const max = Math.floor(0x100000000 / 100000000) * 100000000;
  let value; do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= max);
  return String(value % 100000000).padStart(8,'0');
}
export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if(url.pathname === '/health' && request.method === 'GET') return json({ok:true,service:'PianoCanva pairing',version:1});
    const origin=request.headers.get('Origin');
    if(origin !== env.ALLOWED_ORIGIN) return error('Origin not allowed.',403);
    const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, DELETE, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Vary':'Origin','Cache-Control':'no-store'};
    if(request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
    if(!await env.PAIRING_LIMITER.limit({key:'pairing:'+request.headers.get('CF-Connecting-IP')}).then(r=>r.success))
      return new Response(JSON.stringify({error:'Too many attempts. Wait a minute and try again.'}),{status:429,headers:{...cors,'Content-Type':'application/json','Retry-After':'60'}});
    let forwarded=request;
    if(request.method === 'POST') {
      if(Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return new Response('Request too large',{status:413,headers:cors});
      const text=await request.text();
      if(text.length > MAX_BODY) return new Response('Request too large',{status:413,headers:cors});
      forwarded=new Request(request,{body:text});
    }
    const response=await env.PAIRING_HUB.getByName('piano-canva-pairing-v1').fetch(forwarded);
    if(response.status === 101) return response;
    const headers=new Headers(response.headers);for(const [name,value] of Object.entries(cors))headers.set(name,value);
    return new Response(response.body,{status:response.status,headers});
  }
};
export class PairingHub {
  constructor(ctx,env) {this.ctx=ctx;this.env=env;}
  async fetch(request) {
    const url=new URL(request.url);
    const store=this.ctx.storage;
    if(url.pathname === '/rooms' && request.method === 'POST') {
      let body;try{body=await request.json();}catch{return error('Invalid request.');}
      if(!validOffer(body.offer) || typeof body.board!=='string' || !body.board || body.board.length>80)return error('Invalid connection details.');
      const code=await store.transaction(async tx=>{
        for(let i=0;i<8;i++) {
          const code=randomCode(),key='room:'+code;
          const old=await tx.get(key);
          if(old && old.expires>Date.now())continue;
          const room={code,offer:body.offer,board:body.board,hostToken:crypto.randomUUID(),expires:Date.now()+TTL};
          await tx.put(key,room);return room;
        }
      });
      if(!code)return error('Could not create a code. Try again.',503);
      const alarm=await store.getAlarm();
      if(!alarm || alarm>code.expires)await store.setAlarm(code.expires);
      return json({code:code.code,hostToken:code.hostToken,expires:code.expires},201);
    }
    const match=url.pathname.match(/^\/rooms\/(\d{8})(?:\/(join|answer|socket))?$/);
    if(!match || !validCode(match[1]))return error('Not found.',404);
    const code=match[1],kind=match[2],key='room:'+code;
    if(kind==='join' && request.method==='POST') {
      return store.transaction(async tx=>{
        const room=await tx.get(key);
        if(!room || room.expires<=Date.now())return error('Code expired or not found. Create a new code in PianoCanva.',404);
        if(room.guestToken)return error('This code has already been used. Create a new code.',409);
        room.guestToken=crypto.randomUUID();await tx.put(key,room);
        return json({offer:room.offer,board:room.board,guestToken:room.guestToken,expires:room.expires});
      });
    }
    const room=await store.get(key);
    if(!room || room.expires<=Date.now())return error('Code expired or not found. Create a new code.',404);
    if(kind==='socket' && request.method==='GET') {
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return error('WebSocket required.',426);
      if(url.searchParams.get('token')!==room.hostToken)return error('Not authorized.',403);
      for(const socket of this.ctx.getWebSockets(code))socket.close(1000,'Replaced by desktop connection');
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);
      this.ctx.acceptWebSocket(server,[code]);server.serializeAttachment({code});
      if(room.answer)server.send(JSON.stringify({type:'answer',answer:room.answer}));
      return new Response(null,{status:101,webSocket:client});
    }
    const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
    if(kind==='answer' && request.method==='POST') {
      if(!room.guestToken || token!==room.guestToken)return error('Not authorized.',403);
      let body;try{body=await request.json();}catch{return error('Invalid answer.');}
      if(!validOffer(body.answer))return error('Invalid connection answer.');
      const accepted=await store.transaction(async tx=>{
        const current=await tx.get(key);
        if(!current || current.expires<=Date.now() || current.answer || current.guestToken!==token)return false;
        current.answer=body.answer;await tx.put(key,current);return true;
      });
      if(!accepted)return error('This connection has expired or was already completed.',409);
      for(const socket of this.ctx.getWebSockets(code))try{socket.send(JSON.stringify({type:'answer',answer:body.answer}));}catch{}
      return json({ok:true});
    }
    if(!kind && request.method==='DELETE') {
      if(token!==room.hostToken)return error('Not authorized.',403);
      await store.delete(key);
      for(const socket of this.ctx.getWebSockets(code))socket.close(1000,'Pairing completed');
      return json({ok:true});
    }
    return error('Not found.',404);
  }
  webSocketMessage(socket) { socket.close(1008,'This channel only sends connection answers.'); }
  webSocketError(socket) {try{socket.close(1011,'Connection error');}catch{}}
  webSocketClose() {}
  async alarm() {
    const rooms=await this.ctx.storage.list({prefix:'room:'});
    let next=Infinity;
    for(const [key,room] of rooms) {
      if(room.expires<=Date.now()) {
        await this.ctx.storage.delete(key);
        for(const socket of this.ctx.getWebSockets(room.code))socket.close(1000,'Code expired');
      } else next=Math.min(next,room.expires);
    }
    if(Number.isFinite(next))await this.ctx.storage.setAlarm(next);
  }
}
