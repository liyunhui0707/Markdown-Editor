const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const desktop = path.resolve(__dirname, '..');

function executablePath() {
  // Do not require('electron'): it can download a missing binary as a side effect.
  const relative = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32' ? 'electron.exe' : 'electron';
  return process.env.E2E_ELECTRON_EXECUTABLE
    || path.join(path.dirname(require.resolve('electron/package.json')), 'dist', relative);
}

async function createSession(testInfo) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-vault-e2e-')));
  const vault = path.join(root, 'vault');
  await fs.mkdir(vault);
  const running = [];
  await testInfo.attach('synthetic-workspace', { body: root, contentType: 'text/plain' });

  async function launch(phase) {
    const executable = executablePath();
    await fs.access(executable).catch(() => {
      throw new Error('Electron binary missing. Install the locked Electron runtime or set '
        + 'E2E_ELECTRON_EXECUTABLE to an existing matching Electron executable.');
    });
    // Only pass OS launch essentials, not user AI settings, tokens or Node overrides.
    const env = {};
    for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR',
      'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'LANG']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    const app = await electron.launch({
      executablePath: executable,
      args: [path.join(__dirname, 'electron-main.cjs'), `--e2e-root=${root}`, `--e2e-phase=${phase}`],
      cwd: desktop,
      env,
      chromiumSandbox: true,
      timeout: 20_000,
    });
    const child = app.process();
    const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
    const item = { app, child, exited, phase, page: null, tracing: false, closed: false, log: '' };
    running.push(item);
    const log = (message) => { item.log = (item.log + message + '\n').slice(-64 * 1024); };
    child.stderr?.on('data', (chunk) => log(chunk.toString()));
    const paths = await app.evaluate(({ app }) => ({
      userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
      electron: process.versions.electron,
    }));
    expect(paths.userData).toBe(path.join(root, `profile-${phase}`));
    expect(paths.sessionData).toBe(paths.userData);
    expect(paths.electron).toBe(require('electron/package.json').version);

    // Only the OS picker is stubbed. Renderer, preload, load/save IPC and disk I/O are real.
    await app.evaluate(({ dialog }, vaultPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [vaultPath] });
    }, vault);
    const page = await app.firstWindow();
    item.page = page;
    page.on('pageerror', (error) => log(error.stack || error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') log(message.text());
    });
    await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    item.tracing = true;
    await page.waitForLoadState('load');
    await page.evaluate(() => localStorage.setItem('markdownVault.writeEngine', 'tiptap'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Choose Vault', exact: true })).toBeVisible();

    return {
      app, page,
      async openNote(title) {
        await page.getByRole('button', { name: 'Choose Vault', exact: true }).click();
        await expect(page.locator('#vaultPathText')).toHaveText(`Vault: ${vault}`);
        await page.locator('.note-item').filter({ has: page.locator('.note-title', { hasText: title }) }).click();
        await page.getByRole('tab', { name: 'Write', exact: true }).click();
        await expect(page.locator('#hybridWritePane .ProseMirror')).toBeVisible();
      },
      async close() {
        await stopTrace(item);
        await app.close();
        item.closed = true;
        expect(await exited).toBe(0);
      },
    };
  }

  async function stopTrace(item) {
    if (!item.tracing) return;
    item.tracing = false;
    const trace = testInfo.outputPath(`${item.phase}-trace.zip`);
    await item.app.context().tracing.stop({ path: trace });
    await testInfo.attach(`${item.phase}-trace`, { path: trace, contentType: 'application/zip' });
  }

  async function finish() {
    for (const item of running) {
      if (!item.closed) {
        if (item.page && !item.page.isClosed()) {
          const screenshot = testInfo.outputPath(`${item.phase}-failure.png`);
          await item.page.screenshot({ path: screenshot, timeout: 3000 }).then(() =>
            testInfo.attach(`${item.phase}-failure`, { path: screenshot, contentType: 'image/png' })
          ).catch(() => {});
        }
        await stopTrace(item).catch(() => {});
        // Only this test's spawned process; never attach to or close a user's editor.
        // SIGKILL also prevents a dirty-note dialog from hanging failure teardown.
        if (item.child.exitCode === null && item.child.signalCode === null) {
          item.child.kill('SIGKILL');
          await item.exited;
        }
      }
      await testInfo.attach(`${item.phase}-stderr`, { body: item.log, contentType: 'text/plain' });
    }
    // Keep synthetic files and profiles for diagnosis; no user directories are cleaned.
  }

  return { vault, launch, finish };
}

module.exports = { createSession };
