const test = require('node:test');
const assert = require('node:assert/strict');
require('../helpers/boot'); // sets QBO_ENCRYPTION_KEY before database.js loads
const { __encryptToken, __decryptToken } = require('../../database');

test('encryptToken / decryptToken round-trip', async (t) => {
  await t.test('produces a v1-prefixed envelope', () => {
    const ct = __encryptToken('hunter2');
    assert.match(ct, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.notEqual(ct, 'hunter2', 'ciphertext must not match plaintext');
  });

  await t.test('decryptToken inverts encryptToken', () => {
    const original = 'an-access-token-with-special-chars-!@#$%';
    const ct = __encryptToken(original);
    assert.equal(__decryptToken(ct), original);
  });

  await t.test('successive encrypts produce different ciphertexts (random IV)', () => {
    const a = __encryptToken('same-input');
    const b = __encryptToken('same-input');
    assert.notEqual(a, b, 'IV randomness should make ciphertexts diverge');
    assert.equal(__decryptToken(a), 'same-input');
    assert.equal(__decryptToken(b), 'same-input');
  });

  await t.test('null and undefined pass through unchanged', () => {
    assert.equal(__encryptToken(null), null);
    assert.equal(__encryptToken(undefined), undefined);
    assert.equal(__decryptToken(null), null);
    assert.equal(__decryptToken(undefined), undefined);
  });

  await t.test('legacy plaintext (no v1. prefix) reads back unchanged', () => {
    // Tokens stored before encryption rolled out have no prefix — the read
    // path must return them as-is. The next refresh writes encrypted.
    assert.equal(__decryptToken('legacy-plaintext-token'), 'legacy-plaintext-token');
  });

  await t.test('tampered ciphertext throws on decrypt', () => {
    const ct = __encryptToken('something');
    const tampered = ct.slice(0, -2) + 'XX'; // mangle last 2 chars
    assert.throws(() => __decryptToken(tampered));
  });
});
