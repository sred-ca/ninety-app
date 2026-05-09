const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDb } = require('../helpers/boot');
const { userQueries } = require('../../database');

test.beforeEach(() => { resetDb(); });

test('userQueries.getAll projects to a member-readable shape (no email/role)', async () => {
  const list = await userQueries.getAll();
  assert.ok(list.length >= 5, 'seed users should be present');
  const u = list[0];
  assert.deepEqual(Object.keys(u).sort(), ['color', 'id', 'name', 'picture'].sort());
});

test('userQueries.getAllForAdmin includes email + role', async () => {
  const list = await userQueries.getAllForAdmin();
  const u = list[0];
  assert.ok('email' in u);
  assert.ok('role' in u);
});

test('userQueries.getById returns null for unknown ids', async () => {
  assert.equal(await userQueries.getById(99999), null);
});

test('userQueries.getByEmail returns null for unknown emails', async () => {
  assert.equal(await userQueries.getByEmail('nobody@example.com'), null);
});

test('userQueries.create defaults role to member', async () => {
  const u = await userQueries.create('Newcomer', '#ec4899');
  assert.equal(u.role, 'member');
  assert.equal(u.color, '#ec4899');
});

test('userQueries.update changes name and color', async () => {
  const u = await userQueries.create('Old Name', '#000000');
  const updated = await userQueries.update(u.id, 'New Name', '#ffffff');
  assert.equal(updated.name, 'New Name');
  assert.equal(updated.color, '#ffffff');
});

test('userQueries.setRole promotes a member to owner', async () => {
  const u = await userQueries.create('Promotee', '#000');
  const promoted = await userQueries.setRole(u.id, 'owner');
  assert.equal(promoted.role, 'owner');
});

test('userQueries.setRole refuses to demote the last owner', async () => {
  // Seed gives us Logan as the only seeded owner. Demote him → should throw.
  const owners = (await userQueries.getAllForAdmin()).filter(u => u.role === 'owner');
  assert.equal(owners.length, 1, 'precondition: exactly one seeded owner');
  await assert.rejects(
    userQueries.setRole(owners[0].id, 'member'),
    err => err.code === 'LAST_OWNER',
    'demoting the last owner must throw a LAST_OWNER error'
  );
});

test('userQueries.setRole allows demoting an owner when others remain', async () => {
  // Promote a second user, then demoting either should now succeed.
  const u = await userQueries.create('Co-Owner', '#000');
  await userQueries.setRole(u.id, 'owner');
  const demoted = await userQueries.setRole(u.id, 'member');
  assert.equal(demoted.role, 'member');
});

test('userQueries.countOwners reflects current owner count', async () => {
  const before = await userQueries.countOwners();
  const u = await userQueries.create('Will be owner', '#000');
  await userQueries.setRole(u.id, 'owner');
  const after = await userQueries.countOwners();
  assert.equal(after, before + 1);
});

test('userQueries.findOrCreateByEmail auto-promotes hard-coded owner emails', async () => {
  // jude@sred.ca is in OWNER_EMAILS in database.js, so a fresh sign-in should
  // be created with role=owner without any explicit promotion call.
  const u = await userQueries.findOrCreateByEmail('jude@sred.ca', 'Jude');
  assert.equal(u.role, 'owner');
});

test('userQueries.findOrCreateByEmail keeps non-listed emails as member', async () => {
  const u = await userQueries.findOrCreateByEmail('rando@example.com', 'Rando');
  assert.equal(u.role, 'member');
});

test('userQueries.findOrCreateByEmail returns the existing row on second call', async () => {
  const a = await userQueries.findOrCreateByEmail('rando2@example.com', 'Rando');
  const b = await userQueries.findOrCreateByEmail('rando2@example.com', 'Rando');
  assert.equal(a.id, b.id, 'same email must resolve to the same user id');
});

test('userQueries.delete removes the user', async () => {
  const u = await userQueries.create('Doomed', '#000');
  await userQueries.delete(u.id);
  assert.equal(await userQueries.getById(u.id), null);
});
