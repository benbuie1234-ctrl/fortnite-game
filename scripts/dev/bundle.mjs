/** Dev helper: bundle a shared TS module so plain node can import it. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function load(entry) {
  const out = join(mkdtempSync(join(tmpdir(), 'clutch-')), 'bundle.mjs');
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=warning'], { stdio: 'inherit' });
  return import(out);
}
