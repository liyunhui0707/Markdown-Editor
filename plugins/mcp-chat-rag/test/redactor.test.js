const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../lib/redactor');

test('T3.1 detects every supported secret kind and masks it', () => {
  const cases = [
    {
      kind: 'anthropic_key',
      sample: 'before sk-ant-' + 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZaBcDeFgH after'
    },
    {
      kind: 'openai_key',
      sample: 'token sk-' + 'A'.repeat(40) + ' suffix'
    },
    {
      kind: 'github_pat',
      sample: 'gh: ghp_' + 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2YZ'
    },
    {
      kind: 'aws_access_key',
      sample: 'aws AKIAIOSFODNN7EXAMPLE done'
    },
    {
      kind: 'dotenv_high_entropy',
      sample: 'JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9X8h7f6'
    }
  ];

  for (const c of cases) {
    const out = redact(c.sample);
    assert.ok(out.text.includes(`[REDACTED:${c.kind}]`), `expected ${c.kind} redaction marker in: ${out.text}`);
    assert.ok(out.kinds.has(c.kind), `expected kinds set to include ${c.kind}`);
    assert.ok(out.redacted_chars > 0);
  }
});

test('T3.2 low-entropy KEY=value is NOT redacted (no false positive)', () => {
  const samples = [
    'NODE_ENV=production',
    'DEBUG=true',
    'PORT=3000',
    'LOG_LEVEL=info'
  ];
  for (const s of samples) {
    const out = redact(s);
    assert.equal(out.text, s, `expected no change for: ${s}`);
    assert.equal(out.kinds.size, 0);
    assert.equal(out.redacted_chars, 0);
    assert.equal(out.shouldDrop, false);
  }
});

test('T3.3 chunk where >50% becomes redaction marker triggers shouldDrop', () => {
  // Short prose + long secret → most of the content is the secret
  const short = 'k=';
  const big = 'sk-ant-' + 'X'.repeat(120);
  const out = redact(short + big);
  assert.ok(out.shouldDrop, `expected shouldDrop=true (redacted_chars=${out.redacted_chars}, total=${(short + big).length})`);
});

test('T3.4 plain content with no secrets passes through unchanged', () => {
  const text = 'this is a regular assistant turn explaining how CRLF works.\n## Section\nNothing secret here.';
  const out = redact(text);
  assert.equal(out.text, text);
  assert.equal(out.redacted_chars, 0);
  assert.equal(out.kinds.size, 0);
  assert.equal(out.shouldDrop, false);
});

test('T3.5 multiple secret kinds in one chunk are all redacted', () => {
  const text = 'anthro sk-ant-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH and aws AKIAIOSFODNN7EXAMPLE done';
  const out = redact(text);
  assert.ok(out.kinds.has('anthropic_key'));
  assert.ok(out.kinds.has('aws_access_key'));
  assert.ok(out.text.includes('[REDACTED:anthropic_key]'));
  assert.ok(out.text.includes('[REDACTED:aws_access_key]'));
});
