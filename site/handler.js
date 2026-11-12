// Spacefast Functions worker. Static files in this folder are served first;
// everything else (the /api routes) lands here. Votes and the components people
// add live in the Space's own
// database, reached through env.DB (https://spacefast.com/docs/database/).

const LIMITS = { team: 60, name: 60, comment: 1000, title: 80, description: 300, code: 50_000 };
const COMPONENT_ID = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

// Kept to SQL that both MySQL (Spacefast) and SQLite (local dev) accept.
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS votes (
  id VARCHAR(36) PRIMARY KEY,
  component_id VARCHAR(100) NOT NULL,
  team VARCHAR(60) NOT NULL,
  voter_name VARCHAR(60) NOT NULL,
  body TEXT NOT NULL,
  created_at VARCHAR(30) NOT NULL
)`;

// Components people add from the page. The starter set ships as components.json.
const CREATE_COMPONENTS = `CREATE TABLE IF NOT EXISTS components (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(300) NOT NULL,
  author VARCHAR(60) NOT NULL,
  html MEDIUMTEXT NOT NULL,
  css MEDIUMTEXT NOT NULL,
  js MEDIUMTEXT NOT NULL,
  created_at VARCHAR(30) NOT NULL
)`;

const tableReady = new WeakMap();
function ensureTable(db) {
  if (!tableReady.has(db)) {
    const pending = db
      .prepare(CREATE_TABLE)
      .run()
      .then(() => db.prepare(CREATE_COMPONENTS).run());
    tableReady.set(db, pending);
    pending.catch(() => tableReady.delete(db)); // retry on the next request
  }
  return tableReady.get(db);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// { components: { [id]: { votes, teams: { [team]: n }, comments: [...] } }, teams: [...] }
async function summary(db) {
  const { results } = await db
    .prepare('SELECT component_id, team, voter_name, body, created_at FROM votes ORDER BY created_at DESC')
    .all();
  const components = {};
  const teams = new Set();
  for (const row of results) {
    const c = (components[row.component_id] ??= { votes: 0, teams: {}, comments: [] });
    c.votes += 1;
    c.teams[row.team] = (c.teams[row.team] || 0) + 1;
    teams.add(row.team);
    if (row.body) {
      c.comments.push({ name: row.voter_name, team: row.team, comment: row.body, createdAt: row.created_at });
    }
  }
  return { components, teams: [...teams].sort() };
}

// Reads a JSON body. Requiring the JSON content type means a cross-origin page
// (including a component's own sandboxed script) cannot post here: the browser
// would have to ask permission first, and this worker never grants it.
async function readJson(request, maxLength) {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return { error: json({ error: 'Send JSON with Content-Type: application/json' }, 415) };
  }
  try {
    const raw = await request.text();
    if (raw.length > maxLength) return { error: json({ error: 'Request body too large' }, 413) };
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return { body };
  } catch {
    return { error: json({ error: 'Body must be valid JSON' }, 400) };
  }
}

function toComponent(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    author: row.author,
    html: row.html,
    css: row.css,
    js: row.js,
    createdAt: row.created_at,
  };
}

async function listComponents(db) {
  const { results } = await db
    .prepare('SELECT id, name, description, author, html, css, js, created_at FROM components ORDER BY created_at')
    .all();
  return { components: results.map(toComponent) };
}

async function addComponent(request, db) {
  const { body, error } = await readJson(request, 200_000);
  if (error) return error;

  const name = clean(body.name, LIMITS.title);
  if (!name) return json({ error: 'Give the component a name' }, 400);

  const code = {};
  for (const key of ['html', 'css', 'js']) {
    const value = typeof body[key] === 'string' ? body[key] : '';
    if (value.length > LIMITS.code) {
      return json({ error: `The ${key.toUpperCase()} is too long (limit ${LIMITS.code.toLocaleString('en-US')} characters)` }, 400);
    }
    code[key] = value;
  }
  if (!code.html.trim()) return json({ error: 'The HTML cannot be empty' }, 400);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'component';
  const row = {
    id: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
    name,
    description: clean(body.description, LIMITS.description),
    author: clean(body.author, LIMITS.name), // optional: empty means anonymous
    ...code,
    created_at: new Date().toISOString(),
  };
  await db
    .prepare('INSERT INTO components (id, name, description, author, html, css, js, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.name, row.description, row.author, row.html, row.css, row.js, row.created_at)
    .run();
  return json({ component: toComponent(row) }, 201);
}

async function castVote(request, db, componentId) {
  if (!COMPONENT_ID.test(componentId)) return json({ error: 'Unknown component' }, 404);

  const { body, error } = await readJson(request, 10_000);
  if (error) return error;

  let team = clean(body.team, LIMITS.team);
  if (!team) return json({ error: 'Team is required' }, 400);

  // Reuse the existing spelling of a team so "design" and "Design" tally together.
  const known = await db.prepare('SELECT team FROM votes WHERE LOWER(team) = LOWER(?) LIMIT 1').bind(team).all();
  if (known.results.length) team = known.results[0].team;

  await db
    .prepare('INSERT INTO votes (id, component_id, team, voter_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      crypto.randomUUID(),
      componentId,
      team,
      clean(body.name, LIMITS.name), // optional: empty means anonymous
      clean(body.comment, LIMITS.comment),
      new Date().toISOString()
    )
    .run();

  return json(await summary(db), 201);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const voteMatch = pathname.match(/^\/api\/components\/([^/]+)\/votes$/);
    const known = pathname === '/api/votes' || pathname === '/api/components' || voteMatch;
    if (!known) return json({ error: 'Not found' }, 404);

    try {
      await ensureTable(env.DB);
      if (voteMatch) {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        return await castVote(request, env.DB, decodeURIComponent(voteMatch[1]));
      }
      if (pathname === '/api/components') {
        if (request.method === 'POST') return await addComponent(request, env.DB);
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        return json(await listComponents(env.DB));
      }
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return json(await summary(env.DB));
    } catch (err) {
      console.error('component-vote request failed', err);
      return json({ error: 'Something went wrong saving or loading votes.' }, 500);
    }
  },
};
