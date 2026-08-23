import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTRACTS = new Set(['normalized', 'verbatim', 'blocker']);
const TRANSFORMS = new Set(['crlf', 'strip-final-newline']);
const COMMON_FIELDS = ['id', 'category', 'contract', 'inputPath', 'transform'];
const CONTRACT_FIELDS = {
  normalized: ['expectedPath', 'requiredFragments'],
  verbatim: ['expectedPath', 'requiredFragments'],
  blocker: ['currentLossyPath', 'desiredPath', 'reason', 'requiredFragments'],
};

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
);

const requireText = (entry, field, label) => {
  if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
    throw new TypeError(`${label}.${field} must be a non-empty string`);
  }
};

const validateFragments = (value, label, required) => {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label}.requiredFragments must be a non-empty array`);
  }
  const seen = new Set();
  const fragments = value.map((fragment, index) => {
    if (typeof fragment !== 'string' || fragment.trim() === '') {
      throw new TypeError(`${label}.requiredFragments[${index}] must be a non-empty string`);
    }
    if (seen.has(fragment)) {
      throw new TypeError(`${label}.requiredFragments must not contain duplicates`);
    }
    seen.add(fragment);
    return fragment;
  });
  return Object.freeze(fragments);
};

const resolveFixtureFile = (entry, field, fixtureRoot, io, label) => {
  requireText(entry, field, label);
  const relativePath = entry[field];
  if (path.isAbsolute(relativePath)) {
    throw new TypeError(`${label}.${field} must be relative to the fixture root`);
  }
  const resolved = path.resolve(fixtureRoot, relativePath);
  const relative = path.relative(fixtureRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError(`${label}.${field} escapes the fixture root`);
  }
  if (!io.fileExists(resolved)) {
    throw new TypeError(`${label} missing ${field}: ${relativePath}`);
  }
  if (io.isSymbolicLink(resolved)) {
    throw new TypeError(`${label}.${field} must not name a symbolic link`);
  }
  if (!io.isRegularFile(resolved)) {
    throw new TypeError(`${label}.${field} must name a regular file`);
  }
  return resolved;
};

export function validateManifest(entries, fixtureRoot, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('manifest must be a non-empty array');
  }
  const root = path.resolve(fixtureRoot);
  const io = {
    fileExists: options.fileExists || fs.existsSync,
    isSymbolicLink: options.isSymbolicLink || ((filePath) => (
      fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()
    )),
    isRegularFile: options.isRegularFile || ((filePath) => fs.statSync(filePath).isFile()),
    readFile: options.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8')),
  };
  const ids = new Set();

  const validated = entries.map((entry, index) => {
    const label = `manifest[${index}]`;
    if (!isPlainObject(entry)) throw new TypeError(`${label} must be a plain object`);

    for (const field of ['id', 'category', 'inputPath']) requireText(entry, field, label);
    if (ids.has(entry.id)) throw new TypeError(`duplicate manifest id: ${entry.id}`);
    ids.add(entry.id);

    if (!CONTRACTS.has(entry.contract)) {
      throw new TypeError(`${label}.contract must be normalized, verbatim, or blocker`);
    }
    if (entry.transform !== undefined && !TRANSFORMS.has(entry.transform)) {
      throw new TypeError(`${label}.transform must be crlf or strip-final-newline`);
    }

    const allowed = new Set([...COMMON_FIELDS, ...CONTRACT_FIELDS[entry.contract]]);
    for (const field of Object.keys(entry)) {
      if (!allowed.has(field)) throw new TypeError(`${label} has unexpected field ${field}`);
    }

    const resolvedPaths = {
      inputPath: resolveFixtureFile(entry, 'inputPath', root, io, label),
    };
    if (entry.contract === 'normalized' || entry.contract === 'verbatim') {
      resolvedPaths.expectedPath = resolveFixtureFile(entry, 'expectedPath', root, io, label);
    } else {
      requireText(entry, 'reason', label);
      resolvedPaths.currentLossyPath = resolveFixtureFile(entry, 'currentLossyPath', root, io, label);
      resolvedPaths.desiredPath = resolveFixtureFile(entry, 'desiredPath', root, io, label);
      if (resolvedPaths.currentLossyPath === resolvedPaths.desiredPath) {
        throw new TypeError(`${label} blocker output paths must be distinct`);
      }
      if (String(io.readFile(resolvedPaths.currentLossyPath)) === String(io.readFile(resolvedPaths.desiredPath))) {
        throw new TypeError(`${label} blocker output contents must be distinct`);
      }
    }

    const fragments = validateFragments(
      entry.requiredFragments,
      label,
      entry.contract === 'verbatim' || entry.contract === 'blocker',
    );
    const copy = { ...entry, resolvedPaths: Object.freeze(resolvedPaths) };
    if (fragments) copy.requiredFragments = fragments;
    return Object.freeze(copy);
  });

  return Object.freeze(validated);
}

export async function loadManifest(manifestPath, options = {}) {
  const absolutePath = path.resolve(manifestPath);
  const url = `${pathToFileURL(absolutePath).href}?t=${Date.now()}-${Math.random()}`;
  let loaded;
  try {
    loaded = await import(url);
  } catch (error) {
    throw new Error(`unable to load manifest ${absolutePath}: ${error.message}`);
  }
  const entries = loaded.default;
  return validateManifest(entries, path.dirname(absolutePath), options);
}
