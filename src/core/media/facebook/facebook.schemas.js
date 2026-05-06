const Joi = require('joi');

const downloadFacebookSchema = Joi.object({
  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(500)
    .required()
    .messages({
      'string.uri': 'url must be a valid http(s) URL',
      'any.required': 'url is required',
    }),
});

module.exports = { downloadFacebookSchema };
