const $ = (id) => document.getElementById(id);
const grid = $('components');
const notice = $('notice');
const board = $('board');
const penEl = $('pen');
const penPreview = $('pen-preview');
const resultsEl = $('results');
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
let submitted = []; // components added or edited on the page, from the database
let tally = { components: {}, teams: [] }; // votes, from the database
let voteTargetId = null;
let pen = null; // { component | null, base: { html, css, js } } while the editor is open
let saveMode = 'create'; // 'create' (add or save as new) | 'edit' (save changes to the open component)

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
  // A component saved from the page replaces the starter copy with the same id.
  const byId = new Map(builtIn.map((c) => [c.id, c]));
  for (const c of submitted) byId.set(c.id, c);
  return [...byId.values()]
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

  // The preview is live: it is not wrapped in a link, so clicks and typing reach the component.
  const href = `#/c/${encodeURIComponent(c.id)}`;
  const frame = el('iframe', { className: 'preview', title: `${c.name} preview`, loading: 'lazy' });
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = previewDoc(c);
  const openLink = el('a', { className: 'open-link', href, textContent: 'Open full screen and view code →' });

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

  body.append(openLink);
  return el('article', { className: 'card' }, frame, body);
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

/* ---- Results ---- */

function barRow(label, count, max) {
  const bar = el('div', { className: 'bar' });
  bar.append(el('span'));
  bar.firstChild.style.width = `${max ? (count / max) * 100 : 0}%`;
  return el('li', {}, el('span', { textContent: label }), bar, el('strong', { textContent: String(count) }));
}

function renderResults() {
  const all = components();
  const totalVotes = all.reduce((n, c) => n + c.votes, 0);
  const totalComments = all.reduce((n, c) => n + c.comments.length, 0);

  const stat = (value, label) => el('div', { className: 'stat' }, el('strong', { textContent: String(value) }), el('span', { textContent: label }));
  $('results-stats').replaceChildren(
    stat(all.length, 'components'),
    stat(totalVotes, 'upvotes'),
    stat(tally.teams.length, 'teams'),
    stat(totalComments, 'comments')
  );
  $('results-empty').hidden = totalVotes > 0;

  const max = Math.max(1, ...all.map((c) => c.votes));
  $('results-ranking').replaceChildren(
    ...all.map((c, i) => {
      const top = Object.entries(c.teams).sort((a, b) => b[1] - a[1])[0];
      const bar = el('div', { className: 'bar' });
      bar.append(el('span'));
      bar.firstChild.style.width = `${(c.votes / max) * 100}%`;
      const notes = `${c.comments.length} comment${c.comments.length === 1 ? '' : 's'}${top ? ` · top team: ${top[0]}` : ''}`;
      return el(
        'li',
        { className: 'rank-row' },
        el('span', { className: 'rank', textContent: `#${i + 1}` }),
        el(
          'div',
          { className: 'rank-main' },
          el('a', { className: 'rank-name', href: `#/c/${encodeURIComponent(c.id)}`, textContent: c.name }),
          bar,
          el('small', { textContent: notes })
        ),
        el('strong', { className: 'rank-votes', textContent: `▲ ${c.votes}` })
      );
    })
  );

  const byTeam = {};
  for (const c of all) for (const [team, n] of Object.entries(c.teams)) byTeam[team] = (byTeam[team] || 0) + n;
  const teamRows = Object.entries(byTeam).sort((a, b) => b[1] - a[1]);
  const maxTeam = Math.max(1, ...teamRows.map(([, n]) => n));
  $('results-teams').replaceChildren(...teamRows.map(([team, n]) => barRow(team, n, maxTeam)));
  $('results-teams-empty').hidden = teamRows.length > 0;

  const recent = all
    .flatMap((c) => c.comments.map((m) => ({ ...m, component: c })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  $('results-comments').replaceChildren(
    ...recent.map((m) =>
      el(
        'li',
        {},
        el('p', { textContent: m.comment }),
        el('span', { className: 'by', textContent: `${m.name || 'Anonymous'} · ${m.team} · on ${m.component.name}` })
      )
    )
  );
  $('results-comments-empty').hidden = recent.length > 0;
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
      ? 'Unsaved changes. "Save changes" updates it for everyone; "Save as new" keeps the original too.'
      : c.description || 'Edit the code, then save your changes for everyone.';
  $('pen-reset').hidden = !dirty;
  $('pen-update').hidden = !c;
  $('pen-save').hidden = c ? !dirty : false;
  $('pen-save').textContent = c ? 'Save as new' : 'Add to board';
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
  resultsEl.hidden = true;
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
  resultsEl.hidden = true;
  board.hidden = false;
  document.title = 'Component Vote';
}

function openResults() {
  pen = null;
  clearTimeout(previewTimer);
  penPreview.srcdoc = '';
  penEl.hidden = true;
  board.hidden = true;
  resultsEl.hidden = false;
  renderResults();
  document.title = 'Results · Component Vote';
  window.scrollTo(0, 0);
}

$('pen-reset').addEventListener('click', () => {
  if (!pen.component) store(DRAFT_KEY, null);
  setCode(pen.base);
  runPreview();
  updatePenBar();
});
$('pen-vote').addEventListener('click', () => openVote(find(pen.component.id)));

// #/c/<id> opens a component, #/new starts a blank one, #/results shows the results, anything else is the board.
function route() {
  const match = location.hash.match(/^#\/c\/(.+)$/);
  const component = match && find(decodeURIComponent(match[1]));
  if (component) openPen(component);
  else if (location.hash === '#/new') openPen(null);
  else if (location.hash === '#/results') openResults();
  else closePen();
}
window.addEventListener('hashchange', route);

/* ---- Dialogs ---- */

function showError(form, message) {
  const box = form.querySelector('.error');
  box.textContent = message;
  box.hidden = !message;
}

async function sendJson(method, url, body, fallbackMessage) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

// Wires a dialog's form: validates one required field, sends, and reports errors inline.
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
  tally = await sendJson(
    'POST',
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

// One dialog covers both "add or save as new" and "save changes to this component".
function openSaveDialog(mode) {
  saveMode = mode;
  saveForm.reset();
  showError(saveForm, '');
  const c = pen.component;
  const editing = mode === 'edit';
  $('save-title').textContent = editing ? `Save changes to ${c.name}` : c ? 'Save as new component' : 'Add this component';
  $('save-submit').textContent = editing ? 'Save changes' : 'Add component';
  // An edit never changes who added the component, so the author field is only for new ones.
  saveForm.author.closest('label').hidden = editing;
  if (editing) {
    saveForm.name.value = c.name;
    saveForm.description.value = c.description || '';
  } else {
    saveForm.name.value = c ? `${c.name} remix`.slice(0, 80) : '';
    saveForm.author.value = (store(PROFILE_KEY) || {}).name || '';
  }
  saveDialog.showModal();
  saveForm.name.focus();
  saveForm.name.select();
}
$('pen-save').addEventListener('click', () => openSaveDialog('create'));
$('pen-update').addEventListener('click', () => openSaveDialog('edit'));
$('save-cancel').addEventListener('click', () => saveDialog.close());

handleSubmit(saveForm, 'name', 'Please give the component a name.', async () => {
  const fields = {
    name: saveForm.name.value,
    description: saveForm.description.value,
    author: saveForm.author.value,
    ...currentCode(),
  };

  if (saveMode === 'edit') {
    const { component } = await sendJson(
      'PUT',
      `/api/components/${encodeURIComponent(pen.component.id)}`,
      fields,
      'Could not save your changes.'
    );
    submitted = submitted.filter((s) => s.id !== component.id).concat(component);
    pen.component = component;
    pen.base = currentCode();
    saveDialog.close();
    renderBoard();
    updatePenBar();
    return;
  }

  const wasNew = !pen.component;
  const { component } = await sendJson('POST', '/api/components', fields, 'Could not add the component.');
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
