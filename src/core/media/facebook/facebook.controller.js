const facebookService = require('./facebook.service');
const ResponseHandler = require('../../../shared/utils/response');

async function download(req, res) {
  const { url } = req.validated;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const data = await facebookService.download(url, baseUrl);
  return ResponseHandler.success(res, data, 'Facebook content fetched successfully', 200);
}

module.exports = { download };
