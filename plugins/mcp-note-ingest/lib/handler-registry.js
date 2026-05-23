const ping = require('./handlers/ping');
const ingestChatMarkdown = require('./handlers/ingest-chat-markdown');
const listNotes = require('./handlers/list-notes');
const readNote = require('./handlers/read-note');
const getVaultInfo = require('./handlers/get-vault-info');
const searchNotes = require('./handlers/search-notes');
const updateNote = require('./handlers/update-note');
const appendToNote = require('./handlers/append-to-note');

const handlers = {
  ping: ping.handler,
  ingest_chat_markdown: ingestChatMarkdown.handler,
  list_notes: listNotes.handler,
  read_note: readNote.handler,
  get_vault_info: getVaultInfo.handler,
  search_notes: searchNotes.handler,
  update_note: updateNote.handler,
  append_to_note: appendToNote.handler
};

function listTools() {
  return [
    ping.schema,
    ingestChatMarkdown.schema,
    listNotes.schema,
    readNote.schema,
    getVaultInfo.schema,
    searchNotes.schema,
    updateNote.schema,
    appendToNote.schema
  ];
}

module.exports = { handlers, listTools };
