const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app, asUser, ready, resetDb } = require('../helpers/boot');

test.before(async () => { await ready(); });
test.beforeEach(() => { resetDb(); });

const OWNER = 1, MEMBER = 2;

test('GET /api/budget — member is forbidden (requireOwner)', async () => {
  const res = await request(app).get('/api/budget').set('Cookie', asUser(MEMBER));
  assert.equal(res.status, 403);
});

test('GET /api/budget — owner gets the budget shape', async () => {
  const res = await request(app).get('/api/budget').set('Cookie', asUser(OWNER));
  assert.equal(res.status, 200);
  assert.ok(res.body.data);
});

test('POST /api/budget/lines — rejects missing fiscal_year', async () => {
  const res = await request(app)
    .post('/api/budget/lines')
    .set('Cookie', asUser(OWNER))
    .send({ category: 'Salaries', section: 'opex' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /fiscal_year/);
});

test('POST /api/budget/lines — rejects unknown section', async () => {
  const res = await request(app)
    .post('/api/budget/lines')
    .set('Cookie', asUser(OWNER))
    .send({ fiscal_year: 'FY27', category: 'X', section: 'capex' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /section must be one of/);
});

test('POST /api/budget/lines — owner can create', async () => {
  const res = await request(app)
    .post('/api/budget/lines')
    .set('Cookie', asUser(OWNER))
    .send({ fiscal_year: 'FY27', category: 'Salaries', section: 'opex' });
  assert.equal(res.status, 200);
});

test('PUT /api/budget/cells — rejects non-numeric budget_amount', async () => {
  const line = await request(app)
    .post('/api/budget/lines')
    .set('Cookie', asUser(OWNER))
    .send({ fiscal_year: 'FY27', category: 'X', section: 'income' });
  const res = await request(app)
    .put('/api/budget/cells')
    .set('Cookie', asUser(OWNER))
    .send({ line_id: line.body.data.id, period_date: '2026-05-01', budget_amount: 'not-a-number' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /budget_amount must be a number/);
});
