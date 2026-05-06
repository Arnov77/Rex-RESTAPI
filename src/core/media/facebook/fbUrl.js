const FB_HOSTS = new Set(['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com']);

/**
 * Classify a Facebook URL into a content kind. Returns one of:
 *   - 'video'  : watch / reel / share/v / fb.watch / /videos/...
 *   - 'photo'  : photo.php / /photo/?fbid= / /photos/...
 *   - 'post'   : /posts/... / /share/p/...
 *   - 'unknown': belongs to a Facebook host but path is not classifiable
 *   - null     : not a Facebook URL
 */
function classify(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  if (!FB_HOSTS.has(host)) return null;

  if (host === 'fb.watch') return 'video';

  const path = u.pathname.toLowerCase();
  if (path.startsWith('/watch')) return 'video';
  if (path.startsWith('/reel/') || path.startsWith('/reels/')) return 'video';
  if (/^\/share\/(v|r)\//.test(path)) return 'video';
  if (/\/videos?\//.test(path)) return 'video';

  if (path === '/photo' || path === '/photo/' || path === '/photo.php') return 'photo';
  if (/\/photos?\//.test(path)) return 'photo';
  if (path === '/' && u.searchParams.has('fbid')) return 'photo';

  if (/\/posts\//.test(path)) return 'post';
  if (/^\/share\/p\//.test(path)) return 'post';

  return 'unknown';
}

function isFacebookUrl(url) {
  return classify(url) !== null;
}

module.exports = { classify, isFacebookUrl, FB_HOSTS };
