// Zero-dependency server: serves the voting page, the component sources
// found in ./components, and stores votes in a JSON file.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const COMPONENTS_DIR = path.join(ROOT, 'components');
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'votes.json');

const LIMITS = { team: 60, name: 60, comment: 1000 };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Each folder in ./components is one component:
//   index.html (required), style.css, script.js, meta.json {name, description}
function loadComponents() {
  if (!fs.existsSync(COMPONENTS_DIR)) return [];
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9-_]*$/i.test(d.name))
    .map((d) => {
      const dir = path.join(COMPONENTS_DIR, d.name);
      let meta = {};
      try {
        meta = JSON.parse(readIfExists(path.join(dir, 'meta.json')) || '{}');
      } catch {
        console.warn(`Ignoring invalid meta.json in components/${d.name}`);
      }
      return {
        id: d.name,
        name: meta.name || d.name,
        description: meta.description || '',
        html: readIfExists(path.join(dir, 'index.html')),
        css: readIfExists(path.join(dir, 'style.css')),
        js: readIfExists(path.join(dir, 'script.js')),
      };
    })
    .filter((c) => c.html);
}

function loadVotes() {
  try {
    const votes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(votes) ? votes : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read ${DATA_FILE}: ${err.message}`);
    return [];
  }
}

function saveVotes(votes) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(votes, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const votes = loadVotes();

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function listComponents() {
  return loadComponents()
    .map((c) => {
      const mine = votes.filter((v) => v.componentId === c.id);
      const teams = {};
      for (const v of mine) teams[v.team] = (teams[v.team] || 0) + 1;
      return {
        ...c,
        votes: mine.length,
        teams,
        comments: mine
          .filter((v) => v.comment)
          .map(({ name, team, comment, createdAt }) => ({ name, team, comment, createdAt }))
          .reverse(),
      };
    })
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('Body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleVote(req, res, componentId) {
  if (!loadComponents().some((c) => c.id === componentId)) {
    return sendJson(res, 404, { error: 'Unknown component' });
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  const team = clean(body.team, LIMITS.team);
  if (!team) return sendJson(res, 400, { error: 'Team is required' });

  // Reuse the existing spelling of a team so "design" and "Design" tally together.
  const known = votes.find((v) => v.team.toLowerCase() === team.toLowerCase());
  votes.push({
    componentId,
    team: known ? known.team : team,
    name: clean(body.name, LIMITS.name), // optional: empty means anonymous
    comment: clean(body.comment, LIMITS.comment),
    createdAt: new Date().toISOString(),
  });
  saveVotes(votes);
  sendJson(res, 201, { components: listComponents() });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const voteMatch = pathname.match(/^\/api\/components\/([^/]+)\/votes$/);

  if (req.method === 'GET' && pathname === '/api/components') {
    const teams = [...new Set(votes.map((v) => v.team))].sort();
    return sendJson(res, 200, { components: listComponents(), teams });
  }
  if (req.method === 'POST' && voteMatch) return handleVote(req, res, voteMatch[1]);
  if (req.method === 'GET') return serveStatic(res, pathname);
  res.writeHead(405).end();
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Component Vote running at http://localhost:${port}`));
}

module.exports = { server };
