import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const generatedPaths = [
  'lib/toastui-bundle.js',
  'lib/cm6-bundle.js',
  'lib/tiptap-bundle.js',
  'lib/spike-cm6-bundle.js',
  'lib/vendor/katex',
  'lib/vendor/highlight',
  'lib/vendor/mermaid',
];

const result = spawnSync(
  'git',
  ['status', '--porcelain=v1', '--untracked-files=all', '--', ...generatedPaths],
  { cwd: desktopRoot, encoding: 'utf8' },
);

if (result.error) {
  console.error(`[generated] unable to inspect generated files: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`[generated] git status terminated by signal ${result.signal}`);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stderr) process.stderr.write(result.stderr);
  console.error(`[generated] git status exited with code ${result.status}`);
  process.exit(result.status || 1);
}

const changes = result.stdout.trim();
if (changes) {
  console.error('[generated] tracked outputs are stale:');
  console.error(changes);
  console.error('[generated] run npm run build:generated and commit the resulting outputs.');
  process.exit(1);
}

console.log('[generated] tracked outputs are reproducible and clean.');
