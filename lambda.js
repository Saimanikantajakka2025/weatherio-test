const serverlessExpress = require('@codegenie/serverless-express');
const app = require('./app');

// Log once on cold start (masking the URI length only)
const raw = process.env.MONGO_URI || '';
const masked = raw ? `${raw.slice(0, 12)}... (len=${raw.length})` : '(missing)';
console.log('[cold-start] MONGO_URI:', masked);

module.exports.handler = serverlessExpress({ app });
