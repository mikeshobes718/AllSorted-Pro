function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

module.exports = { normalizeEmail };
