import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createLocalDb, createServer } from '../dev-server.js';
import { OUTPUT, render } from '../scripts/build-components.js';

const server = createServer(createLocalDb(':memory:'));
let base;
test.before(() => new Promise((r) => server.listen(0, () => ((base = `http://localhost:${server.address().port}`), r()))));
test.after(() => server.close());

const vote = (id, body) =>
  fetch(`${base}/api/components/${id}/votes`, { method: 'POST', body: JSON.stringify(body) });

test('site/components.json is up to date (run `npm run components`)', () => {
  assert.strictEqual(fs.readFileSync(OUTPUT, 'utf8'), render());
});

test('serves the page and the component sources', async () => {
  assert.match(await (await fetch(base)).text(), /Component Vote/);
  const { components } = await (await fetch(`${base}/components.json`)).json();
  assert.ok(components.length >= 1);
  assert.ok(components.every((c) => c.id && c.html));
});

test('starts with no votes', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/votes`)).json(), { components: {}, teams: [] });
});

test('name is optional, team is required', async () => {
  assert.strictEqual((await vote('pill-button', { name: 'Sam' })).status, 400);

  const res = await vote('pill-button', { team: 'Design', comment: 'Love it' });
  assert.strictEqual(res.status, 201);
  const { components, teams } = await res.json();
  assert.strictEqual(components['pill-button'].votes, 1);
  assert.deepStrictEqual(components['pill-button'].teams, { Design: 1 });
  assert.strictEqual(components['pill-button'].comments[0].name, '');
  assert.strictEqual(components['pill-button'].comments[0].comment, 'Love it');
  assert.deepStrictEqual(teams, ['Design']);
});

test('team names tally case-insensitively and votes persist', async () => {
  await vote('pill-button', { team: 'design', name: 'Sam' });
  const { components } = await (await fetch(`${base}/api/votes`)).json();
  assert.deepStrictEqual(components['pill-button'].teams, { Design: 2 });
  assert.strictEqual(components['pill-button'].comments.length, 1); // no comment on the second vote
});

test('rejects bad input', async () => {
  assert.strictEqual((await vote('bad%20id!', { team: 'X' })).status, 404);
  assert.strictEqual((await fetch(`${base}/api/components/pill-button/votes`, { method: 'POST', body: '{nope' })).status, 400);
  assert.strictEqual((await fetch(`${base}/api/components/pill-button/votes`)).status, 405);
  assert.strictEqual((await fetch(`${base}/handler.js`)).status, 404);
  assert.notStrictEqual((await fetch(`${base}/..%2Fdev-server.js`)).status, 200);
});
