// Vitest globals — see vitest.config.js.

const fbUrl = require('../src/core/media/facebook/fbUrl');
const facebookService = require('../src/core/media/facebook/facebook.service');
const hitubeAdapter = require('../src/core/media/facebook/adapters/hitube.adapter');
const snapsaveAdapter = require('../src/core/media/facebook/adapters/snapsave.adapter');

describe('fbUrl.classify', () => {
  it.each([
    ['https://www.facebook.com/watch?v=10153231379946729', 'video'],
    ['https://www.facebook.com/reel/698549445660090', 'video'],
    ['https://www.facebook.com/reels/698549445660090', 'video'],
    ['https://www.facebook.com/share/v/abcDEF/', 'video'],
    ['https://www.facebook.com/share/r/abcDEF/', 'video'],
    ['https://fb.watch/abc123', 'video'],
    ['https://www.facebook.com/zuck/videos/10103154531425531', 'video'],
    ['https://www.facebook.com/photo/?fbid=10153231379946729', 'photo'],
    ['https://www.facebook.com/photo.php?fbid=10153231379946729', 'photo'],
    ['https://www.facebook.com/zuck/photos/10103154531425531', 'photo'],
    ['https://www.facebook.com/zuck/posts/10114296115754811', 'post'],
    ['https://www.facebook.com/share/p/abcDEF/', 'post'],
    ['https://www.facebook.com/some/random/path', 'unknown'],
    ['https://www.youtube.com/watch?v=abc', null],
    ['not a url', null],
    ['', null],
  ])('classify(%s) → %s', (url, expected) => {
    expect(fbUrl.classify(url)).toBe(expected);
  });

  it('isFacebookUrl returns boolean', () => {
    expect(fbUrl.isFacebookUrl('https://www.facebook.com/watch?v=1')).toBe(true);
    expect(fbUrl.isFacebookUrl('https://www.youtube.com/watch?v=1')).toBe(false);
  });
});

describe('facebookService.download URL guards', () => {
  it('rejects empty url', async () => {
    await expect(facebookService.download('')).rejects.toThrow(/url is required/i);
  });

  it('rejects non-Facebook URL', async () => {
    await expect(facebookService.download('https://www.youtube.com/watch?v=abc')).rejects.toThrow(
      /not a Facebook URL/i
    );
  });

  it('rejects post URL (multi-photo not supported)', async () => {
    await expect(
      facebookService.download('https://www.facebook.com/zuck/posts/10114296115754811')
    ).rejects.toThrow(/post URLs.*not supported/i);
  });
});

describe('hitube.adapter helpers', () => {
  it('_xSecureMessage produces 1024-bit RSA ciphertext base64', () => {
    const xs = hitubeAdapter._xSecureMessage();
    expect(typeof xs).toBe('string');
    // 1024-bit RSA → 128-byte ciphertext → ~172-char base64 (with padding)
    expect(xs.length).toBeGreaterThanOrEqual(170);
    expect(xs.length).toBeLessThanOrEqual(176);
    expect(/^[A-Za-z0-9+/=]+$/.test(xs)).toBe(true);
  });

  it('_randomSessionId produces alphanumeric strings of given length', () => {
    const id1 = hitubeAdapter._randomSessionId();
    const id2 = hitubeAdapter._randomSessionId();
    expect(id1).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(id2).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(id1).not.toBe(id2);
  });

  it('pickBest prefers HD over SD', () => {
    const items = [
      { id: 'a', tag: 'SD' },
      { id: 'b', tag: 'HD' },
    ];
    expect(hitubeAdapter.pickBest(items)?.id).toBe('b');
  });

  it('pickBest returns first when no HD', () => {
    const items = [
      { id: 'a', tag: 'SD' },
      { id: 'b', tag: null },
    ];
    expect(hitubeAdapter.pickBest(items)?.id).toBe('a');
  });

  it('pickBest returns null on empty input', () => {
    expect(hitubeAdapter.pickBest([])).toBe(null);
    expect(hitubeAdapter.pickBest(null)).toBe(null);
  });

  it('buildDownloadUrl includes sessionid + wh host', () => {
    const url = hitubeAdapter.buildDownloadUrl({ jwt: 'JWTTOKEN' }, 'sess123');
    expect(url).toContain('JWTTOKEN');
    expect(url).toContain('sessionid=sess123');
    expect(url).toContain('wh=www.hitube.io');
  });
});

describe('snapsave.adapter helpers', () => {
  it('_isHd recognizes HD-tier qualities', () => {
    expect(snapsaveAdapter._isHd('720p (HD)')).toBe(true);
    expect(snapsaveAdapter._isHd('1080p')).toBe(true);
    expect(snapsaveAdapter._isHd('HD')).toBe(true);
    expect(snapsaveAdapter._isHd('SD')).toBe(false);
    expect(snapsaveAdapter._isHd('360p')).toBe(false);
    expect(snapsaveAdapter._isHd('')).toBe(false);
  });

  it('_extractQualities parses quality + url rows', () => {
    const html =
      '<div class="download-section"><table><tr>' +
      '<td class="video-quality">720p (HD)</td>' +
      '<td><a href="https://d.rapidcdn.app/snapsave?token=abc">Download</a></td>' +
      '</tr><tr>' +
      '<td class="video-quality">360p (SD)</td>' +
      '<td><a href="https://d.rapidcdn.app/snapsave?token=def">Download</a></td>' +
      '</tr></table></div>';
    const qs = snapsaveAdapter._extractQualities(html);
    expect(qs).toHaveLength(2);
    expect(qs[0].quality).toBe('720p (HD)');
    expect(qs[0].url).toContain('token=abc');
    expect(qs[1].quality).toBe('360p (SD)');
  });

  it('pickBest prefers HD quality', () => {
    const qs = [
      { quality: 'SD', url: 'http://sd' },
      { quality: '720p (HD)', url: 'http://hd' },
    ];
    expect(snapsaveAdapter.pickBest(qs)?.url).toBe('http://hd');
  });

  it('pickBest returns null on empty', () => {
    expect(snapsaveAdapter.pickBest([])).toBe(null);
    expect(snapsaveAdapter.pickBest(null)).toBe(null);
  });
});

describe('facebook.service helpers', () => {
  it('_formatDuration formats seconds → mm:ss', () => {
    expect(facebookService._formatDuration(0)).toBe(null);
    expect(facebookService._formatDuration(45)).toBe('0:45');
    expect(facebookService._formatDuration(75)).toBe('1:15');
    expect(facebookService._formatDuration(3600)).toBe('60:00');
    expect(facebookService._formatDuration('not a number')).toBe(null);
    expect(facebookService._formatDuration(null)).toBe(null);
  });

  it('_shapeResponse omits duration for photos', () => {
    const out = facebookService._shapeResponse({
      kind: 'photo',
      title: 't',
      thumbnail: null,
      duration: '1:23',
      fileSize: '100 KB',
      downloadUrl: 'http://x/y.jpg',
    });
    expect(out).toEqual({
      type: 'photo',
      title: 't',
      thumbnail: null,
      size: '100 KB',
      download: 'http://x/y.jpg',
    });
    expect(out).not.toHaveProperty('duration');
  });

  it('_shapeResponse keeps duration for videos when present', () => {
    const out = facebookService._shapeResponse({
      kind: 'video',
      title: 't',
      thumbnail: 'http://thumb',
      duration: '1:23',
      fileSize: '5000 KB',
      downloadUrl: 'http://x/y.mp4',
    });
    expect(out.duration).toBe('1:23');
    expect(out.type).toBe('video');
  });

  it('_sanitizeFilename strips unsafe chars + appends ext', () => {
    const name = facebookService._sanitizeFilename('Hello / World: \\ stuff?', 'mp4');
    expect(name).toMatch(/^[a-f0-9]+-hello-world-stuff\.mp4$/);
  });
});
