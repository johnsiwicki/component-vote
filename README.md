# component-vote

A simple voting board for HTML/CSS/JS components. People upvote a component,
say which team they're on, and can leave a comment. Giving a name is optional.

## Run

```bash
npm start
```

Then open http://localhost:3000 (set `PORT` to change it). No dependencies to install; needs Node 18+.

## Add a component

Create a folder in `components/`:

```
components/my-widget/
  index.html   # required: the markup
  style.css    # optional
  script.js    # optional
  meta.json    # optional: { "name": "My Widget", "description": "..." }
```

It appears on the board on the next page load. Each component is previewed in a
sandboxed iframe, so its CSS and JS can't affect the page or other components.

## How voting works

- **Team** is required, **comment** and **name** are optional. Votes without a name show as "Anonymous".
- Votes are stored in `data/votes.json` (git-ignored; override with `DATA_FILE`).
- There are no accounts. A browser is stopped from voting twice for the same
  component via `localStorage`, which is a courtesy guard and not tamper-proof.

## Test

```bash
npm test
```
