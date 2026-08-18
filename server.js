const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

async function safeCalendarUrl(input) {
  const normalized = String(input || '').trim().replace(/^webcal:\/\//i, 'https://');
  const url = new URL(normalized);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('http(s) 캘린더 주소만 사용할 수 있어요.');
  if (url.username || url.password) throw new Error('인증 정보가 포함된 주소는 사용할 수 없어요.');
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) throw new Error('내부 네트워크 주소는 불러올 수 없어요.');
  return url;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20_000) req.destroy();
    });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('요청 형식이 올바르지 않아요.')); } });
    req.on('error', reject);
  });
}

async function proxyCalendar(req, res) {
  try {
    const { url: input } = await readJson(req);
    const url = await safeCalendarUrl(input);
    const response = await fetch(url, { headers: { 'user-agent': 'iCampus-Today/1.0', accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`학교 서버가 응답하지 않았어요 (${response.status}).`);
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error('캘린더 파일이 너무 커요.');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('캘린더 피드 형식(ICS)이 아니에요.');
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || '캘린더를 불러오지 못했어요.' }));
  }
}

async function handler(req, res) {
  if (req.method === 'POST' && req.url === '/api/calendar') return proxyCalendar(req, res);
  const pathname = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// Vercel imports this file and invokes the exported request handler. Opening a
// listening socket while it is being imported makes the serverless function
// crash. Only create the local HTTP server when this file is run directly.
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`iCampus Today: http://localhost:${PORT}`);
  });
}

module.exports = handler;
