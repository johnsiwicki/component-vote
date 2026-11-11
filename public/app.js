const grid = document.getElementById('components');
const dialog = document.getElementById('vote-dialog');
const form = document.getElementById('vote-form');
const errorEl = document.getElementById('vote-error');
const teamList = document.getElementById('team-list');

const VOTED_KEY = 'component-vote:voted';
const PROFILE_KEY = 'component-vote:profile';

let components = [];
let activeId = null;

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: voting still works, it just isn't remembered */
  }
  return null;
}
const votedIds = () => store(VOTED_KEY) || [];

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Components run in a sandboxed iframe: scripts work, but they get an opaque
// origin and cannot touch this page, its storage, or the API as the voter.
function previewDoc({ html, css, js }) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif}
    ${css}</style>${html}<script>${js.replace(/<\/script/gi, '<\\/script')}<\/script>`;
}

function renderCard(c) {
  const voted = votedIds().includes(c.id);
  const upvote = el(
    'button',
    { className: `upvote${voted ? ' voted' : ''}`, type: 'button', disabled: voted },
    el('span', { textContent: `▲ ${c.votes}` }),
    el('small', { textContent: voted ? 'Voted' : 'Upvote' })
  );
  upvote.setAttribute('aria-label', voted ? `You upvoted ${c.name}. ${c.votes} votes` : `Upvote ${c.name}. ${c.votes} votes`);
  upvote.addEventListener('click', () => openDialog(c));

  const frame = el('iframe', { className: 'preview', title: `${c.name} preview`, loading: 'lazy' });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = previewDoc(c);

  const body = el(
    'div',
    { className: 'card-body' },
    el(
      'div',
      { className: 'card-head' },
      el('div', {}, el('h2', { textContent: c.name }), el('p', { className: 'description', textContent: c.description })),
      upvote
    )
  );

  const teams = Object.entries(c.teams).sort((a, b) => b[1] - a[1]);
  if (teams.length) {
    body.append(el('ul', { className: 'teams' }, ...teams.map(([team, n]) => el('li', { textContent: `${team} · ${n}` }))));
  }

  if (c.comments.length) {
    body.append(
      el(
        'details',
        { className: 'comments' },
        el('summary', { textContent: `${c.comments.length} comment${c.comments.length === 1 ? '' : 's'}` }),
        el(
          'ul',
          {},
          ...c.comments.map((m) =>
            el(
              'li',
              {},
              el('p', { textContent: m.comment }),
              el('span', { className: 'by', textContent: `${m.name || 'Anonymous'} · ${m.team}` })
            )
          )
        )
      )
    );
  }

  return el('article', { className: 'card' }, frame, body);
}

function render() {
  if (!components.length) {
    grid.replaceChildren(el('p', { className: 'empty', textContent: 'No components yet. Add a folder to components/ to get started.' }));
    return;
  }
  grid.replaceChildren(...components.map(renderCard));
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function openDialog(component) {
  activeId = component.id;
  document.getElementById('vote-target').textContent = component.name;
  form.reset();
  showError('');
  const profile = store(PROFILE_KEY) || {};
  form.team.value = profile.team || '';
  form.name.value = profile.name || '';
  dialog.showModal();
  (form.team.value ? form.comment : form.team).focus();
}

document.getElementById('vote-cancel').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const team = form.team.value.trim();
  if (!team) {
    showError('Please tell us which team you are on.');
    form.team.focus();
    return;
  }
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const res = await fetch(`/api/components/${encodeURIComponent(activeId)}/votes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, name: form.name.value, comment: form.comment.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save your vote.');
    store(VOTED_KEY, [...votedIds(), activeId]);
    store(PROFILE_KEY, { team, name: form.name.value.trim() });
    components = data.components;
    dialog.close();
    render();
  } catch (err) {
    showError(err.message || 'Could not save your vote.');
  } finally {
    submit.disabled = false;
  }
});

async function load() {
  try {
    const res = await fetch('/api/components');
    if (!res.ok) throw new Error();
    const data = await res.json();
    components = data.components;
    teamList.replaceChildren(...data.teams.map((t) => el('option', { value: t })));
    render();
  } catch {
    grid.replaceChildren(el('p', { className: 'error', textContent: 'Could not load components. Is the server running?' }));
  }
}

load();
