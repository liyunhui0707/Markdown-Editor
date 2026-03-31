const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let inputBuffer = Buffer.alloc(0);
let nextId = 1;

function writeMessage(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, 'utf8');
  const header = Buffer.from(
    `Content-Length: ${payload.length}\r\nContent-Type: application/json\r\n\r\n`,
    'utf8'
  );

  child.stdin.write(Buffer.concat([header, payload]));
}

function sendRequest(method, params = {}) {
  const id = nextId++;
  writeMessage({
    jsonrpc: '2.0',
    id,
    method,
    params
  });
  return id;
}

function tryReadMessage() {
  const separator = '\r\n\r\n';
  const separatorIndex = inputBuffer.indexOf(separator);

  if (separatorIndex === -1) {
    return null;
  }

  const headerText = inputBuffer.slice(0, separatorIndex).toString('utf8');
  const match = headerText.match(/Content-Length:\s*(\d+)/i);

  if (!match) {
    throw new Error('Missing Content-Length');
  }

  const contentLength = Number(match[1]);
  const messageStart = separatorIndex + separator.length;
  const messageEnd = messageStart + contentLength;

  if (inputBuffer.length < messageEnd) {
    return null;
  }

  const messageBuffer = inputBuffer.slice(messageStart, messageEnd);
  inputBuffer = inputBuffer.slice(messageEnd);

  return JSON.parse(messageBuffer.toString('utf8'));
}

const pending = new Map();

child.stdout.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (true) {
    const message = tryReadMessage();
    if (!message) break;

    if (Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

function request(method, params = {}) {
  return new Promise((resolve) => {
    const id = sendRequest(method, params);
    pending.set(id, resolve);
  });
}

async function run() {
  console.log('Starting MCP smoke test...\n');

  const initializeResponse = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'smoke-test',
      version: '0.1.0'
    }
  });

  console.log('Initialize response:');
  console.log(JSON.stringify(initializeResponse, null, 2), '\n');

  writeMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  });

  const toolsListResponse = await request('tools/list', {});
  console.log('Tools list response:');
  console.log(JSON.stringify(toolsListResponse, null, 2), '\n');

  const pingResponse = await request('tools/call', {
    name: 'ping',
    arguments: {
      message: 'hello from smoke test'
    }
  });

  console.log('Ping tool response:');
  console.log(JSON.stringify(pingResponse, null, 2), '\n');

  child.kill();
}

run().catch((error) => {
  console.error(error);
  child.kill();
  process.exit(1);
});