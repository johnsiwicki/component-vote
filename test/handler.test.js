import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createLocalDb, createServer } from '../dev-server.js';
import { OUTPUT, render } from '../scripts/build-components.js';
import '../site/highlight.js';

const server = createServer(createLocalDb(':memory:'));
let base;
test.before(() => new Promise((r) => server.listen(0, () => ((base = `http://localhost:${server.address().port}`), r()))));
test.after(() => server.close());

const post = (path, body, type = 'application/json') =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const vote = (id, body) => post(`/api/components/${id}/votes`, body);
const put = (path, body, type = 'application/json') =>
  fetch(base + path, { method: 'PUT', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('site/components.json is up to date (run `npm run components`)', () => {
  assert.strictEqual(fs.readFileSync(OUTPUT, 'utf8'), render());
});

test('serves the page and the component sources', async () => {
  assert.match(await (await fetch(base)).text(), /Test Queue/);
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
  assert.strictEqual((await post('/api/components/pill-button/votes', '{nope')).status, 400);
  // A cross-origin page can only send "simple" content types without asking first.
  assert.strictEqual((await post('/api/components/pill-button/votes', { team: 'X' }, 'text/plain')).status, 415);
  assert.strictEqual((await fetch(`${base}/api/components/pill-button/votes`)).status, 405);
  assert.strictEqual((await fetch(`${base}/handler.js`)).status, 404);
  assert.notStrictEqual((await fetch(`${base}/..%2Fdev-server.js`)).status, 200);
});

test('people can add components, and vote on them', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/components`)).json(), { components: [] });
  assert.strictEqual((await post('/api/components', { html: '<b>x</b>' })).status, 400); // no name
  assert.strictEqual((await post('/api/components', { name: 'Empty' })).status, 400); // no html
  assert.strictEqual((await post('/api/components', { name: 'Big', html: 'x', js: 'y'.repeat(50_001) })).status, 400);

  const res = await post('/api/components', { name: '  Fancy Badge! ', html: '<b>hi</b>', css: 'b{color:red}' });
  assert.strictEqual(res.status, 201);
  const { component } = await res.json();
  assert.match(component.id, /^fancy-badge-[0-9a-f]{6}$/);
  assert.deepStrictEqual(
    { ...component, id: '', createdAt: '' },
    { id: '', name: 'Fancy Badge!', description: '', author: '', html: '<b>hi</b>', css: 'b{color:red}', js: '', createdAt: '' }
  );

  const { components } = await (await fetch(`${base}/api/components`)).json();
  assert.deepStrictEqual(components, [component]);

  const voted = await (await vote(component.id, { team: 'QA' })).json();
  assert.strictEqual(voted.components[component.id].votes, 1);
});

test('highlighter escapes markup and tags tokens', () => {
  const h = globalThis.highlightCode;
  assert.strictEqual(h('<b class="x">&</b>', 'html'),
    '<span class="tok-tag">&lt;b</span> <span class="tok-attr">class</span>=<span class="tok-str">"x"</span><span class="tok-tag">&gt;</span>&amp;<span class="tok-tag">&lt;/b</span><span class="tok-tag">&gt;</span>');
  assert.match(h('const a = "<i>"; // hi', 'js'), /tok-kw">const<.*tok-str">"&lt;i&gt;"<.*tok-comment">\/\/ hi</);
  assert.match(h('a:hover { color: #fff; margin: 4px }', 'css'), /tok-sel">a<.*tok-sel">hover<.*tok-prop">color<.*tok-num">#fff<.*tok-prop">margin<.*tok-num">4px</);
  assert.match(h('<style>.a{top:0}</style><script>let x = 1</script>', 'html'), /tok-prop">top<.*tok-kw">let</);
  for (const lang of ['html', 'css', 'js']) assert.ok(!h('<img src=x onerror=alert(1)>"\'`/*', lang).includes('<img'));
});

test('a live component can be edited in place, keeping its votes and author', async () => {
  const added = await (await post('/api/components', { name: 'Editable', html: '<i>v1</i>', author: 'Pat' })).json();
  const id = added.component.id;
  await vote(id, { team: 'Web' });

  const res = await put(`/api/components/${id}`, { name: 'Editable v2', description: 'Now better', html: '<i>v2</i>', css: 'i{}', js: '' });
  assert.strictEqual(res.status, 200);
  const { component } = await res.json();
  assert.deepStrictEqual({ ...component, createdAt: '' }, { id, name: 'Editable v2', description: 'Now better', author: 'Pat', html: '<i>v2</i>', css: 'i{}', js: '', createdAt: '' });

  const { components, teams } = await (await fetch(`${base}/api/votes`)).json();
  assert.strictEqual(components[id].votes, 1); // votes survive the edit
  assert.ok(teams.includes('Web'));
  const listed = (await (await fetch(`${base}/api/components`)).json()).components.find((c) => c.id === id);
  assert.strictEqual(listed.name, 'Editable v2');
});

test('editing a starter component overrides its copy without changing the repo file', async () => {
  const res = await put('/api/components/pill-button', { name: 'Pill Button', html: '<button>Changed</button>' });
  assert.strictEqual(res.status, 200);
  const { components } = await (await fetch(`${base}/api/components`)).json();
  assert.strictEqual(components.find((c) => c.id === 'pill-button').html, '<button>Changed</button>');
  assert.match(fs.readFileSync(OUTPUT, 'utf8'), /Get started/);
});

test('edits are validated and only PUT edits components', async () => {
  assert.strictEqual((await put('/api/components/pill-button', { name: '', html: 'x' })).status, 400);
  assert.strictEqual((await put('/api/components/pill-button', { name: 'x', html: '  ' })).status, 400);
  assert.strictEqual((await put('/api/components/pill-button', { name: 'x', html: 'x' }, 'text/plain')).status, 415);
  assert.strictEqual((await put('/api/components/bad%20id!', { name: 'x', html: 'x' })).status, 404);
  assert.strictEqual((await fetch(`${base}/api/components/pill-button`, { method: 'POST', body: '{}' })).status, 405);
});

// A real 1x1 PNG and a few bytes that only claim to be one.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const FAKE_PNG = 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>xxxxxxxxxx').toString('base64');

test('people can suggest test ideas, with an optional screenshot', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/ideas`)).json(), { ideas: [] });

  const plain = await post('/api/ideas', { title: '  Shorter signup form ', description: 'Drop the phone field', author: 'Ana' });
  assert.strictEqual(plain.status, 201);
  const { idea } = await plain.json();
  assert.match(idea.id, /^idea-shorter-signup-form-[0-9a-f]{6}$/);
  assert.deepStrictEqual({ ...idea, id: '', createdAt: '' }, { id: '', title: 'Shorter signup form', description: 'Drop the phone field', author: 'Ana', hasScreenshot: false, createdAt: '' });
  assert.strictEqual((await fetch(`${base}/api/ideas/${idea.id}/screenshot`)).status, 404);

  const withShot = await (await post('/api/ideas', { title: 'Bigger CTA', description: 'See screenshot', screenshot: PNG })).json();
  assert.strictEqual(withShot.idea.hasScreenshot, true);
  assert.strictEqual(withShot.idea.author, '');

  const list = (await (await fetch(`${base}/api/ideas`)).json()).ideas;
  assert.deepStrictEqual(list.map((i) => i.title), ['Shorter signup form', 'Bigger CTA']);
  assert.ok(list.every((i) => !('screenshot' in i))); // listing never carries image data

  const image = await fetch(`${base}/api/ideas/${withShot.idea.id}/screenshot`);
  assert.strictEqual(image.status, 200);
  assert.strictEqual(image.headers.get('content-type'), 'image/png');
  assert.strictEqual(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepStrictEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(PNG.split(',')[1], 'base64'));

  // Ideas are voted on like components.
  const voted = await (await vote(idea.id, { team: 'Growth', comment: 'Yes please' })).json();
  assert.strictEqual(voted.components[idea.id].votes, 1);
});

test('ideas are validated', async () => {
  assert.strictEqual((await post('/api/ideas', { description: 'no title' })).status, 400);
  assert.strictEqual((await post('/api/ideas', { title: 'No description' })).status, 400);
  assert.strictEqual((await post('/api/ideas', { title: 'x', description: 'y', screenshot: FAKE_PNG })).status, 400);
  assert.strictEqual((await post('/api/ideas', { title: 'x', description: 'y', screenshot: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  assert.strictEqual((await post('/api/ideas', { title: 'x', description: 'y', screenshot: PNG + 'A'.repeat(1_000_000) })).status, 400);
  assert.strictEqual((await post('/api/ideas', { title: 'x', description: 'y' }, 'text/plain')).status, 415);
  assert.strictEqual((await fetch(`${base}/api/ideas/bad%20id!/screenshot`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/ideas`, { method: 'DELETE' })).status, 405);
});
