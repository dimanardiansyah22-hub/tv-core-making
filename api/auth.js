/*
 * Validasi password login di sisi server.
 *
 * Password TIDAK disimpan di source code. Nilainya dibaca dari Environment
 * Variable Vercel:
 *   ADMIN_PIN       -> PIN untuk mode admin
 *   GUEST_PASSWORD  -> password untuk mode guest
 *   AUTH_SECRET     -> kunci HMAC untuk menandatangani token sesi
 *
 * Client hanya menerima token + masa berlaku, bukan password.
 */

const crypto = require('crypto');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const attempts = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

/* Perbandingan waktu-konstan: hash dulu agar panjang buffer selalu sama. */
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function clientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
  return String(raw).split(',')[0].trim() || 'unknown';
}

/* Pembatasan percobaan sederhana per IP (per instance function). */
function rateLimited(ip) {
  const now = Date.now();
  if (attempts.size > 5000) {
    attempts.forEach(function (rec, key) {
      if (now - rec.ts > WINDOW_MS) attempts.delete(key);
    });
  }
  const rec = attempts.get(ip);
  if (!rec || now - rec.ts > WINDOW_MS) {
    attempts.set(ip, { count: 1, ts: now });
    return false;
  }
  rec.count += 1;
  rec.ts = now;
  return rec.count > MAX_ATTEMPTS;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};

  const role = body.role === 'admin' ? 'admin' : 'guest';
  const password = String(body.password || '');
  const expected = role === 'admin' ? process.env.ADMIN_PIN : process.env.GUEST_PASSWORD;
  const secret = process.env.AUTH_SECRET;

  if (!expected || !secret) {
    res.status(500).json({ ok: false, error: 'Konfigurasi login belum diset' });
    return;
  }
  if (!password || !safeEqual(password, expected)) {
    res.status(401).json({ ok: false, error: 'Password salah' });
    return;
  }

  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = role + '.' + exp;
  const token = payload + '.' + sign(payload, secret);

  attempts.delete(ip);
  res.status(200).json({ ok: true, role: role, token: token, exp: exp });
};
