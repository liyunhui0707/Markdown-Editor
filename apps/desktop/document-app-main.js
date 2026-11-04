'use strict';
// Installed/local product entry. It never dispatches to the legacy Vault app.
require('./lib/document-window-main').startDocumentWindow({ product: true });
