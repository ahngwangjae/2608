const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }

  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

async function safeCalendarUrl(input) {
  const normalized = String(input || '').trim().replace(/^webcal:\/\//i, 'https://');
  const url = new URL(normalized);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('http(s) 캘린더 주소만 사용할 수 있어요.');
  }
  if (url.username || url.password) {
    throw new Error('인증 정보가 포함된 주소는 사용할 수 없어요.');
  }

  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) {
    throw new Error('내부 네트워크 주소는 불러올 수 없어요.');
  }

  return url;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 사용할 수 있어요.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const url = await safeCalendarUrl(body.url);
    const response = await fetch(url, {
      headers: {
        'user-agent': 'iCampus-Today/1.0',
        accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.5'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`학교 서버가 응답하지 않아요 (${response.status}).`);
    }

    const text = await response.text();
    if (text.length > 5_000_000) throw new Error('캘린더 파일이 너무 커요.');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('캘린더 형식(ICS)이 아니에요.');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);
  } catch (error) {
    return res.status(400).json({ error: error.message || '캘린더를 불러오지 못했어요.' });
  }
};
