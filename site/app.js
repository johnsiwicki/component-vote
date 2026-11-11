const grid = document.getElementById('components');
const notice = document.getElementById('notice');
const voteDialog = document.getElementById('vote-dialog');
const form = document.getElementById('vote-form');
const errorEl = document.getElementById('vote-error');
const teamList = document.getElementById('team-list');
const detailDialog = document.getElementById('detail-dialog');
const codeTabs = document.getElementById('code-tabs');
const codeView = document.querySelector('#code-view code');
const copyButton = document.getElementById('code-copy');
const detailVote = document.getElementById('detail-vote');

const VOTED_KEY = 'component-vote:voted';
const PROFILE_KEY = 'component-vote:profile';
const SOURCES = [
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['js', 'JS'],
];

let catalog = []; // component sources from components.json
let tally = { components: {}, teams: [] }; // votes from the database
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
const hasVoted = (id) => votedIds().includes(id);

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const EMPTY = { votes: 0, teams: {}, comments: [] };
function components() {
  return catalog
    .map((c) => ({ ...c, ...(tally.components[c.id] || EMPTY) }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}
const find = (id) => components().find((c) => c.id === id);

// Components run in a sandboxed iframe: scripts work, but they get an opaque
// origin and cannot touch this page, its storage, or the API as the voter.
function previewDoc({ html, css, js }) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif}
    ${css}</style>${html}<script>${js.replace(/<\/script/gi, '<\\/script')}<\/script>`;
}

function renderCard(c) {
  const voted = hasVoted(c.id);
  const upvote = el(
    'button',
    { className: `upvote${voted ? ' voted' : ''}`, type: 'button', disabled: voted },
    el('span', { textContent: `▲ ${c.votes}` }),
    el('small', { textContent: voted ? 'Voted' : 'Upvote' })
  );
  upvote.setAttribute('aria-label', voted ? `You upvoted ${c.name}. ${c.votes} votes` : `Upvote ${c.name}. ${c.votes} votes`);
  upvote.addEventListener('click', () => openVote(c));

  // The card preview is display-only; clicking it opens the interactive preview and source.
  const frame = el('iframe', { className: 'preview', title: `${c.name} preview`, loading: 'lazy', tabIndex: -1 });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = previewDoc(c);
  const open = el('button', { className: 'open', type: 'button' }, frame, el('span', { className: 'open-hint', textContent: 'View code' }));
  open.setAttribute('aria-label', `View ${c.name} preview and HTML, CSS and JS`);
  open.addEventListener('click', () => openDetail(c));

  const name = el('button', { className: 'name-link', type: 'button', textContent: c.name });
  name.addEventListener('click', () => openDetail(c));

  const body = el(
    'div',
    { className: 'card-body' },
    el(
      'div',
      { className: 'card-head' },
      el('div', {}, el('h2', {}, name), el('p', { className: 'description', textContent: c.description })),
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

  return el('article', { className: 'card' }, open, body);
}

function render() {
  teamList.replaceChildren(...tally.teams.map((t) => el('option', { value: t })));
  if (!catalog.length) {
    grid.replaceChildren(el('p', { className: 'empty', textContent: 'No components yet. Add a folder to components/ to get started.' }));
    return;
  }
  grid.replaceChildren(...components().map(renderCard));
}

/* ---- Detail view: live preview + source ---- */

function showSource(component, key) {
  for (const tab of codeTabs.children) tab.setAttribute('aria-selected', String(tab.dataset.key === key));
  codeView.textContent = component[key].trim();
  codeView.parentElement.scrollTop = 0;
  copyButton.textContent = 'Copy';
}

function updateDetailVote(component) {
  const voted = hasVoted(component.id);
  detailVote.disabled = voted;
  detailVote.textContent = voted ? `▲ ${component.votes} · You voted` : `▲ Upvote · ${component.votes}`;
}

function openDetail(component) {
  activeId = component.id;
  document.getElementById('detail-name').textContent = component.name;
  document.getElementById('detail-description').textContent = component.description;
  document.getElementById('detail-preview').srcdoc = previewDoc(component);

  const available = SOURCES.filter(([key]) => component[key].trim());
  codeTabs.replaceChildren(
    ...available.map(([key, label]) => {
      const tab = el('button', { className: 'tab', type: 'button', textContent: label });
      tab.setAttribute('role', 'tab');
      tab.dataset.key = key;
      tab.addEventListener('click', () => showSource(component, key));
      return tab;
    })
  );
  showSource(component, available[0][0]);
  updateDetailVote(component);
  detailDialog.showModal();
}

document.getElementById('detail-close').addEventListener('click', () => detailDialog.close());
detailVote.addEventListener('click', () => openVote(find(activeId)));
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codeView.textContent);
    copyButton.textContent = 'Copied';
  } catch {
    copyButton.textContent = 'Copy failed';
  }
});
// Close either dialog when the backdrop is clicked.
for (const dialog of [detailDialog, voteDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

/* ---- Voting ---- */

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function openVote(component) {
  activeId = component.id;
  document.getElementById('vote-target').textContent = component.name;
  form.reset();
  showError('');
  const profile = store(PROFILE_KEY) || {};
  form.team.value = profile.team || '';
  form.name.value = profile.name || '';
  voteDialog.showModal();
  (form.team.value ? form.comment : form.team).focus();
}

document.getElementById('vote-cancel').addEventListener('click', () => voteDialog.close());
form.team.addEventListener('input', () => showError(''));

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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save your vote.');
    store(VOTED_KEY, [...votedIds(), activeId]);
    store(PROFILE_KEY, { team, name: form.name.value.trim() });
    tally = data;
    voteDialog.close();
    render();
    if (detailDialog.open) updateDetailVote(find(activeId));
  } catch (err) {
    showError(err.message || 'Could not save your vote.');
  } finally {
    submit.disabled = false;
  }
});

/* ---- Startup ---- */

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function load() {
  try {
    catalog = (await getJson('components.json')).components;
  } catch {
    grid.replaceChildren(el('p', { className: 'error', textContent: 'Could not load the components.' }));
    return;
  }
  try {
    tally = await getJson('/api/votes');
  } catch {
    // Still show the components and their code if the database is unreachable.
    notice.textContent = 'Votes could not be loaded right now, so counts may be missing.';
    notice.hidden = false;
  }
  render();
}

load();
