#!/usr/bin/env node
// MCP stdio proxy for Codex Computer Use
// Intercepts list_apps -> local NSWorkspace query (via precompiled Swift binary)
// All other MCP messages forwarded to native SkyComputerUseClient

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT_DIR = __dirname;
const HELPER_BIN = path.join(SCRIPT_DIR, 'list-apps-helper');

// Locate native client
function findClientBin() {
  const candidates = [
    path.join(os.homedir(), '.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use'),
    '/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use'
  ];
  for (const dir of candidates) {
    const bin = path.join(dir, 'Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

const CLIENT_BIN = findClientBin();
if (!CLIENT_BIN) {
  process.stderr.write('ERROR: SkyComputerUseClient not found\n');
  process.exit(1);
}
// Match the original working wrapper: SkyComputerUseClient expects to start
// from the plugin directory so it can resolve its native app resources.
const CLIENT_CWD = path.resolve(CLIENT_BIN, '../../../../../../..');

// Query local apps via precompiled Swift binary
function listAppsLocal() {
  try {
    const result = execSync(HELPER_BIN, { timeout: 5000, encoding: 'utf8' });
    return JSON.parse(result);
  } catch {
    // Fallback: osascript
    try {
      const names = execSync(
        `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
        { timeout: 3000, encoding: 'utf8' }
      ).trim();
      const apps = names.split(', ').map(name => ({
        bundleIdentifier: name.trim(),
        appName: name.trim(),
        isRunning: true,
        usageFrequency: 'frequently'
      }));
      return { apps, totalRunning: apps.length, totalInstalled: apps.length };
    } catch {
      return { apps: [], totalRunning: 0, totalInstalled: 0, error: 'Failed to list apps' };
    }
  }
}

// Start native client
const nativeClient = spawn(CLIENT_BIN, ['mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: CLIENT_CWD,
  env: { ...process.env }
});

// Forward native responses -> stdout
let nativeBuffer = '';
nativeClient.stdout.on('data', (data) => {
  process.stdout.write(data);
});

nativeClient.stderr.on('data', (data) => {
  process.stderr.write(data);
});

let nativeAlive = true;

nativeClient.on('close', (code) => {
  nativeAlive = false;
  if (code !== 0) process.stderr.write(`Native client exited: ${code}\n`);
});

nativeClient.on('error', (error) => {
  nativeAlive = false;
  process.stderr.write(`Native client error: ${error.message}\n`);
});

function writeJson(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respondNativeUnavailable(id) {
  if (id === undefined || id === null) return;
  writeJson({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: 'Native Computer Use client is not available'
    }
  });
}

function forwardToNative(line, id) {
  if (!nativeAlive || nativeClient.stdin.destroyed || !nativeClient.stdin.writable) {
    respondNativeUnavailable(id);
    return;
  }

  nativeClient.stdin.write(line + '\n', (error) => {
    if (error) {
      nativeAlive = false;
      respondNativeUnavailable(id);
    }
  });
}

// Handle incoming MCP messages
let stdinBuffer = '';

process.stdin.on('data', (data) => {
  stdinBuffer += data.toString();
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Intercept list_apps
      if (msg.method === 'tools/call' && msg.params?.name === 'list_apps' && msg.id !== undefined && msg.id !== null) {
        const appData = listAppsLocal();
        writeJson({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify(appData, null, 2)
            }]
          }
        });
        continue;
      }

      // Forward everything else to native
      forwardToNative(line, msg.id);
    } catch {
      // Non-JSON line, forward as-is
      forwardToNative(line);
    }
  }
});

process.stdin.on('end', () => {
  nativeClient.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  nativeClient.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  nativeClient.kill();
  process.exit(0);
});
