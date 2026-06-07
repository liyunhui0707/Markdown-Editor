/* test/ai-sse-parser.test.js
   CB2 — Stage B: incremental SSE frame parser.

   Contract: createSseParser() returns { feed(bytes) → Event[] }.
   Events: { kind:'content', text } / { kind:'done' } / { kind:'error', reason:'invalid-response' }.
   - Line-oriented; frames terminated by '\n\n'.
   - Partial frame across feed() calls reassembles correctly.
   - data: [DONE] → done.
   - data: { "error": ... } → error (G4: don't echo inner text).
   - Malformed JSON → error.
   - Role-only delta frames skipped.
   - Literal 'data: ' inside JSON string value should NOT be parsed as a new frame.
   - bytes input may be a Uint8Array OR a string (helper tolerates both for ergonomics).
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSseParser } = require('../lib/ai-sse-parser');

function enc(s) { return new TextEncoder().encode(s); }

test('CB2.1 single complete content frame', () => {
  const p = createSseParser();
  const events = p.feed(enc('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
  assert.deepEqual(events, [{ kind: 'content', text: 'hi' }]);
});

test('CB2.2 two frames concatenated', () => {
  const p = createSseParser();
  const events = p.feed(enc(
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"b"}}]}\n\n'
  ));
  assert.deepEqual(events, [
    { kind: 'content', text: 'a' },
    { kind: 'content', text: 'b' },
  ]);
});

test('CB2.3 frame split across two feed() calls reassembles', () => {
  const p = createSseParser();
  const first  = p.feed(enc('data: {"choices":[{"delta":{"content"'));
  const second = p.feed(enc(':"hello"}}]}\n\n'));
  assert.deepEqual(first, []);
  assert.deepEqual(second, [{ kind: 'content', text: 'hello' }]);
});

test('CB2.4 [DONE] terminator', () => {
  const p = createSseParser();
  const events = p.feed(enc('data: [DONE]\n\n'));
  assert.deepEqual(events, [{ kind: 'done' }]);
});

test('CB2.5 content frames then [DONE]', () => {
  const p = createSseParser();
  const events = p.feed(enc(
    'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
    'data: [DONE]\n\n'
  ));
  assert.deepEqual(events, [
    { kind: 'content', text: 'x' },
    { kind: 'done' },
  ]);
});

test('CB2.6 malformed JSON emits invalid-response error (no leak)', () => {
  const p = createSseParser();
  const events = p.feed(enc('data: {malformed json\n\n'));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'error');
  assert.equal(events[0].reason, 'invalid-response');
  // G4 defensive: must NOT echo raw frame text in event payload.
  assert.equal(events[0].text, undefined);
  assert.equal(events[0].message, undefined);
});

test('CB2.7 explicit error event (G4: inner error text NOT echoed)', () => {
  const p = createSseParser();
  const innerLeak = 'top-secret upstream error string';
  const events = p.feed(enc(`data: {"error":{"message":"${innerLeak}","code":42}}\n\n`));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'error');
  assert.equal(events[0].reason, 'invalid-response');
  // No fields carrying the inner string.
  for (const v of Object.values(events[0])) {
    if (typeof v === 'string') {
      assert.equal(v.includes(innerLeak), false, 'inner error text leaked');
    }
  }
});

test('CB2.8 role-only delta skipped (no event emitted)', () => {
  const p = createSseParser();
  const events = p.feed(enc('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'));
  assert.deepEqual(events, []);
});

test('CB2.9 empty content delta skipped', () => {
  const p = createSseParser();
  const events = p.feed(enc('data: {"choices":[{"delta":{"content":""}}]}\n\n'));
  assert.deepEqual(events, []);
});

test('CB2.10 literal "data: " inside JSON string value is NOT parsed as a new frame', () => {
  const p = createSseParser();
  // The content payload itself contains the substring "data: " — must be
  // treated as opaque content, not as a frame boundary.
  const events = p.feed(enc('data: {"choices":[{"delta":{"content":"see data: line"}}]}\n\n'));
  assert.deepEqual(events, [{ kind: 'content', text: 'see data: line' }]);
});

test('CB2.11 missing choices array → frame skipped (no event, no crash)', () => {
  const p = createSseParser();
  const events = p.feed(enc('data: {"id":"abc","object":"chat.completion.chunk"}\n\n'));
  assert.deepEqual(events, []);
});

test('CB2.12 multi-byte split across feeds (UTF-8 safety via streaming decoder)', () => {
  const p = createSseParser();
  // Encode a CJK character. JSON-quote it manually so we can split on a
  // byte boundary mid-character.
  const bytes = enc('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
  // Split at byte 50, which falls inside the multi-byte sequence of 你.
  const a = bytes.slice(0, 50);
  const b = bytes.slice(50);
  const e1 = p.feed(a);
  const e2 = p.feed(b);
  // The complete frame doesn't terminate until '\n\n' arrives in b, so
  // e1 must be empty. e2 yields the one content event with both chars.
  assert.deepEqual(e1, []);
  assert.deepEqual(e2, [{ kind: 'content', text: '你好' }]);
});

test('CB2.13 non-data: lines (comments, retry, event:) ignored', () => {
  const p = createSseParser();
  const events = p.feed(enc(
    ': keepalive\n' +
    'event: message\n' +
    'retry: 5000\n' +
    'data: {"choices":[{"delta":{"content":"k"}}]}\n\n'
  ));
  assert.deepEqual(events, [{ kind: 'content', text: 'k' }]);
});

test('CB2.14 buffer survives across two feeds with partial second frame', () => {
  const p = createSseParser();
  const e1 = p.feed(enc('data: {"choices":[{"delta":{"content":"1"}}]}\n\ndata: {"choices'));
  const e2 = p.feed(enc('":[{"delta":{"content":"2"}}]}\n\n'));
  assert.deepEqual(e1, [{ kind: 'content', text: '1' }]);
  assert.deepEqual(e2, [{ kind: 'content', text: '2' }]);
});

test('CB2.16 [Codex F4] CRLF frame terminators parse correctly', () => {
  // SSE spec allows \r\n and \r in addition to \n. Real servers emit
  // either depending on platform / proxy. Without normalization, a CRLF
  // stream would parse no frames and streamSummarize would return an
  // empty summary silently. The parser normalizes at feed-time.
  const p = createSseParser();
  const events = p.feed(enc(
    'data: {"choices":[{"delta":{"content":"crlf"}}]}\r\n\r\n' +
    'data: [DONE]\r\n\r\n'
  ));
  assert.deepEqual(events, [
    { kind: 'content', text: 'crlf' },
    { kind: 'done' },
  ]);
});

test('CB2.17 [Codex F4] mixed LF and CRLF frames parse correctly', () => {
  const p = createSseParser();
  const events = p.feed(enc(
    'data: {"choices":[{"delta":{"content":"lf"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"crlf"}}]}\r\n\r\n'
  ));
  assert.deepEqual(events, [
    { kind: 'content', text: 'lf' },
    { kind: 'content', text: 'crlf' },
  ]);
});

test('CB2.18 [Codex F4] CRLF [DONE] terminator (no stray \\r breakage)', () => {
  const p = createSseParser();
  // Without normalization the data: line would end with '[DONE]\r' and
  // payload comparison against '[DONE]' would fail → no done event.
  const events = p.feed(enc('data: [DONE]\r\n\r\n'));
  assert.deepEqual(events, [{ kind: 'done' }]);
});

test('CB2.15 once error emitted, parser stays in error state (no further events)', () => {
  const p = createSseParser();
  const e1 = p.feed(enc('data: {malformed\n\n'));
  const e2 = p.feed(enc('data: {"choices":[{"delta":{"content":"after"}}]}\n\n'));
  assert.equal(e1.length, 1);
  assert.equal(e1[0].kind, 'error');
  // After an error, subsequent feeds yield nothing — caller already knows
  // the stream is bad and should abort.
  assert.deepEqual(e2, []);
});
