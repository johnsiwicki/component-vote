const $ = (id) => document.getElementById(id);
const grid = $('components');
const notice = $('notice');
const board = $('board');
const penEl = $('pen');
const penPreview = $('pen-preview');
const voteDialog = $('vote-dialog');
const voteForm = $('vote-form');
const saveDialog = $('save-dialog');
const saveForm = $('save-form');
const teamList = $('team-list');

const VOTED_KEY = 'component-vote:voted';
const PROFILE_KEY = 'component-vote:profile';
const DRAFT_KEY = 'component-vote:draft';
const LANGS = ['html', 'css', 'js'];
const STARTER = {
  html: '<button class="hello">Clicked 0 times</button>\n',
  css: '.hello {\n  padding: 12px 24px;\n  border: 0;\n  border-radius: 8px;\n  background: #4f46e5;\n  color: #fff;\n  font: 600 16px system-ui, sans-serif;\n  cursor: pointer;\n}\n',
  js: "const button = document.querySelector('.hello');\nlet count = 0;\nbutton.addEventListener('click', () => {\n  count += 1;\n  button.textContent = `Clicked ${count} times`;\n});\n",
};

let builtIn = []; // starter components from components.json
let submitted = []; // components people added, from the database
let tally = { components: {}, teams: [] }; // votes, from the database
let voteTargetId = null;
let pen = null; // { component | null, base: { html, css, js } } while the editor is open

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: everything still works, it just isn't remembered */
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
  const ids = new Set(builtIn.map((c) => c.id));
  return [...builtIn, ...submitted.filter((c) => !ids.has(c.id))]
    .map((c) => ({ ...c, ...(tally.components[c.id] || EMPTY) }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}
const find = (id) => components().find((c) => c.id === id);
const isSubmitted = (c) => submitted.some((s) => s.id === c.id);

// Components run in a sandboxed iframe: scripts work, but they get an opaque
// origin and cannot touch this page, its storage, or the API as the voter.
function previewDoc({ html, css, js }) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif}
    ${css}</style>${html}<script>${js.replace(/<\/script/gi, '<\\/script')}<\/script>`;
}

/* ---- Board ---- */

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

  // The card preview is display-only; clicking it opens the full-screen editor.
  const href = `#/c/${encodeURIComponent(c.id)}`;
  const frame = el('iframe', { className: 'preview', title: `${c.name} preview`, loading: 'lazy', tabIndex: -1 });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = previewDoc(c);
  const open = el('a', { className: 'open', href }, frame, el('span', { className: 'open-hint', textContent: 'Open editor' }));
  open.setAttribute('aria-label', `Open ${c.name} full screen with its HTML, CSS and JS`);

  const body = el(
    'div',
    { className: 'card-body' },
    el(
      'div',
      { className: 'card-head' },
      el(
        'div',
        {},
        el('h2', {}, el('a', { className: 'name-link', href, textContent: c.name })),
        el('p', { className: 'description', textContent: c.description })
      ),
      upvote
    )
  );
  if (isSubmitted(c)) body.append(el('p', { className: 'added-by', textContent: `Added by ${c.author || 'Anonymous'}` }));

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

function renderBoard() {
  teamList.replaceChildren(...tally.teams.map((t) => el('option', { value: t })));
  const all = components();
  if (!all.length) {
    grid.replaceChildren(el('p', { className: 'empty', textContent: 'No components yet. Use "New component" to add the first one.' }));
    return;
  }
  grid.replaceChildren(...all.map(renderCard));
}

/* ---- Full-screen editor ---- */

const editors = {};
for (const pane of document.querySelectorAll('.pane')) {
  const lang = pane.dataset.lang;
  const textarea = pane.querySelector('textarea');
  const pre = pane.querySelector('pre');
  editors[lang] = { textarea, pre, code: pane.querySelector('code') };

  textarea.addEventListener('input', () => {
    paint(lang);
    onEdit();
  });
  textarea.addEventListener('scroll', () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      textarea.blur(); // lets keyboard users leave the editor, since Tab indents
    } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input'));
    }
  });
}

function paint(lang) {
  const { textarea, code } = editors[lang];
  // The trailing newline keeps the last line's height in step with the textarea.
  code.innerHTML = highlightCode(textarea.value, lang) + '\n';
}

const currentCode = () => Object.fromEntries(LANGS.map((lang) => [lang, editors[lang].textarea.value]));
const isDirty = () => LANGS.some((lang) => editors[lang].textarea.value !== pen.base[lang]);

function setCode(code) {
  for (const lang of LANGS) {
    const { textarea } = editors[lang];
    textarea.value = code[lang];
    textarea.scrollTop = textarea.scrollLeft = 0;
    paint(lang);
  }
}

let previewTimer;
function runPreview() {
  clearTimeout(previewTimer);
  penPreview.srcdoc = previewDoc(currentCode());
}

function onEdit() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 300);
  if (!pen.component) store(DRAFT_KEY, currentCode());
  updatePenBar();
}

function updatePenBar() {
  const c = pen.component && find(pen.component.id);
  const dirty = isDirty();
  $('pen-name').textContent = c ? c.name : 'New component';
  $('pen-meta').textContent = !c
    ? 'Write some HTML, CSS and JS, then add it to the board.'
    : dirty
      ? 'You are trying out changes. They are not saved unless you save them as a new component.'
      : c.description || 'Edit the code to try changes live.';
  $('pen-reset').hidden = !dirty;
  $('pen-save').textContent = c ? 'Save as new component' : 'Add to board';
  $('pen-save').hidden = Boolean(c) && !dirty;
  $('pen-vote').hidden = !c;
  if (c) {
    const voted = hasVoted(c.id);
    $('pen-vote').disabled = voted;
    $('pen-vote').textContent = voted ? `▲ ${c.votes} · You voted` : `▲ Upvote · ${c.votes}`;
  }
}

function setTab(tab) {
  penEl.dataset.tab = tab;
  for (const button of document.querySelectorAll('.pen-tabs .tab')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
}
for (const button of document.querySelectorAll('.pen-tabs .tab')) {
  button.addEventListener('click', () => setTab(button.dataset.tab));
}

function openPen(component) {
  const base = component ? { html: component.html, css: component.css, js: component.js } : STARTER;
  pen = { component, base };
  board.hidden = true;
  penEl.hidden = false;
  setTab('html');
  setCode(component ? base : store(DRAFT_KEY) || base);
  runPreview();
  updatePenBar();
  document.title = `${component ? component.name : 'New component'} · Component Vote`;
  window.scrollTo(0, 0);
}

function closePen() {
  pen = null;
  clearTimeout(previewTimer);
  penPreview.srcdoc = '';
  penEl.hidden = true;
  board.hidden = false;
  document.title = 'Component Vote';
}

$('pen-reset').addEventListener('click', () => {
  if (!pen.component) store(DRAFT_KEY, null);
  setCode(pen.base);
  runPreview();
  updatePenBar();
});
$('pen-vote').addEventListener('click', () => openVote(find(pen.component.id)));

// #/c/<id> opens a component, #/new starts a blank one, anything else is the board.
function route() {
  const match = location.hash.match(/^#\/c\/(.+)$/);
  const component = match && find(decodeURIComponent(match[1]));
  if (component) openPen(component);
  else if (location.hash === '#/new') openPen(null);
  else closePen();
}
window.addEventListener('hashchange', route);

/* ---- Dialogs ---- */

function showError(form, message) {
  const box = form.querySelector('.error');
  box.textContent = message;
  box.hidden = !message;
}

async function postJson(url, body, fallbackMessage) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

// Wires a dialog's form: validates one required field, posts, and reports errors inline.
function handleSubmit(form, requiredField, requiredMessage, send) {
  form[requiredField].addEventListener('input', () => showError(form, ''));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form[requiredField].value.trim()) {
      showError(form, requiredMessage);
      form[requiredField].focus();
      return;
    }
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      await send();
    } catch (err) {
      showError(form, err.message || 'Something went wrong. Please try again.');
    } finally {
      submit.disabled = false;
    }
  });
}

for (const dialog of [voteDialog, saveDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close(); // backdrop click
  });
}

function openVote(component) {
  voteTargetId = component.id;
  $('vote-target').textContent = component.name;
  voteForm.reset();
  showError(voteForm, '');
  const profile = store(PROFILE_KEY) || {};
  voteForm.team.value = profile.team || '';
  voteForm.name.value = profile.name || '';
  voteDialog.showModal();
  (voteForm.team.value ? voteForm.comment : voteForm.team).focus();
}
$('vote-cancel').addEventListener('click', () => voteDialog.close());

handleSubmit(voteForm, 'team', 'Please tell us which team you are on.', async () => {
  const team = voteForm.team.value.trim();
  tally = await postJson(
    `/api/components/${encodeURIComponent(voteTargetId)}/votes`,
    { team, name: voteForm.name.value, comment: voteForm.comment.value },
    'Could not save your vote.'
  );
  store(VOTED_KEY, [...votedIds(), voteTargetId]);
  store(PROFILE_KEY, { ...(store(PROFILE_KEY) || {}), team, name: voteForm.name.value.trim() });
  voteDialog.close();
  renderBoard();
  if (pen) updatePenBar();
});

$('pen-save').addEventListener('click', () => {
  saveForm.reset();
  showError(saveForm, '');
  if (pen.component) saveForm.name.value = `${pen.component.name} remix`.slice(0, 80);
  saveForm.author.value = (store(PROFILE_KEY) || {}).name || '';
  saveDialog.showModal();
  saveForm.name.focus();
  saveForm.name.select();
});
$('save-cancel').addEventListener('click', () => saveDialog.close());

handleSubmit(saveForm, 'name', 'Please give the component a name.', async () => {
  const wasNew = !pen.component;
  const { component } = await postJson(
    '/api/components',
    { name: saveForm.name.value, description: saveForm.description.value, author: saveForm.author.value, ...currentCode() },
    'Could not add the component.'
  );
  submitted.push(component);
  if (wasNew) store(DRAFT_KEY, null);
  store(PROFILE_KEY, { ...(store(PROFILE_KEY) || {}), name: saveForm.author.value.trim() });
  saveDialog.close();
  renderBoard();
  location.hash = `#/c/${encodeURIComponent(component.id)}`;
});

/* ---- Startup ---- */

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function load() {
  const [starter, added, votes] = await Promise.allSettled([
    getJson('components.json'),
    getJson('/api/components'),
    getJson('/api/votes'),
  ]);
  if (starter.status === 'fulfilled') builtIn = starter.value.components;
  if (added.status === 'fulfilled') submitted = added.value.components;
  if (votes.status === 'fulfilled') tally = votes.value;

  // Still show whatever loaded if the database is unreachable.
  const problems = [];
  if (starter.status === 'rejected') problems.push('The starter components could not be loaded.');
  if (added.status === 'rejected') problems.push('Components people added could not be loaded.');
  if (votes.status === 'rejected') problems.push('Votes could not be loaded, so counts may be missing.');
  notice.textContent = problems.join(' ');
  notice.hidden = !problems.length;

  renderBoard();
  route();
}

load();
