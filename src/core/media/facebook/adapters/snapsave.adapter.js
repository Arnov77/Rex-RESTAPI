const vm = require('vm');
const { AppError } = require('../../../../shared/utils/errors');

const SNAPSAVE_ENDPOINT = 'https://snapsave.app/action.php?lang=en';

const _UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function _baseHeaders() {
  return {
    'User-Agent': _UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://snapsave.app',
    Referer: 'https://snapsave.app/',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

/**
 * snapsave.app responds with a self-eval'ing packed JS payload of the form
 *   eval(function(h,u,n,t,e,r){...})("...payload...")
 * The packed function decodes and evals an HTML string. Replacing the outer
 * `eval(` with an assignment lets us capture the decoded HTML without running
 * the eval'd HTML's gtag / DOM mutation side-effects.
 */
function _decodeEvalBlob(raw) {
  const idx = raw.indexOf('eval(function');
  if (idx < 0) return null;
  const rewritten =
    raw.slice(0, idx) +
    'globalThis.__SNAPSAVE_OUT = (function' +
    raw.slice(idx + 'eval(function'.length);
  const ctx = {
    globalThis: {},
    Math,
    String,
    RegExp,
    decodeURIComponent,
    escape,
  };
  ctx.global = ctx;
  try {
    vm.createContext(ctx);
    vm.runInContext(rewritten, ctx, { timeout: 2000 });
  } catch {
    return null;
  }
  return typeof ctx.globalThis.__SNAPSAVE_OUT === 'string' ? ctx.globalThis.__SNAPSAVE_OUT : null;
}

function _extractTitleAndThumb(html) {
  const titleMatch = html.match(/<span[^>]*class=\\?"video-des\\?"[^>]*>([\s\S]*?)<\/span>/);
  const thumbMatch = html.match(/<img[^>]+src=\\?"([^"\\]+)\\?"/);
  return {
    title: titleMatch ? titleMatch[1].replace(/\\"/g, '"').trim() : null,
    thumbnail: thumbMatch ? thumbMatch[1].replace(/\\\//g, '/') : null,
  };
}

function _extractQualities(html) {
  // <td class="video-quality">720p (HD)</td>...<a href="...">
  const rowRegex =
    /<td[^>]*class=\\?"video-quality\\?"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<a[^>]+href=\\?"([^"\\]+)\\?"/g;
  const rows = [];
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const labelRaw = m[1].replace(/<[^>]+>/g, '').trim();
    const url = m[2].replace(/\\\//g, '/').replace(/&amp;/g, '&');
    rows.push({ quality: labelRaw, url });
  }
  return rows;
}

function _isHd(quality) {
  return /hd|1080|720/i.test(quality || '');
}

/**
 * Resolve a Facebook video URL via snapsave.app and return parsed metadata
 * plus a list of qualities (HD/SD) with direct download URLs hosted on
 * d.rapidcdn.app. URLs are signed JWTs pointing to fbcdn.net behind the scenes.
 */
async function resolve(url) {
  let res;
  try {
    res = await fetch(SNAPSAVE_ENDPOINT, {
      method: 'POST',
      headers: _baseHeaders(),
      body: `url=${encodeURIComponent(url)}`,
    });
  } catch (err) {
    throw new AppError(`snapsave fetch failed: ${err.message}`, 502);
  }
  if (!res.ok) throw new AppError(`snapsave HTTP ${res.status}`, 502);
  const raw = await res.text();
  const decoded = _decodeEvalBlob(raw);
  if (!decoded) throw new AppError('snapsave: failed to decode payload', 502);
  if (/error|invalid|private/i.test(decoded) && !/download-section/.test(decoded)) {
    throw new AppError('snapsave rejected URL (private / unsupported)', 502);
  }
  const { title, thumbnail } = _extractTitleAndThumb(decoded);
  const qualities = _extractQualities(decoded);
  if (!qualities.length) {
    throw new AppError('snapsave: no download links found', 502);
  }
  return { title, thumbnail, qualities };
}

function pickBest(qualities) {
  if (!Array.isArray(qualities) || !qualities.length) return null;
  const hd = qualities.find((q) => _isHd(q.quality));
  return hd || qualities[0];
}

module.exports = {
  resolve,
  pickBest,
  // exposed for tests
  _decodeEvalBlob,
  _extractTitleAndThumb,
  _extractQualities,
  _isHd,
};
