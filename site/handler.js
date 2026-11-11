// Spacefast Functions worker. Static files in this folder are served first;
// everything else (the /api routes) lands here. Votes live in the Space's own
// database, reached through env.DB (https://spacefast.com/docs/database/).

const LIMITS = { team: 60, name: 60, comment: 1000 };
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

const tableReady = new WeakMap();
function ensureTable(db) {
  if (!tableReady.has(db)) {
    const pending = db.prepare(CREATE_TABLE).run();
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

async function castVote(request, db, componentId) {
  if (!COMPONENT_ID.test(componentId)) return json({ error: 'Unknown component' }, 404);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 10_000) return json({ error: 'Request body too large' }, 413);
    body = JSON.parse(raw || '{}');
  } catch {
    return json({ error: 'Body must be valid JSON' }, 400);
  }

  let team = clean(body?.team, LIMITS.team);
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
    if (pathname !== '/api/votes' && !voteMatch) return json({ error: 'Not found' }, 404);

    try {
      await ensureTable(env.DB);
      if (voteMatch) {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        return await castVote(request, env.DB, decodeURIComponent(voteMatch[1]));
      }
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return json(await summary(env.DB));
    } catch (err) {
      console.error('component-vote request failed', err);
      return json({ error: 'Something went wrong saving or loading votes.' }, 500);
    }
  },
};
