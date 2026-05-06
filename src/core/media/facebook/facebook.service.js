const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const fbUrl = require('./fbUrl');
const hitube = require('./adapters/hitube.adapter');
const snapsave = require('./adapters/snapsave.adapter');
const ytdlp = require('./adapters/ytdlp.adapter');
const logger = require('../../../shared/utils/logger');
const { ValidationError, AppError } = require('../../../shared/utils/errors');

const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const _UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function _sanitizeFilename(text, ext) {
  let clean = (text || 'facebook')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
    .toLowerCase();
  if (!clean) clean = 'facebook';
  clean = clean.slice(0, 60);
  const uid = randomUUID().split('-')[0];
  return `${uid}-${clean}.${ext}`;
}

async function _pipeRemoteToDownloads(remoteUrl, filenameBase, ext, extraHeaders = {}) {
  const res = await fetch(remoteUrl, {
    headers: { 'User-Agent': _UA, ...extraHeaders },
  });
  if (!res.ok || !res.body) {
    throw new AppError(`Remote download HTTP ${res.status}`, 502);
  }
  const filename = _sanitizeFilename(filenameBase, ext);
  const filepath = path.join(DOWNLOAD_DIR, filename);
  const ws = fs.createWriteStream(filepath);
  await pipeline(Readable.fromWeb(res.body), ws);
  const stats = fs.statSync(filepath);
  return {
    filename,
    filepath,
    fileSize: `${Math.round(stats.size / 1024)} KB`,
  };
}

/**
 * Detect the file kind by sniffing magic bytes from the first 16 bytes of
 * the local file. Used to pick a proper extension for the saved download
 * because hitube reports `type: "mp4"` for both photos and videos.
 */
function _sniffKindFromFile(filepath) {
  let fd;
  try {
    fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    const sig = buf.toString('hex');
    if (sig.startsWith('ffd8ff')) return { kind: 'photo', ext: 'jpg' };
    if (sig.startsWith('89504e47')) return { kind: 'photo', ext: 'png' };
    if (sig.includes('66747970')) return { kind: 'video', ext: 'mp4' };
    if (sig.startsWith('47494638')) return { kind: 'photo', ext: 'gif' };
    if (sig.includes('57454250')) return { kind: 'photo', ext: 'webp' };
  } catch {
    // fall through
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
  return { kind: 'unknown', ext: 'bin' };
}

function _renameWithExt(filepath, filename, ext) {
  const dir = path.dirname(filepath);
  const base = filename.replace(/\.[^.]+$/, '');
  const newName = `${base}.${ext}`;
  const newPath = path.join(dir, newName);
  if (newPath !== filepath) {
    fs.renameSync(filepath, newPath);
  }
  return { filename: newName, filepath: newPath };
}

function _formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function _shapeResponse({ kind, title, thumbnail, duration, fileSize, downloadUrl }) {
  const out = {
    type: kind,
    title: title || null,
    thumbnail: thumbnail || null,
    size: fileSize,
    download: downloadUrl,
  };
  if (kind === 'video' && duration) out.duration = duration;
  return out;
}

/**
 * Try snapsave (video adapter) and pipe the result to /downloads/.
 */
async function _viaSnapsave(url, baseUrl) {
  const meta = await snapsave.resolve(url);
  const best = snapsave.pickBest(meta.qualities);
  if (!best) throw new AppError('snapsave: no quality picked', 502);
  const filenameBase = meta.title || 'facebook-video';
  const piped = await _pipeRemoteToDownloads(best.url, filenameBase, 'mp4', {
    Referer: 'https://snapsave.app/',
  });
  // Sniff in case server returned non-mp4
  const sniffed = _sniffKindFromFile(piped.filepath);
  const fixed =
    sniffed.kind === 'video'
      ? piped
      : _renameWithExt(piped.filepath, piped.filename, sniffed.ext === 'bin' ? 'mp4' : sniffed.ext);
  return {
    kind: 'video',
    title: meta.title,
    thumbnail: meta.thumbnail,
    duration: null,
    fileSize: piped.fileSize,
    downloadUrl: `${baseUrl}/downloads/${fixed.filename}`,
  };
}

/**
 * Try hitube (handles both photo + video). hitube reports `type: "mp4"` for
 * everything so we sniff the downloaded file for the real kind.
 */
async function _viaHitube(url, baseUrl, hint) {
  const bundle = await hitube.resolve(url);
  const best = hitube.pickBest(bundle.items);
  if (!best) throw new AppError('hitube: no item picked', 502);
  const downloadUrl = hitube.buildDownloadUrl(best, bundle.sessionid);
  const filenameBase = best.author || best.desc || 'facebook';
  const piped = await _pipeRemoteToDownloads(downloadUrl, filenameBase, 'bin', {
    Referer: `https://${hitube.HITUBE_HOST}/`,
  });
  const sniffed = _sniffKindFromFile(piped.filepath);
  const ext = sniffed.ext === 'bin' ? (hint === 'photo' ? 'jpg' : 'mp4') : sniffed.ext;
  const finalKind =
    sniffed.kind !== 'unknown' ? sniffed.kind : hint === 'photo' ? 'photo' : 'video';
  const fixed = _renameWithExt(piped.filepath, piped.filename, ext);
  return {
    kind: finalKind,
    title: best.desc || best.author || null,
    thumbnail: best.thumb || best.cover || null,
    duration: _formatDuration(best.duration),
    fileSize: piped.fileSize,
    downloadUrl: `${baseUrl}/downloads/${fixed.filename}`,
  };
}

/**
 * Try yt-dlp Facebook extractor (last fallback for video URLs).
 */
async function _viaYtdlp(url, baseUrl) {
  const meta = await ytdlp.resolve(url);
  const best = meta.qualities[0];
  const filenameBase = meta.title || 'facebook-video';
  const piped = await _pipeRemoteToDownloads(best.url, filenameBase, 'mp4');
  return {
    kind: 'video',
    title: meta.title,
    thumbnail: meta.thumbnail,
    duration: _formatDuration(meta.duration),
    fileSize: piped.fileSize,
    downloadUrl: `${baseUrl}/downloads/${piped.filename}`,
  };
}

/**
 * Main entrypoint. Auto-detects URL kind and tries adapters in cascade:
 *   - photo URL : hitube
 *   - video URL : snapsave → yt-dlp → hitube
 *   - post URL  : reject (multi-photo posts are not supported by the upstream
 *                 third-party services we proxy; user must extract a single
 *                 photo URL from the post first)
 *   - unknown   : try hitube as a generic fallback
 */
async function download(url, baseUrl = 'http://localhost:3000') {
  if (!url || typeof url !== 'string') throw new ValidationError('url is required');
  const kind = fbUrl.classify(url);
  if (kind === null) {
    throw new ValidationError(
      'URL is not a Facebook URL. Accepted hosts: facebook.com, fb.com, fb.watch, m.facebook.com.'
    );
  }
  if (kind === 'post') {
    throw new ValidationError(
      'Facebook post URLs (text + multi-photo) are not supported. ' +
        'Open the post, click a single photo, then submit that photo URL instead.'
    );
  }

  const errors = [];
  const tryAdapter = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
      logger.warn(`[facebook:${label}] ${err.message}`);
      return null;
    }
  };

  let result = null;
  if (kind === 'photo') {
    result = await tryAdapter('hitube', () => _viaHitube(url, baseUrl, 'photo'));
  } else if (kind === 'video') {
    result =
      (await tryAdapter('snapsave', () => _viaSnapsave(url, baseUrl))) ||
      (await tryAdapter('ytdlp', () => _viaYtdlp(url, baseUrl))) ||
      (await tryAdapter('hitube', () => _viaHitube(url, baseUrl, 'video')));
  } else {
    // unknown — try hitube generically, then snapsave (might be a video)
    result =
      (await tryAdapter('hitube', () => _viaHitube(url, baseUrl))) ||
      (await tryAdapter('snapsave', () => _viaSnapsave(url, baseUrl)));
  }

  if (!result) {
    throw new AppError(`All Facebook adapters failed: ${errors.join(' | ')}`, 502);
  }
  return _shapeResponse(result);
}

module.exports = {
  download,
  // exposed for tests
  _sanitizeFilename,
  _sniffKindFromFile,
  _formatDuration,
  _shapeResponse,
};
