#!/usr/bin/env node
// Optional UI action e2e test for computer-use-local.
//
// This test opens TextEdit with a temporary file, types a unique marker through
// the MCP type_text tool, then verifies the file can be saved with the marker.
// It is opt-in because it performs real UI actions.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const SERVER = path.join(ROOT, 'run-computer-use-mcp.sh');
const RUN_UI_E2E = process.env.COMPUTER_USE_RUN_UI_E2E === '1';
const RESPONSE_TIMEOUT_MS = 12000;

if (!RUN_UI_E2E) {
  console.log('ui-e2e-test skipped; set COMPUTER_USE_RUN_UI_E2E=1 to run real UI actions');
  process.exit(0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function commandOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: options.timeout || 10000,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
    env: process.env,
  });
}

function checkAccessibility() {
  const result = commandOutput('./ax-action-helper', [
    JSON.stringify({ command: 'pressKey', app: 'Finder', key: 'Escape' }),
  ]);
  if (result.includes('Accessibility permission not granted')) {
    fail('Accessibility is not granted for ax-action-helper; cannot run UI e2e');
  }
}

function startServer() {
  const child = spawn(SERVER, [], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdoutBuffer = '';
  let stderr = '';
  const pending = new Map();

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

  function send(id, method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        fail(`Timed out waiting for response id=${id} method=${method}\n${stderr}`);
      }, RESPONSE_TIMEOUT_MS);
      pending.set(String(id), { resolve, timer });
    });
  }

  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  function close() {
    child.stdin.end();
    child.kill('SIGTERM');
  }

  return { child, send, notify, close };
}

function latestText(content) {
  return content?.find((block) => block.type === 'text')?.text || '';
}

(async () => {
  checkAccessibility();

  const marker = `computer-use-local-e2e-${Date.now()}`;
  const tempFile = path.join(os.tmpdir(), `${marker}.txt`);
  fs.writeFileSync(tempFile, '');
  commandOutput('/usr/bin/open', ['-a', 'TextEdit', tempFile], { timeout: 10000 });

  const server = startServer();
  try {
    const init = await server.send(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'computer-use-local-ui-e2e', version: '0.1' },
    });
    if (init.result?.serverInfo?.name !== 'Computer Use') {
      fail('initialize returned wrong server name');
    }
    server.notify('notifications/initialized');

    const state = await server.send(2, 'tools/call', {
      name: 'get_app_state',
      arguments: { app: 'TextEdit' },
    });
    if (!Array.isArray(state.result?.content)) {
      fail(`get_app_state failed: ${state.error?.message || 'missing content'}`);
    }

    const typed = await server.send(3, 'tools/call', {
      name: 'type_text',
      arguments: { app: 'TextEdit', text: marker },
    });
    if (typed.error) fail(`type_text failed: ${typed.error.message}`);
    if (!Array.isArray(typed.result?.content)) fail('type_text did not return updated app state');

    await server.send(4, 'tools/call', {
      name: 'press_key',
      arguments: { app: 'TextEdit', key: 'super+s' },
    });

    const saved = fs.readFileSync(tempFile, 'utf8');
    if (!saved.includes(marker) && !latestText(typed.result.content).includes(marker)) {
      fail('typed marker was not observed in saved file or updated app state');
    }

    await server.send(5, 'tools/call', {
      name: 'press_key',
      arguments: { app: 'TextEdit', key: 'super+w' },
    });
  } finally {
    server.close();
    try { fs.unlinkSync(tempFile); } catch {}
  }

  console.log('ui-e2e-test ok');
})().catch((error) => fail(error.stack || error.message));
