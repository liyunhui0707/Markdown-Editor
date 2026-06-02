// Shannon entropy threshold (nats/char) for the dotenv_high_entropy rule.
// Calibrated to catch base64-encoded JWTs (~3.16) while rejecting typical
// short configuration values like NODE_ENV=production. The 16-char minimum
// length in the regex provides the primary low-pass filter; entropy is the
// secondary check against long-but-meaningful values.
const DOTENV_ENTROPY_THRESHOLD = 3.0;

function shannonEntropy(s) {
  if (!s || s.length === 0) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  const n = s.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log(p);
  }
  return h;
}

const RULES = [
  {
    kind: 'anthropic_key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g
  },
  {
    kind: 'github_pat',
    regex: /\bgh[pso]_[A-Za-z0-9]{36,}\b/g
  },
  {
    kind: 'aws_access_key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    // openai_key is broad ('sk-' + 32 alphanumeric); apply LAST so the more
    // specific sk-ant- rule wins on overlap.
    kind: 'openai_key',
    regex: /\bsk-[A-Za-z0-9]{32,}\b/g
  },
  {
    kind: 'dotenv_high_entropy',
    regex: /^[A-Z][A-Z0-9_]{2,}=([^\s]{16,})$/gm,
    post: (match, captures) => shannonEntropy(captures[0]) > DOTENV_ENTROPY_THRESHOLD
  }
];

function applyRule(text, rule, kinds) {
  let redacted_chars = 0;
  let out = '';
  let lastEnd = 0;

  rule.regex.lastIndex = 0;
  let m;
  while ((m = rule.regex.exec(text)) !== null) {
    if (rule.post) {
      const captures = m.slice(1);
      if (!rule.post(m[0], captures)) continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    out += text.slice(lastEnd, start) + `[REDACTED:${rule.kind}]`;
    redacted_chars += m[0].length;
    kinds.add(rule.kind);
    lastEnd = end;
  }
  out += text.slice(lastEnd);
  return { text: out, redacted_chars };
}

function redact(input) {
  const original = typeof input === 'string' ? input : '';
  const original_len = original.length;
  const kinds = new Set();
  let text = original;
  let total_redacted = 0;

  for (const rule of RULES) {
    const res = applyRule(text, rule, kinds);
    text = res.text;
    total_redacted += res.redacted_chars;
  }

  const shouldDrop = original_len > 0 && (total_redacted / original_len) > 0.5;

  return {
    text,
    redacted_chars: total_redacted,
    kinds,
    shouldDrop
  };
}

module.exports = { redact };
