/* Stage S5 — unit tests for grouping.js (verbatim port).
   Run: node --test test/session-viewer/grouping.test.js  */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const Grouping = require('../../lib/session-viewer/grouping');

function makeItem(overrides) {
  return Object.assign({
    id: 'n1',
    title: 'Untitled',
    relativePath: 'Inbox/AI Chats/codex/2026/01/01/x.md',
    agent: 'codex',
    mtime: Date.now(),
  }, overrides || {});
}

function fixedToday() {
  // 2026-05-25 noon local — used as the bucketize reference.
  return new Date(2026, 4, 25, 12, 0, 0);
}

function daysAgo(days, ref) {
  const d = new Date(ref);
  d.setDate(d.getDate() - days);
  return d;
}

// ---------- agent partitioning ----------

test('T-S5-6 groupAndSort partitions by agent', () => {
  const items = [
    makeItem({ id: 'a', agent: 'codex' }),
    makeItem({ id: 'b', agent: 'claude' }),
    makeItem({ id: 'c', agent: 'other' }),
    makeItem({ id: 'd', agent: 'codex' }),
  ];
  const out = Grouping.groupAndSort(items, { today: fixedToday() });
  assert.equal(out.counts.codex.sessions, 2);
  assert.equal(out.counts.claude.sessions, 1);
  assert.equal(out.counts.other.sessions, 1);
});

test('T-S5-7 groupAndSort handles empty input', () => {
  const out = Grouping.groupAndSort([], { today: fixedToday() });
  assert.deepEqual(out.codex, []);
  assert.deepEqual(out.claude, []);
  assert.deepEqual(out.other, []);
  assert.equal(out.counts.codex.sessions, 0);
});

test('T-S5-7b groupAndSort handles null/undefined items list', () => {
  const out = Grouping.groupAndSort(null, { today: fixedToday() });
  assert.deepEqual(out.codex, []);
});

test('T-S5-8 groupAndSort skips null items', () => {
  const items = [null, makeItem({ id: 'a' }), undefined, makeItem({ id: 'b' })];
  const out = Grouping.groupAndSort(items, { today: fixedToday() });
  assert.equal(out.counts.codex.sessions, 2);
});

// ---------- favorites overlay ----------

test('T-S5-9 favorites overlay populated when isFavorite given', () => {
  const items = [
    makeItem({ id: 'a', relativePath: 'p/a.md' }),
    makeItem({ id: 'b', relativePath: 'p/b.md' }),
    makeItem({ id: 'c', relativePath: 'p/c.md' }),
  ];
  const out = Grouping.groupAndSort(items, {
    today: fixedToday(),
    isFavorite: (it) => it.relativePath === 'p/a.md' || it.relativePath === 'p/c.md',
  });
  assert.ok(out.favorite, 'favorite group should be present');
  assert.equal(out.counts.favorite.sessions, 2);
});

test('T-S5-9b favorite group is omitted when isFavorite not given', () => {
  const items = [makeItem({ id: 'a' })];
  const out = Grouping.groupAndSort(items, { today: fixedToday() });
  assert.equal('favorite' in out, false);
});

test('T-S5-9c favorite group is empty array when no items match', () => {
  const items = [makeItem({ id: 'a' })];
  const out = Grouping.groupAndSort(items, {
    today: fixedToday(),
    isFavorite: () => false,
  });
  assert.ok('favorite' in out);
  assert.deepEqual(out.favorite, []);
  assert.equal(out.counts.favorite.sessions, 0);
});

// ---------- bucketize / layerOf ----------

test('T-S5-10 layerOf day-delta rules', () => {
  assert.equal(Grouping.layerOf(0), 'today');
  assert.equal(Grouping.layerOf(-5), 'today');  // future also goes to today
  assert.equal(Grouping.layerOf(1), 'yesterday');
  assert.equal(Grouping.layerOf(2), 'w3');
  assert.equal(Grouping.layerOf(3), 'w3');
  assert.equal(Grouping.layerOf(4), 'w7');
  assert.equal(Grouping.layerOf(7), 'w7');
  assert.equal(Grouping.layerOf(8), 'older');
  assert.equal(Grouping.layerOf(100), 'older');
});

test('T-S5-11 bucketize creates buckets per layer + LAYER_ORDER preserved', () => {
  const today = fixedToday();
  const items = [
    makeItem({ id: 'a', mtime: today, agent: 'codex' }),
    makeItem({ id: 'b', mtime: daysAgo(1, today), agent: 'codex' }),
    makeItem({ id: 'c', mtime: daysAgo(5, today), agent: 'codex' }),
    makeItem({ id: 'd', mtime: daysAgo(15, today), agent: 'codex' }),
  ];
  const out = Grouping.groupAndSort(items, { today });
  const layerIds = out.codex.map((b) => b.layerId);
  // LAYER_ORDER = today, yesterday, w3, w7, older
  assert.deepEqual(layerIds, ['today', 'yesterday', 'w7', 'older']);
  // w3 has 0 items → bucket skipped.
});

test('T-S5-12 empty buckets are skipped', () => {
  const today = fixedToday();
  const items = [
    makeItem({ id: 'a', mtime: today, agent: 'codex' }),
    makeItem({ id: 'b', mtime: daysAgo(15, today), agent: 'codex' }),
  ];
  const out = Grouping.groupAndSort(items, { today });
  const ids = out.codex.map((b) => b.layerId);
  assert.deepEqual(ids, ['today', 'older']);
});

test('T-S5-13 sort within bucket descending by mtime', () => {
  const today = fixedToday();
  const items = [
    makeItem({ id: 'old', mtime: new Date(today.getTime() - 3600000), agent: 'codex' }),
    makeItem({ id: 'newer', mtime: today, agent: 'codex' }),
  ];
  const out = Grouping.groupAndSort(items, { today, sort: 'newest' });
  const ids = out.codex[0].items.map((i) => i.id);
  assert.deepEqual(ids, ['newer', 'old']);
});

test('T-S5-14 sort=oldest reverses', () => {
  const today = fixedToday();
  const items = [
    makeItem({ id: 'old', mtime: new Date(today.getTime() - 3600000), agent: 'codex' }),
    makeItem({ id: 'newer', mtime: today, agent: 'codex' }),
  ];
  const out = Grouping.groupAndSort(items, { today, sort: 'oldest' });
  const ids = out.codex[0].items.map((i) => i.id);
  assert.deepEqual(ids, ['old', 'newer']);
});

test('T-S5-14b sort=name lexicographic', () => {
  const today = fixedToday();
  const items = [
    makeItem({ id: 'b', title: 'Zebra', mtime: today, agent: 'codex' }),
    makeItem({ id: 'a', title: 'Apple', mtime: today, agent: 'codex' }),
  ];
  const out = Grouping.groupAndSort(items, { today, sort: 'name' });
  const titles = out.codex[0].items.map((i) => i.title);
  assert.deepEqual(titles, ['Apple', 'Zebra']);
});

// ---------- counts ----------

test('T-S5-15 counts.sessions matches items per agent', () => {
  const items = [
    makeItem({ id: 'a', agent: 'codex' }),
    makeItem({ id: 'b', agent: 'codex', messageCount: 7 }),
    makeItem({ id: 'c', agent: 'claude', messageCount: 3 }),
  ];
  const out = Grouping.groupAndSort(items, { today: fixedToday() });
  assert.equal(out.counts.codex.sessions, 2);
  assert.equal(out.counts.codex.messages, 7);
  assert.equal(out.counts.claude.sessions, 1);
  assert.equal(out.counts.claude.messages, 3);
});

test('T-S5-15a other is bucketed uniformly with codex/claude (round-1 diff-review M1 fix)', () => {
  const today = fixedToday();
  const items = [
    makeItem({ id: 'a', agent: 'other', mtime: today }),
    makeItem({ id: 'b', agent: 'other', mtime: daysAgo(15, today) }),
  ];
  const out = Grouping.groupAndSort(items, { today });
  assert.ok(Array.isArray(out.other));
  // 2 buckets: today + older.
  const ids = out.other.map((b) => b.layerId);
  assert.deepEqual(ids, ['today', 'older']);
  // Bucket structure with layerId + label + items[].
  assert.ok(out.other[0].label);
  assert.ok(Array.isArray(out.other[0].items));
  assert.equal(out.other[0].items[0].id, 'a');
  assert.equal(out.other[1].items[0].id, 'b');
});

// ---------- LAYER constants ----------

test('LAYER_ORDER + LAYER_LABEL are exported and immutable-friendly', () => {
  assert.deepEqual(Grouping.LAYER_ORDER, ['today', 'yesterday', 'w3', 'w7', 'older']);
  assert.equal(Grouping.LAYER_LABEL.today, 'Today');
  assert.equal(Grouping.LAYER_LABEL.w3, 'Within 3 Days');
  assert.equal(Grouping.LAYER_LABEL.w7, 'Within 7 Days');
  assert.equal(Grouping.LAYER_LABEL.older, 'Older Than 7 Days');
});
