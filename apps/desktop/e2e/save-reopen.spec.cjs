const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSession } = require('./session.cjs');

test('Tiptap edit survives Save and a fresh-process, fresh-profile reopen', async ({}, testInfo) => {
  const session = await createSession(testInfo);
  const title = 'E2E persistence';
  const originalBody = 'Original synthetic body.';
  const marker = ' E2E-SAVED-ONCE-7f91';
  const original = `# ${title}\n\n${originalBody}\n`;
  const expected = `# ${title}\n\n${originalBody}${marker}\n`;
  const notePath = path.join(session.vault, 'persistence.md');
  const untouchedPath = path.join(session.vault, 'untouched.md');
  const untouched = '# Untouched\n\nThis synthetic note must not change.\n';
  await fs.writeFile(notePath, original, { flag: 'wx' });
  await fs.writeFile(untouchedPath, untouched, { flag: 'wx' });

  try {
    const first = await session.launch('edit');
    await first.openNote(title);
    const editor = first.page.locator('#hybridWritePane .ProseMirror');
    await expect(editor).toHaveText(originalBody);
    await editor.click();
    await editor.press('ControlOrMeta+End');
    // Real renderer key events: do not call setText(), save IPC, or mutate the DOM.
    await editor.pressSequentially(marker);
    await expect(editor).toHaveText(originalBody + marker);
    await expect(first.page.locator('#statusText')).toHaveClass(/status-draft/);
    expect(await fs.readFile(notePath, 'utf8')).toBe(original);

    await first.page.getByRole('button', { name: 'Save Note', exact: true }).click();
    await expect(first.page.locator('#statusText')).toHaveText('Saved: persistence.md');
    await expect(first.page.locator('#statusText')).toHaveClass(/status-ready/);
    await expect.poll(() => fs.readFile(notePath, 'utf8')).toBe(expected);
    expect(await fs.readFile(untouchedPath, 'utf8')).toBe(untouched);
    await expect(editor).toHaveText(originalBody + marker);

    const firstPid = first.app.process().pid;
    await first.close();

    // New process AND profile: the only shared input is the saved vault on disk.
    const reopened = await session.launch('reopen');
    expect(reopened.app.process().pid).not.toBe(firstPid);
    await reopened.openNote(title);
    await expect(reopened.page.locator('#hybridWritePane .ProseMirror'))
      .toHaveText(originalBody + marker);
    await expect(reopened.page.locator('.note-item.active .note-badge-draft')).toHaveCount(0);
    expect(await fs.readFile(notePath, 'utf8')).toBe(expected);
    expect(await fs.readFile(untouchedPath, 'utf8')).toBe(untouched);
    expect((await fs.readdir(session.vault)).sort()).toEqual(['persistence.md', 'untouched.md']);
    await reopened.close();
  } finally {
    await session.finish();
  }
});
