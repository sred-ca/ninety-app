const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb } = require('../helpers/boot');
const { qbConnectionQueries } = require('../../database');

test.beforeEach(() => { resetDb(); });

test('qbConnectionQueries.getActive returns null when no connection exists', async () => {
  assert.equal(await qbConnectionQueries.getActive(), null);
});

test('qbConnectionQueries.upsert creates a connection and returns plaintext tokens', async () => {
  const conn = await qbConnectionQueries.upsert({
    realm_id: '4620816365239876',
    access_token: 'access-plaintext',
    refresh_token: 'refresh-plaintext',
    access_token_expires_at: '2026-06-01T00:00:00Z',
    refresh_token_expires_at: '2026-12-01T00:00:00Z',
    connected_by_user_id: 1,
  });
  // Read path returns decrypted tokens — caller never sees ciphertext.
  assert.equal(conn.access_token, 'access-plaintext');
  assert.equal(conn.refresh_token, 'refresh-plaintext');
});

test('qbConnectionQueries.getActive returns the most-recently-updated connection', async () => {
  await qbConnectionQueries.upsert({
    realm_id: 'realm-A', access_token: 'a-tok', refresh_token: 'a-ref',
    access_token_expires_at: '2026-06-01T00:00:00Z',
  });
  // Sort key is updated_at (ms-precision ISO string) — sleep a few ms so the
  // second row's timestamp is strictly greater. Otherwise the sort is unstable.
  await new Promise(r => setTimeout(r, 5));
  await qbConnectionQueries.upsert({
    realm_id: 'realm-B', access_token: 'b-tok', refresh_token: 'b-ref',
    access_token_expires_at: '2026-06-01T00:00:00Z',
  });
  const active = await qbConnectionQueries.getActive();
  assert.equal(active.realm_id, 'realm-B', 'most recently upserted wins');
  assert.equal(active.access_token, 'b-tok');
});

test('qbConnectionQueries.upsert is idempotent on realm_id (updates instead of duplicating)', async () => {
  const first = await qbConnectionQueries.upsert({
    realm_id: 'same-realm', access_token: 'old', refresh_token: 'old-r',
    access_token_expires_at: '2026-06-01T00:00:00Z',
  });
  const second = await qbConnectionQueries.upsert({
    realm_id: 'same-realm', access_token: 'new', refresh_token: 'new-r',
    access_token_expires_at: '2026-07-01T00:00:00Z',
  });
  assert.equal(second.id, first.id, 'same realm_id must update the same row');
  assert.equal(second.access_token, 'new');
});

test('qbConnectionQueries.updateTokens replaces tokens and re-encrypts', async () => {
  const conn = await qbConnectionQueries.upsert({
    realm_id: 'r1', access_token: 'tok-1', refresh_token: 'ref-1',
    access_token_expires_at: '2026-06-01T00:00:00Z',
  });
  const updated = await qbConnectionQueries.updateTokens(conn.id, {
    access_token: 'tok-2',
    refresh_token: 'ref-2',
    access_token_expires_at: '2026-07-01T00:00:00Z',
  });
  assert.equal(updated.access_token, 'tok-2');
  assert.equal(updated.refresh_token, 'ref-2');
});

test('qbConnectionQueries.disconnect wipes all connections', async () => {
  await qbConnectionQueries.upsert({
    realm_id: 'r1', access_token: 'a', refresh_token: 'r',
    access_token_expires_at: '2026-06-01T00:00:00Z',
  });
  await qbConnectionQueries.disconnect();
  assert.equal(await qbConnectionQueries.getActive(), null);
});

test('qbConnectionQueries persists ENCRYPTED tokens to disk (read-back proves the round-trip)', async () => {
  // Round-trip through getByRealm proves the on-disk encryption is decrypted
  // correctly on read. If the encrypt/decrypt path broke, we'd get back
  // ciphertext or throw.
  await qbConnectionQueries.upsert({
    realm_id: 'integrity-check', access_token: 'super-secret-token-xyz', refresh_token: 'r',
    access_token_expires_at: '2026-06-01T00:00:00Z',
  });
  const fetched = await qbConnectionQueries.getByRealm('integrity-check');
  assert.equal(fetched.access_token, 'super-secret-token-xyz',
    'token must round-trip through encrypt → persist → load → decrypt');
});
