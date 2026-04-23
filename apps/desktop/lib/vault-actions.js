/* Vault action logic — dependency-injected so it is testable in Node.js
   and usable in the Electron renderer without DOM coupling.

   Works in both Node.js (for tests) and the browser (plain <script> tag). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VaultActions = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * Choose a vault folder and immediately load its notes.
   *
   * @param {object} deps
   * @param {object}   deps.vaultApi            - exposes chooseVaultFolder()
   * @param {function} deps.setCurrentVaultPath - (path: string) => void
   * @param {function} deps.stopWatching        - async () => void
   * @param {function} deps.startWatching       - async () => void
   * @param {function} deps.refreshVaultNotes   - async () => void  ← auto-loads on success
   * @param {function} deps.updateDisplay       - () => void
   * @param {function} deps.setStatus           - (type, message) => void
   */
  async function chooseVaultFolder({
    vaultApi,
    setCurrentVaultPath,
    stopWatching,
    startWatching,
    refreshVaultNotes,
    updateDisplay,
    setStatus,
  }) {
    setStatus('saving', 'Choosing vault...');

    const result = await vaultApi.chooseVaultFolder();

    if (!result.ok) {
      if (result.canceled) {
        setStatus('ready', 'Vault selection canceled');
      } else {
        setStatus('error', `Choose vault failed: ${result.error}`);
      }
      return;
    }

    await stopWatching();
    setCurrentVaultPath(result.vaultPath);
    updateDisplay();
    await startWatching();

    // Auto-load: refresh vault notes immediately after choosing, no manual step needed.
    setStatus('saving', 'Loading vault...');
    await refreshVaultNotes();
  }

  return { chooseVaultFolder };
});
