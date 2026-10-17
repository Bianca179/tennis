// Coach App — Netlify Function: speech-to-text for the mic button in the chat.
// The audio is forwarded to OpenAI's transcription API and never stored or logged.
//
// GET  → { enabled: true|false }  (the app falls back to the browser's own recognizer when false)
// POST { audio: <base64>, mime: "audio/mp4", lang: "en"|"de"|"fr" } → { text }
//
// Environment variables (Netlify → Site settings → Environment):
//   OPENAI_API_KEY   (optional)  enables server transcription (whisper-1, about $0.006 per minute)
//   ALLOWED_ORIGINS  (optional)  same as chat.js

const DAILY_LIMIT = 120;          // recordings per IP per day (abuse backstop, resets on cold start)
const MAX_B64 = 4 * 1024 * 1024;  // ~3 MB of audio, far more than the app's 60-second cap
const hits = new Map();

function rateOk(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = hits.get(ip);
  if (!rec || rec.day !== day) { hits.set(ip, { day, count: 1 }); return true; }
  if (rec.count >= DAILY_LIMIT) return false;
  rec.count++;
  return true;
}

function originAllowed(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  if (!origin) return false;
  return allowed.includes(origin);
}

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

exports.handler = async function (event) {
  const key = process.env.OPENAI_API_KEY;
  if (event.httpMethod === 'GET') return json(200, { enabled: !!key });
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const origin = event.headers.origin || event.headers.Origin || '';
  if (!originAllowed(origin)) return json(403, { error: 'origin_not_allowed' });
  if (!key) return json(503, { error: 'not_configured' });

  const ip = event.headers['x-nf-client-connection-ip']
    || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!rateOk(ip)) return json(429, { error: 'rate_limited' });

  try {
    const { audio, mime, lang } = JSON.parse(event.body || '{}');
    if (typeof audio !== 'string' || !audio || audio.length > MAX_B64) return json(400, { error: 'bad_audio' });
    const type = /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(mime || '') ? mime : 'audio/mp4';
    const ext = /webm/i.test(type) ? 'webm' : /ogg/i.test(type) ? 'ogg' : /wav/i.test(type) ? 'wav' : 'mp4';

    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: type.split(';')[0] }), 'speech.' + ext);
    form.append('model', 'whisper-1');
    if (['en', 'de', 'fr'].includes(lang)) form.append('language', lang);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
    });
    if (!res.ok) {
      console.error('transcription status:', res.status);
      return json(502, { error: 'upstream_error' });
    }
    const data = await res.json();
    return json(200, { text: String(data.text || '').trim() });
  } catch (err) {
    console.error('transcribe error:', err.message);
    return json(500, { error: 'server_error' });
  }
};
