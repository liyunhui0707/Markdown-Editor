const searchChats = require('./handlers/search-chats');
const getSession = require('./handlers/get-session');
const listRecent = require('./handlers/list-recent-sessions');

function createRegistry(ctx) {
  const handlers = {
    search_chats: searchChats.createHandler(ctx),
    get_session: getSession.createHandler(ctx),
    list_recent_sessions: listRecent.createHandler(ctx)
  };
  const listTools = () => [searchChats.schema, getSession.schema, listRecent.schema];
  return { handlers, listTools };
}

module.exports = { createRegistry };
