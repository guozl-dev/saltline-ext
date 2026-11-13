/* =====================================================================
 * SLX Relay Server v2.0 —— saltline-ext 影式协作中继服务器
 * 零依赖（仅 Node 内置模块）：HTTP 健康检查 + RFC6455 WebSocket 中继。
 * 职责：房间登记 / 播发玩家状态 / 断线清理 / 重连回归（同房间同名同槽位）。
 * 不做权威模拟：敌人与中继目标由各客户端本地模拟（影式协作）。
 * 启动：node server/index.js   （环境变量 PORT，默认 8787）
 * ===================================================================== */
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8787);
const WS_GUID = '258EAFA5-E914-37DA-C3AF-6C7E4D8586F7';
const MEMBER_TTL = 15000;   // 断线成员保留时长（期间可重连回归）
const ROOM_TTL = 10 * 60e3; // 空房回收时长

/* ---------------- 房间登记 ---------------- */
const rooms = new Map(); // code -> { seed, createdAt, members: Map<id, {name, ws, last, deadAt}> }
function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.random() * A.length | 0]).join(''); }
  while (rooms.has(c));
  return c;
}
function roomOf(code) { return rooms.get(String(code || '').toUpperCase()); }
function memberByName(room, name) {
  for (const m of room.members.values()) if (m.name === name) return m;
  return null;
}

/* ---------------- WebSocket 最小实现（服务端帧不掩码，客户端帧解码掩码） ---------------- */
function wsAccept(key) { return crypto.createHash('sha1').update(key + WS_GUID).digest('base64'); }
function encodeText(str) {
  const p = Buffer.from(str, 'utf8');
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([h, p]);
}
function send(ws, obj) { if (ws && ws.writable) { try { ws.write(encodeText(JSON.stringify(obj))); } catch { } } }
function sendMember(m, obj) { if (m.send) m.send(obj); }
function sendRoom(room, obj, exceptId) {
  for (const m of room.members.values()) if (m.id !== exceptId && m.send) m.send(obj);
}

const server = http.createServer((req, res) => {
  /* 兼作静态文件服务器：新版 Edge/Chrome 的本地网络保护（LNA）会拦截
     file:// 页面对 ws://localhost 的连接，因此联机玩家须经 http://127.0.0.1:PORT 进入，
     同源页面发起的 WebSocket 不受限制。 */
  const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const root = path.join(__dirname, '..');
  let file = urlPath === '/' ? '/index.html' : urlPath;
  const full = path.normalize(path.join(root, file));
  if (!full.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  /* ---- 联机 HTTP 通道（WS 被代理/LNA 拦截时的回退）---- */
  if (urlPath === '/net-stream') {
    const name = String(qs.get('name') || '玩家').slice(0, 12);
    const seed = Number(qs.get('seed')) || 4207;
    const roomParam = String(qs.get('room') || '').toUpperCase();
    let code = roomParam, room = roomOf(code);
    if (!room) {
      code = roomParam || makeCode();
      room = { seed, createdAt: Date.now(), members: new Map() };
      rooms.set(code, room);
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(':ok\n\n');
    const me = { name, send: o => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch { } }, last: null, deadAt: null, close: () => { try { res.end(); } catch { } } };
    joinRoom(me, code, room, { t: roomParam ? 'join' : 'create', seed });
    req.on('close', () => { dropMember(room, me, true); sendRoom(room, { t: 'leave', id: me.id }); });
    return;
  }
  if (urlPath === '/net-post') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const room = roomOf(j.room);
        if (!room) { res.writeHead(404); res.end('no room'); return; }
        const me = memberByName(room, String(j.name || ''));
        if (!me) { res.writeHead(403); res.end('not in room'); return; }
        handleMessage(me, j.payload || {});
        res.writeHead(204); res.end();
      } catch (e) { res.writeHead(400); res.end('bad'); }
    });
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(full).toLowerCase();
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.css': 'text/css' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  console.log('[relay][dbg] upgrade key=' + JSON.stringify(key) + ' accept=' + wsAccept(key));
  socket.write('HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
    + 'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n');
  socket.setNoDelay(true);

  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (; ; ) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < off + 2) return; len = buf.readUInt16BE(off); off += 2; }
      else if (len === 127) { if (buf.length < off + 8) return; len = Number(buf.readBigUInt64BE(off)); off += 8; }
      const maskKey = masked ? buf.slice(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (masked) { for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3]; }
      buf = buf.slice(off + len);
      if (op === 8) { socket.end(); return; }
      if (op === 9) { socket.write(pongFrame(payload)); continue; }
      if (op === 1) {
        try { onMessage(socket, JSON.parse(payload.toString('utf8'))); } catch (e) { console.error('[relay] bad message', e.message); }
      }
    }
  });
  socket.on('error', () => { });
  socket.on('close', () => onSocketClose(socket));
});
function pongFrame(payload) { const h = Buffer.from([0x8a, payload.length]); return Buffer.concat([h, payload]); }

/* ---------------- 消息处理 ---------------- */
const wsMap = new Map(); // ws -> member
function onMessage(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'create') {
    const code = makeCode();
    const room = { seed: Number(m.seed) || 4207, createdAt: Date.now(), members: new Map() };
    rooms.set(code, room);
    const me = { name: String(m.name || '玩家'), send: o => send(ws, o), last: null, deadAt: null };
    wsMap.set(ws, me);
    joinRoom(me, code, room, m);
    return;
  }
  if (m.t === 'join') {
    const room = roomOf(m.room);
    if (!room) { send(ws, { t: 'err', msg: '房间不存在' }); return; }
    const me = { name: String(m.name || '玩家'), send: o => send(ws, o), last: null, deadAt: null };
    wsMap.set(ws, me);
    joinRoom(me, m.room.toUpperCase(), room, m);
    return;
  }
  const me = wsMap.get(ws);
  if (!me) return;
  if (m.t === 'leave') { dropMember(me.room, me, true); sendRoom(me.room, { t: 'leave', id: me.id }); ws.close(); return; }
  handleMessage(me, m);
}
function joinRoom(me, code, room, joinMsg) {
  // 重连回归：同房间同名 → 复用原槽位（换通道重绑发送函数）
  const existing = memberByName(room, me.name);
  if (existing && existing !== me) {
    existing.send = me.send; existing.deadAt = null;
    me = existing;
    sendMember(me, { t: 'joined', code, id: me.id, name: me.name, seed: room.seed, rejoin: true, players: snapshot(room) });
    sendRoom(room, { t: 'rejoin', id: me.id, name: me.name }, me.id);
    return me;
  }
  const id = [...room.members.keys()].reduce((a, b) => Math.max(a, b), 0) + 1;
  me.id = id; me.room = room; me.code = code;
  room.members.set(id, me);
  const seed = Number(joinMsg.seed) || room.seed;
  if (joinMsg.t === 'create') room.seed = seed;
  sendMember(me, { t: 'joined', code, id, name: me.name, seed: room.seed, players: snapshot(room) });
  sendRoom(room, { t: 'peerjoin', id, name: me.name }, me.id);
  return me;
}
function snapshot(room) {
  const arr = [];
  for (const m of room.members.values()) arr.push({ id: m.id, name: m.name, last: m.last });
  return arr;
}
/* 通道无关的消息处理（ws 与 SSE/POST 共用） */
function handleMessage(me, m) {
  if (!m || typeof m.t !== 'string') return;
  const room = me.room;
  if (m.t === 's') { // 玩家状态：登记最新值并转发给同房其他成员
    me.last = m;
    me.deadAt = null;
    sendRoom(room, { t: 'p', id: me.id, name: me.name, p: m.p, yaw: m.yaw, hp: m.hp, al: m.al, wn: m.wn, am: m.am }, me.id);
    return;
  }
  if (m.t === 'leave') { dropMember(room, me, true); sendRoom(room, { t: 'leave', id: me.id }); if (me.close) me.close(); return; }
  if (m.t === 'x') { // 轻量播报（击杀等）
    sendRoom(room, { t: 'x', id: me.id, name: me.name, msg: String(m.msg || '').slice(0, 60) }, me.id);
    return;
  }
}
function dropMember(room, me, manual) {
  if (manual) { room.members.delete(me.id); wsMap.delete(me.ws); }
  else { me.ws = null; me.deadAt = Date.now(); }
}
function onSocketClose(ws) {
  const me = wsMap.get(ws);
  if (!me) return;
  wsMap.delete(ws);
  if (me.ws === ws) me.ws = null;
  me.deadAt = Date.now();
  sendRoom(me.room, { t: 'dc', id: me.id });
}

/* ---------------- 清理循环 ---------------- */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const [id, m] of room.members) {
      if (!m.ws && m.deadAt && now - m.deadAt > MEMBER_TTL) {
        room.members.delete(id);
        sendRoom(room, { t: 'leave', id });
      }
    }
    if (room.members.size === 0 && now - room.createdAt > ROOM_TTL) rooms.delete(code);
  }
  console.log('[relay] rooms=' + rooms.size + ' members=' + [...rooms.values()].reduce((a, r) => a + r.members.size, 0));
}, 10000);

server.listen(PORT, () => console.log('[relay] SLX relay listening on ws://0.0.0.0:' + PORT));
