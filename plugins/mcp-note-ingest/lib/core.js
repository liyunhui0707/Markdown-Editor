const fs = require('fs');
const path = require('path');

const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 200_000;
const MAX_TAG_COUNT = 20;
const MAX_TAG_LENGTH = 40;

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function escapeYamlString(value) {
  return String(value).replace(/"/g, '\\"');
}

function normalizeTags(tags) {
  let result = [];

  if (!tags) {
    return [];
  }

  if (Array.isArray(tags)) {
    result = tags.map((tag) => String(tag).trim()).filter(Boolean);
  } else if (typeof tags === 'string') {
    result = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  result = result
    .map((tag) => tag.slice(0, MAX_TAG_LENGTH))
    .slice(0, MAX_TAG_COUNT);

  return Array.from(new Set(result));
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function validateVaultPath(vaultPath) {
  if (!vaultPath) {
    throw new Error('vault_path is required.');
  }

  if (!path.isAbsolute(vaultPath)) {
    throw new Error('vault_path must be an absolute path.');
  }

  ensureDirExists(vaultPath);
}

function validateCreatedAt(createdAt) {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    throw new Error('created_at must be a valid ISO date string.');
  }

  return date;
}

function normalizeTitle(rawTitle) {
  const title = String(rawTitle || '').trim();

  if (!title) {
    throw new Error('title is required.');
  }

  return title.slice(0, MAX_TITLE_LENGTH);
}

function normalizeBody(rawBody) {
  const body = String(rawBody || '').trim();

  if (!body) {
    return 'No body provided.';
  }

  return body.slice(0, MAX_BODY_LENGTH);
}

function normalizeSource(rawSource) {
  const source = String(rawSource || '').trim().toLowerCase();

  if (!source) {
    throw new Error('source is required.');
  }

  return source;
}

function normalizeModel(rawModel) {
  return rawModel ? String(rawModel).trim() : '';
}

function buildFrontmatter({ source, createdAt, model, tags }) {
  const lines = [];

  if (source) {
    lines.push(`source: "${escapeYamlString(source)}"`);
  }

  if (createdAt) {
    lines.push(`created_at: "${escapeYamlString(createdAt)}"`);
  }

  if (model) {
    lines.push(`model: "${escapeYamlString(model)}"`);
  }

  const normalizedTags = normalizeTags(tags);
  if (normalizedTags.length > 0) {
    const serializedTags = normalizedTags
      .map((tag) => `"${escapeYamlString(tag)}"`)
      .join(', ');
    lines.push(`tags: [${serializedTags}]`);
  }

  if (lines.length === 0) {
    return '';
  }

  return `---\n${lines.join('\n')}\n---\n\n`;
}

function buildMarkdownDocument({ title, body, source, createdAt, model, tags }) {
  const frontmatter = buildFrontmatter({
    source,
    createdAt,
    model,
    tags
  });

  return `${frontmatter}# ${title}\n\n${body}\n`;
}

function buildTimestampPart(date) {
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('') +
    '-' +
    [
      String(date.getUTCHours()).padStart(2, '0'),
      String(date.getUTCMinutes()).padStart(2, '0'),
      String(date.getUTCSeconds()).padStart(2, '0')
    ].join('');
}

function buildUniqueFileName(targetDir, baseFileName) {
  const extension = '.md';
  let candidate = `${baseFileName}${extension}`;
  let counter = 1;

  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${baseFileName}-${counter}${extension}`;
    counter += 1;
  }

  return candidate;
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  MAX_TAG_COUNT,
  MAX_TAG_LENGTH,
  sanitizeFileName,
  escapeYamlString,
  normalizeTags,
  ensureDirExists,
  validateVaultPath,
  validateCreatedAt,
  normalizeTitle,
  normalizeBody,
  normalizeSource,
  normalizeModel,
  buildFrontmatter,
  buildMarkdownDocument,
  buildTimestampPart,
  buildUniqueFileName
};