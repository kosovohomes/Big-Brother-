// Codemod: wrap every requireOrg route handler with withOrg(...) so the
// Postgres request scope (RLS GUCs) spans the handler body (Phase A A1.1).
// Idempotent — safe to re-run.
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = process.argv.slice(2);
const HANDLERS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

for (const file of FILES) {
  let src = readFileSync(file, 'utf8');
  if (!src.includes('requireOrg') || src.includes('withOrg(')) {
    if (!src.includes('requireOrg')) { console.log(`skip ${file} (no requireOrg)`); continue; }
  }
  let changed = false;

  // 1. add withOrg to the api-helpers import
  if (!src.includes('withOrg')) {
    src = src.replace(/import \{([^}]*)\} from '@\/lib\/api-helpers';/, (m, names) => {
      changed = true;
      return `import {${names.trim()}, withOrg } from '@/lib/api-helpers';`;
    });
    if (!changed) { console.log(`WARN ${file}: no api-helpers import found`); continue; }
  }

  // 2. wrap each exported handler
  for (const h of HANDLERS) {
    const re = new RegExp(`export async function ${h}\\s*\\(([^)]*)\\)\\s*\\{`);
    const m = src.match(re);
    if (!m) continue;
    // find the matching closing brace of this function
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    let inStr = null;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      const prev = src[i - 1];
      if (inStr) {
        if (ch === inStr && prev !== '\\') inStr = null;
      } else if (ch === "'" || ch === '"' || ch === '`') inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) { console.log(`WARN ${file}:${h}: unbalanced braces`); continue; }
    const end = i - 1; // index of the closing brace
    const body = src.slice(m.index, end); // from 'export async...' to before '}'
    const wrapped = body
      .replace(`export async function ${h}`, `export const ${h} = withOrg(async function`)
      + '\n});';
    src = src.slice(0, m.index) + wrapped + src.slice(end + 1);
    changed = true;
  }

  if (changed) {
    writeFileSync(file, src);
    console.log(`wrapped ${file}`);
  } else {
    console.log(`unchanged ${file}`);
  }
}
