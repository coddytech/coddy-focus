// Builds the zip to upload to the Chrome Web Store: the src/ folder as it
// is, after the checks pass. There is no build step, so the code in the
// store is the code in this repository.
//
// Run: npm run pack

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'src', 'manifest.json'), 'utf8'));

execFileSync('node', ['scripts/check.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync('node', ['--test'], { cwd: root, stdio: 'inherit' });

const out = join(root, 'dist', `coddy-focus-${version}.zip`);
mkdirSync(join(root, 'dist'), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.*', '-x', '*/.*'], { cwd: join(root, 'src'), stdio: 'inherit' });
console.log(`packed ${out}`);
