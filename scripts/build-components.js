// Bundles every folder in ./components into site/components.json, the file the
// page loads. Run with `npm run components` after adding or editing a component.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPONENTS_DIR = path.join(ROOT, 'components');
export const OUTPUT = path.join(ROOT, 'site', 'components.json');

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Each folder is one component:
//   index.html (required), style.css, script.js, meta.json { name, description }
export function loadComponents() {
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9_-]{0,99}$/i.test(d.name))
    .map((d) => {
      const dir = path.join(COMPONENTS_DIR, d.name);
      const meta = JSON.parse(readIfExists(path.join(dir, 'meta.json')) || '{}');
      return {
        id: d.name,
        name: meta.name || d.name,
        description: meta.description || '',
        html: readIfExists(path.join(dir, 'index.html')),
        css: readIfExists(path.join(dir, 'style.css')),
        js: readIfExists(path.join(dir, 'script.js')),
      };
    })
    .filter((c) => c.html)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function render() {
  return JSON.stringify({ components: loadComponents() }, null, 2) + '\n';
}

export function build() {
  fs.writeFileSync(OUTPUT, render());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build();
  console.log(`Wrote ${loadComponents().length} components to ${path.relative(ROOT, OUTPUT)}`);
}
