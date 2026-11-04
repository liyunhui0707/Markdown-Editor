'use strict';
// product is supplied only by the fixed main entry, never by argv or renderer.
function resolveLaunchMode({ product = false, packaged, mas, platform, argv }) {
  if (product) {
    if (platform !== 'darwin' || mas || argv.some(a => a.startsWith('--document-')))
      throw Error('Unsupported product launch options');
    return { readOnlyWindow: true, persistentCopies: true, testCopies: true, drafts: true };
  }
  if (packaged) throw Error('Development entry unavailable in an installed application');
  const readOnlyWindow = argv.includes('--document-readonly');
  const persistentCopies = readOnlyWindow && !mas && argv.includes('--document-persistent-copy');
  return { readOnlyWindow, persistentCopies,
    testCopies: readOnlyWindow && (argv.includes('--document-test-copy') || persistentCopies),
    drafts: readOnlyWindow && !argv.includes('--document-no-drafts') };
}
module.exports = { resolveLaunchMode };
