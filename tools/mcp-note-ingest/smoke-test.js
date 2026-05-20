const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const serverPath = path.join(__dirname, 'server.js');

// Force the ingest tool to write into a disposable temp dir instead of the user's
// real Inbox folder for the duration of the smoke test.
const tempTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-note-ingest-smoke-'));
const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, MCP_INGEST_TARGET_DIR: tempTarget }
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
  console.log(`Temporary ingest target: ${tempTarget}\n`);

  const initializeResponse = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'smoke-test',
      version: '0.3.0'
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

  const ingestResponse = await request('tools/call', {
    name: 'ingest_chat_markdown',
    arguments: {
      title: 'Smoke Test Chat',
      body: 'This file was written by the MCP smoke test.',
      source: 'claude',
      model: 'sonnet',
      tags: ['chat', 'smoke-test']
    }
  });

  console.log('ingest_chat_markdown response:');
  console.log(JSON.stringify(ingestResponse, null, 2), '\n');

  const writtenFilePath =
    ingestResponse?.result?.structuredContent?.full_path || '';

  if (!writtenFilePath) {
    throw new Error('Smoke test failed: no full_path returned.');
  }

  if (path.dirname(writtenFilePath) !== tempTarget) {
    throw new Error(
      `Smoke test failed: file written to ${path.dirname(writtenFilePath)}, expected ${tempTarget}`
    );
  }

  if (!fs.existsSync(writtenFilePath)) {
    throw new Error(`Smoke test failed: file not found at ${writtenFilePath}`);
  }

  const fileContents = fs.readFileSync(writtenFilePath, 'utf8');

  if (!fileContents.includes('source: "claude"')) {
    throw new Error('Smoke test failed: frontmatter source was not written.');
  }

  if (!fileContents.includes('# Smoke Test Chat')) {
    throw new Error('Smoke test failed: title heading was not written.');
  }

  if (!fileContents.includes('This file was written by the MCP smoke test.')) {
    throw new Error('Smoke test failed: body was not written.');
  }

  console.log('Written file contents:');
  console.log(fileContents);

  child.kill();
}

run().catch((error) => {
  console.error(error);
  child.kill();
  process.exit(1);
});