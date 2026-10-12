'use strict';
const { neon } = require('@neondatabase/serverless');

let _sql = null;

function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

module.exports = { getDb };
