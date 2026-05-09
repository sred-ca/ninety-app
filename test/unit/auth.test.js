const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../helpers/boot');

test('makeAuthCookie', async (t) => {
  await t.test('produces a payload.signature shape', () => {
    const cookie = app.makeAuthCookie(1);
    assert.ok(cookie.includes('.'));
    const [payload, sig] = cookie.split('.');
    assert.ok(payload.length > 0);
    assert.ok(sig.length > 0);
  });

  await t.test('encodes the userId in the payload', () => {
    const cookie = app.makeAuthCookie(42);
    const [payload] = cookie.split('.');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(parsed.userId, 42);
  });

  await t.test('embeds an expiration > now', () => {
    const cookie = app.makeAuthCookie(1);
    const [payload] = cookie.split('.');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.ok(parsed.exp > Date.now(), 'cookie must expire in the future');
    assert.ok(parsed.iat <= Date.now(), 'iat must be in the past or now');
  });

  await t.test('different userIds produce different cookies', () => {
    assert.notEqual(app.makeAuthCookie(1), app.makeAuthCookie(2));
  });
});
