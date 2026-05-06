const crypto = require('crypto');
const { AppError } = require('../../../../shared/utils/errors');

// Public RSA key pinned in the hitube.io webapp. Used to encrypt a millisecond
// timestamp into the X-Secure-Message header (RSAES-PKCS1-v1_5, 1024-bit).
// Source: https://www.hitube.io/_next/static/chunks/pages/_app-*.js — search
// for `interceptors.request.use`.
const HITUBE_PUB_KEY_B64 =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru' +
  '+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4' +
  'OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaq' +
  'zN08LQIDAQAB';

const HITUBE_BASE = 'https://api.hitube.io';
const HITUBE_HOST = 'www.hitube.io';
const SESSION_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function _pubKeyPem() {
  const lines = HITUBE_PUB_KEY_B64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function _xSecureMessage() {
  const ts = Date.now().toString();
  const enc = crypto.publicEncrypt(
    { key: _pubKeyPem(), padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(ts, 'utf8')
  );
  return enc.toString('base64');
}

function _randomSessionId(n = 10) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += SESSION_ID_CHARS[Math.floor(Math.random() * SESSION_ID_CHARS.length)];
  }
  return s;
}

function _baseHeaders() {
  return {
    Accept: 'application/json, text/plain, */*',
    'X-Secure-Message': _xSecureMessage(),
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Origin: `https://${HITUBE_HOST}`,
    Referer: `https://${HITUBE_HOST}/`,
  };
}

/**
 * Resolve a Facebook URL via hitube's `st-tik-video/fb/dl` endpoint and return
 * the parsed bundle plus a builder for the actual file URL. hitube returns the
 * same shape for both photo and video URLs — a `fbBos` array with one item per
 * available rendition (HD/SD).
 */
async function resolve(url) {
  const sessionid = _randomSessionId();
  const apiUrl = `${HITUBE_BASE}/st-tik-video/fb/dl?url=${encodeURIComponent(url)}&sessionid=${sessionid}`;
  let res;
  try {
    res = await fetch(apiUrl, { headers: _baseHeaders() });
  } catch (err) {
    throw new AppError(`hitube.io fetch failed: ${err.message}`, 502);
  }
  if (!res.ok) {
    throw new AppError(`hitube.io HTTP ${res.status}`, 502);
  }
  let payload;
  try {
    payload = await res.json();
  } catch (err) {
    throw new AppError(`hitube.io invalid JSON: ${err.message}`, 502);
  }
  if (payload.code !== 200 || payload.msg !== 'OK' || !payload.result) {
    throw new AppError(`hitube.io upstream rejected URL (msg=${payload.msg || 'unknown'})`, 502);
  }
  const bos = Array.isArray(payload.result.fbBos) ? payload.result.fbBos : [];
  if (!bos.length) {
    throw new AppError('hitube.io returned no media items', 502);
  }
  return {
    sessionid,
    items: bos.map((b) => ({
      id: b.id,
      jwt: b.url,
      tag: b.tag || null,
      hintedType: b.type || null,
      cover: b.cover || null,
      thumb: b.thumb || null,
      author: b.author || null,
      desc: b.desc || null,
      duration: b.duration || null,
    })),
    multiple: !!payload.result.multiple,
    count: payload.result.count || bos.length,
  };
}

/**
 * Build the binary download URL for a given fbBos item. The token endpoint
 * returns `application/octet-stream` (the file body) directly — no further
 * redirects.
 */
function buildDownloadUrl(item, sessionid) {
  return (
    `${HITUBE_BASE}/st-tik-video/token/${item.jwt}` + `?sessionid=${sessionid}&wh=${HITUBE_HOST}`
  );
}

/**
 * Pick the best rendition. Prefer HD over SD; fall back to the first item.
 */
function pickBest(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const hd = items.find((i) => /hd/i.test(i.tag || ''));
  return hd || items[0];
}

module.exports = {
  resolve,
  buildDownloadUrl,
  pickBest,
  // exposed for tests
  _xSecureMessage,
  _randomSessionId,
  _baseHeaders,
  HITUBE_BASE,
  HITUBE_HOST,
};
