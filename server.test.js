const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cv-')), 'votes.json');
const { server } = require('./server');

let base;
test.before(() => new Promise((r) => server.listen(0, () => ((base = `http://localhost:${server.address().port}`), r()))));
test.after(() => server.close());

const vote = (id, body) =>
  fetch(`${base}/api/components/${id}/votes`, { method: 'POST', body: JSON.stringify(body) });

test('lists components with zero votes', async () => {
  const { components } = await (await fetch(`${base}/api/components`)).json();
  assert.ok(components.length >= 1);
  assert.ok(components.every((c) => c.votes === 0 && c.html));
});

test('name is optional, team is required', async () => {
  assert.strictEqual((await vote('pill-button', { name: 'Sam' })).status, 400);

  const res = await vote('pill-button', { team: 'Design', comment: 'Love it' });
  assert.strictEqual(res.status, 201);
  const { components } = await res.json();
  assert.strictEqual(components[0].id, 'pill-button'); // sorted by votes
  assert.strictEqual(components[0].votes, 1);
  assert.deepStrictEqual(components[0].teams, { Design: 1 });
  assert.strictEqual(components[0].comments[0].name, '');
  assert.ok(fs.existsSync(process.env.DATA_FILE));
});

test('team names tally case-insensitively', async () => {
  const { components } = await (await vote('pill-button', { team: 'design', name: 'Sam' })).json();
  assert.deepStrictEqual(components[0].teams, { Design: 2 });
});

test('rejects unknown components and path traversal', async () => {
  assert.strictEqual((await vote('nope', { team: 'X' })).status, 404);
  assert.notStrictEqual((await fetch(`${base}/..%2Fserver.js`)).status, 200);
});
