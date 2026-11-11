# component-vote

A simple voting board for HTML/CSS/JS components, hosted on [Spacefast](https://spacefast.com/docs/).
People upvote a component, say which team they're on, and can leave a comment.
Giving a name is optional. Clicking a component opens a live preview with its
HTML, CSS and JS source.

## Layout

```
components/            one folder per component (the source of truth)
site/                  what gets published to Spacefast
  index.html, style.css, app.js   the page
  components.json      generated from components/ (commit it)
  handler.js           Spacefast Functions worker: the /api routes
  sf.jsonc             Spacefast config
dev-server.js          local stand-in for Spacefast
```

## Where the votes are stored

In the Space's own database on Spacefast. `site/handler.js` runs as a
[Functions](https://spacefast.com/docs/functions/) worker and reaches the
[database](https://spacefast.com/docs/database/) through `env.DB`. There is no
connection string to configure. The worker creates its one table, `votes`, on
first use. To look at the rows, open the Space's **Database** page in the
Spacefast dashboard, or run `sf db console`.

## Publish to Spacefast

```bash
npm install -g spacefast
```

```bash
sf login
```

```bash
sf publish site
```

`site/sf.jsonc` points at the existing Space, https://lively-dune.space.fast/, so this publishes a new version of it.

## Run locally

```bash
npm run dev
```

Then open http://localhost:3000 (set `PORT` to change it). Needs Node 22.5+, no
dependencies. Locally the worker runs against a SQLite file at
`data/votes.sqlite` instead of the Spacefast database, so local votes never
reach the live board.

## Add a component

Create a folder in `components/`:

```
components/my-widget/
  index.html   # required: the markup
  style.css    # optional
  script.js    # optional
  meta.json    # optional: { "name": "My Widget", "description": "..." }
```

Then regenerate the bundle the page loads, commit, and publish:

```bash
npm run components
```

Each component is previewed in a sandboxed iframe, so its CSS and JS can't
affect the page or other components.

## How voting works

- **Team** is required, **comment** and **name** are optional. Votes without a name show as "Anonymous".
- There are no accounts. A browser is stopped from voting twice for the same
  component via `localStorage`, which is a courtesy guard and not tamper-proof.

## Test

```bash
npm test
```
