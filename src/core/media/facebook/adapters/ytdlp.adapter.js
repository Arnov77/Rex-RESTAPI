const youtubedl = require('youtube-dl-exec');
const { AppError } = require('../../../../shared/utils/errors');

/**
 * Resolve a Facebook video URL via yt-dlp's facebook extractor. Used as a last
 * fallback when third-party scrapers (snapsave, hitube) are unavailable. Only
 * works for `/watch?v=` URLs reliably; reels often need cookies.
 */
async function resolve(url) {
  let info;
  try {
    info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      addHeader: ['user-agent:Mozilla/5.0'],
    });
  } catch (err) {
    throw new AppError(`yt-dlp failed: ${err.message || err.stderr || 'unknown'}`, 502);
  }
  if (!info) throw new AppError('yt-dlp returned no info', 502);

  const formats = Array.isArray(info.formats) ? info.formats : [];
  const playable = formats.filter((f) => f.url && (f.vcodec !== 'none' || f.ext === 'mp4'));
  const sorted = playable.sort(
    (a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0)
  );
  const best = sorted[0] || (info.url ? { url: info.url, height: null } : null);
  if (!best || !best.url) throw new AppError('yt-dlp: no playable format', 502);

  return {
    title: info.title || null,
    thumbnail: info.thumbnail || null,
    duration: info.duration || null,
    qualities: [
      {
        quality: best.height ? `${best.height}p` : 'best',
        url: best.url,
      },
    ],
  };
}

module.exports = { resolve };
