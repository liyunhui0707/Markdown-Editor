import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadManifest } from '../test/helpers/tiptap-corpus-manifest.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultManifest = path.join(
  path.dirname(toolsDir),
  'test',
  'fixtures',
  'tiptap-roundtrip',
  'manifest.mjs',
);

function parseArgs(args) {
  if (args.length === 0) return defaultManifest;
  if (args[0] !== '--manifest') throw new TypeError(`unknown argument: ${args[0]}`);
  if (args.length === 1 || !args[1]) throw new TypeError('--manifest requires a path');
  if (args.length > 2) throw new TypeError(`unknown argument: ${args[2]}`);
  return path.resolve(args[1]);
}

async function main() {
  const manifestPath = parseArgs(process.argv.slice(2));
  const entries = await loadManifest(manifestPath);
  const blockers = entries
    .filter((entry) => entry.contract === 'blocker')
    .sort((a, b) => a.id.localeCompare(b.id));

  if (blockers.length === 0) {
    process.stdout.write('READY: 0 blockers\n');
    return;
  }
  for (const entry of blockers) {
    process.stdout.write(`BLOCKER ${entry.id}: ${entry.reason}\n`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`READINESS ERROR: ${error.message}\n`);
  process.exitCode = 1;
});
