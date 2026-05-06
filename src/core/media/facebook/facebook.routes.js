const express = require('express');
const router = express.Router();
const facebookController = require('./facebook.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./facebook.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/facebook/download:
 *   post:
 *     summary: Download foto atau video dari Facebook
 *     description: |
 *       Download foto atau video Facebook dari URL public. Auto-detect tipe
 *       konten berdasarkan URL:
 *
 *       - Video: `facebook.com/watch?v=...`, `facebook.com/reel/...`,
 *         `facebook.com/share/v/...`, `fb.watch/...`
 *       - Foto: `facebook.com/photo/?fbid=...`, `facebook.com/photo.php?fbid=...`
 *
 *       URL post (`facebook.com/.../posts/...`) yang berisi text + beberapa
 *       foto tidak didukung — buka post, klik salah satu foto, lalu kirim
 *       URL foto tersebut.
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 example: https://www.facebook.com/watch?v=10153231379946729
 *     responses:
 *       200: { description: Facebook media downloaded and link generated }
 *       400: { description: URL is not a Facebook URL, or unsupported post URL }
 *       502: { description: All upstream adapters failed }
 */
router.post(
  '/download',
  validateRequest(schemas.downloadFacebookSchema),
  asyncHandler(facebookController.download)
);

module.exports = router;
