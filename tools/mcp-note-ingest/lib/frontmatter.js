function dequote(s) {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    const inner = trimmed.slice(1, -1);
    return inner
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function tokenizeYamlArray(inner) {
  const out = [];
  let i = 0;
  let cur = '';
  let inQuote = null;
  let escape = false;
  while (i < inner.length) {
    const ch = inner[i];
    if (escape) {
      cur += ch;
      escape = false;
      i++;
      continue;
    }
    if (ch === '\\' && inQuote) {
      cur += ch;
      escape = true;
      i++;
      continue;
    }
    if (inQuote) {
      if (ch === inQuote) {
        cur += ch;
        inQuote = null;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      cur += ch;
      inQuote = ch;
      i++;
      continue;
    }
    if (ch === ',') {
      const item = dequote(cur);
      if (item !== '') out.push(item);
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  const last = dequote(cur);
  if (last !== '') out.push(last);
  return out;
}

function parseFrontmatter(text) {
  if (typeof text !== 'string') {
    return { frontmatter: {}, body: '', warnings: [] };
  }
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: {}, body: text, warnings: [] };
  }
  const lines = normalized.split('\n');
  // lines[0] === '---'; find the next standalone '---' line.
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    return { frontmatter: {}, body: text, warnings: [] };
  }

  const frontmatter = {};
  const warnings = [];
  let parsedAny = false;
  let i = 1;
  while (i < closeIdx) {
    const trimmed = lines[i].trim();
    if (trimmed === '') { i++; continue; }
    const match = trimmed.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!match) { i++; continue; }
    const key = match[1];
    const rawValue = match[2];
    if (rawValue === '') {
      // Possible block sequence: indented lines starting with '- value'.
      const items = [];
      let j = i + 1;
      while (j < closeIdx) {
        const rawLine = lines[j];
        const itemMatch = rawLine.match(/^[ \t]+-[ \t]+(.*)$/);
        if (!itemMatch) break;
        const item = dequote(itemMatch[1]);
        if (item !== '') items.push(item);
        j++;
      }
      if (items.length > 0) {
        frontmatter[key] = items;
      } else {
        frontmatter[key] = '';
      }
      i = j;
    } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const arrInner = rawValue.slice(1, -1);
      frontmatter[key] = tokenizeYamlArray(arrInner);
      i++;
    } else {
      frontmatter[key] = dequote(rawValue);
      i++;
    }
    parsedAny = true;
  }

  // Skip the closing fence; if a blank line follows, drop one blank line.
  let bodyStart = closeIdx + 1;
  if (lines[bodyStart] === '') bodyStart += 1;
  const body = lines.slice(bodyStart).join('\n');

  if (!parsedAny && closeIdx > 1) {
    warnings.push('frontmatter_parse_failed');
  }
  return { frontmatter, body, warnings };
}

module.exports = { parseFrontmatter, dequote, tokenizeYamlArray };
