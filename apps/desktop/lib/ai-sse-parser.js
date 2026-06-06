/* lib/ai-sse-parser.js
   Incremental SSE frame parser for OpenAI-compatible chat-completion streams.

   Contract (Stage B D11/CB2):
   - createSseParser() returns { feed(bytes) -> Event[] }.
   - Events: { kind:'content', text } | { kind:'done' } | { kind:'error', reason }.
   - bytes may be Uint8Array, Buffer, or string. UTF-8 streaming decode preserves
     multi-byte characters split across feeds.
   - Frames are terminated by '\n\n' (LF-LF). Only `data: ...` lines contribute
     to the frame payload; SSE comment (`:`), `event:`, and `retry:` lines are
     ignored.
   - `data: [DONE]` -> { kind:'done' }.
   - `data: <json>`:
       - parse failure -> { kind:'error', reason:'invalid-response' }.
       - json.error present -> { kind:'error', reason:'invalid-response' }
         (G4: NEVER echo the inner provider message — only the canned reason
         flows out of the parser; the IPC layer renders REASON_MESSAGES[reason]).
       - json.choices[0].delta.content is a non-empty string -> { kind:'content', text }.
       - anything else (role-only delta, finish-reason-only frame, missing
         choices) -> skipped silently.
   - After an error event is emitted, the parser refuses to emit further events
     for any subsequent feed(). The caller should abort the stream on first
     error.
   - This module is pure: no I/O, no timers.
*/

'use strict';

function createSseParser() {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let errored = false;

  function decode(bytes) {
    if (bytes == null) return '';
    if (typeof bytes === 'string') return bytes;
    return decoder.decode(bytes, { stream: true });
  }

  function parseFrame(frame) {
    // SSE frame = sequence of lines ending in '\n'. Only `data:` lines
    // contribute. Multiple data: lines per frame would concatenate with '\n',
    // but OpenAI-compatible servers emit one data: line per frame; we still
    // handle the multi-data case defensively.
    const lines = frame.split('\n');
    const dataLines = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      // Comment lines start with ':'.
      if (raw.charCodeAt(0) === 0x3a /* ':' */) continue;
      // 'data:' (with or without space after colon).
      if (raw.startsWith('data:')) {
        const v = raw.slice(5).replace(/^ /, '');
        dataLines.push(v);
        continue;
      }
      // Ignore event:, retry:, id: and any other SSE fields.
    }
    if (dataLines.length === 0) return [];
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') return [{ kind: 'done' }];
    let json;
    try {
      json = JSON.parse(payload);
    } catch (_e) {
      return [{ kind: 'error', reason: 'invalid-response' }];
    }
    if (json && json.error) {
      // G4: do NOT propagate json.error.message — caller renders the canned
      // REASON_MESSAGES['invalid-response'] string only.
      return [{ kind: 'error', reason: 'invalid-response' }];
    }
    if (!json || !Array.isArray(json.choices) || json.choices.length === 0) {
      return [];
    }
    const choice = json.choices[0];
    const delta = choice && choice.delta;
    if (!delta || typeof delta.content !== 'string' || delta.content.length === 0) {
      return [];
    }
    return [{ kind: 'content', text: delta.content }];
  }

  function feed(bytes) {
    if (errored) return [];
    // F4 (Codex): normalize CRLF / CR line endings to LF. SSE spec allows
    // \r\n and \r as line terminators in addition to \n; if a server emits
    // CRLF frames, splitting only on \n\n would skip all of them and a
    // stray trailing \r on data: lines would corrupt [DONE] / JSON. String
    // replacement runs after UTF-8 decode so it cannot split mid-codepoint.
    buffer += decode(bytes).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const events = [];
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const frameEvents = parseFrame(frame);
      for (const ev of frameEvents) {
        events.push(ev);
        if (ev.kind === 'error') {
          errored = true;
          // Stop processing further frames in this feed; the caller will
          // see the error and abort.
          buffer = '';
          return events;
        }
      }
    }
    return events;
  }

  return { feed };
}

module.exports = { createSseParser };
