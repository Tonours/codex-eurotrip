#!/usr/bin/env node
// Minimal MCP smoke test for the local Computer Use server.

const { execFileSync, spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const SERVER = path.join(ROOT, 'run-computer-use-mcp.sh');
const RESPONSE_TIMEOUT_MS = 8000;
const APP_STATE_TEST_APP = process.env.COMPUTER_USE_TEST_APP || 'Terminal';

const child = spawn(SERVER, [], {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdoutBuffer = '';
let stderr = '';
const pending = new Map();

function fail(message) {
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 500);
  console.error(message);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  process.exit(1);
}

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`Invalid JSON response: ${line}`);
    }

    const entry = pending.get(String(msg.id));
    if (!entry) continue;
    clearTimeout(entry.timer);
    pending.delete(String(msg.id));
    entry.resolve(msg);
  }
});

child.on('exit', (code, signal) => {
  if (pending.size > 0) {
    fail(`Server exited while responses were pending: code=${code} signal=${signal}`);
  }
});

function send(id, method, params = {}) {
  const message = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      fail(`Timed out waiting for response id=${id} method=${method}`);
    }, RESPONSE_TIMEOUT_MS);
    pending.set(String(id), { resolve, timer });
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertNoNativeComputerUseChild() {
  const output = execFileSync('/bin/ps', ['-axo', 'pid,ppid,args'], {
    encoding: 'utf8',
    timeout: 2000,
  });
  const rows = output.trim().split('\n').slice(1).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), args: match[3] } : null;
  }).filter(Boolean);

  const descendants = new Set([child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }

  const nativeChild = rows.find((row) =>
    descendants.has(row.pid) &&
    row.args.includes('SkyComputerUseClient') &&
    row.args.includes('mcp')
  );
  assert(!nativeChild, `local server spawned native SkyComputerUseClient: ${nativeChild?.args}`);
}

(async () => {
  const init = await send(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'computer-use-local-smoke', version: '0.1' },
  });
  assert(init.result?.serverInfo?.name === 'Computer Use', 'initialize returned wrong server name');

  notify('notifications/initialized');

  const list = await send(2, 'tools/list');
  const toolNames = (list.result?.tools || []).map((tool) => tool.name);
  for (const expected of [
    'list_apps',
    'get_app_state',
    'click',
    'perform_secondary_action',
    'set_value',
    'select_text',
    'scroll',
    'drag',
    'press_key',
    'type_text',
  ]) {
    assert(toolNames.includes(expected), `tools/list is missing ${expected}`);
  }

  const resources = await send(3, 'resources/list');
  assert(Array.isArray(resources.result?.resources), 'resources/list did not return resources');

  const resourceTemplates = await send(4, 'resources/templates/list');
  assert(
    Array.isArray(resourceTemplates.result?.resourceTemplates),
    'resources/templates/list did not return resourceTemplates'
  );

  const prompts = await send(5, 'prompts/list');
  assert(Array.isArray(prompts.result?.prompts), 'prompts/list did not return prompts');

  const apps = await send(6, 'tools/call', { name: 'list_apps', arguments: {} });
  assert(apps.result?.content?.[0]?.type === 'text', 'list_apps did not return text content');
  assert(apps.result.content[0].text.includes('"apps"'), 'list_apps payload does not include apps');

  const state = await send(7, 'tools/call', {
    name: 'get_app_state',
    arguments: { app: APP_STATE_TEST_APP },
  });
  assert(Array.isArray(state.result?.content), 'get_app_state did not return content');
  assert(state.result.content.length > 0, 'get_app_state returned empty content');

  const key = await send(8, 'tools/call', {
    name: 'press_key',
    arguments: { app: 'Finder', key: 'Escape' },
  });
  assert(
    key.result || key.error?.message?.includes('Accessibility permission'),
    'press_key neither succeeded nor returned the expected Accessibility error'
  );
  if (key.result) {
    assert(Array.isArray(key.result.content), 'press_key succeeded without returning content');
    assert(key.result.content.length > 0, 'press_key returned empty content');
  }
  assertNoNativeComputerUseChild();

  child.stdin.end();
  console.log('smoke-test ok');
})().catch((error) => fail(error.stack || error.message));
