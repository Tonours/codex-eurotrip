#!/usr/bin/env node
// MCP stdio proxy for Codex Computer Use
// Intercepts list_apps -> local NSWorkspace query (via precompiled Swift binary)
// All other MCP messages forwarded to native SkyComputerUseClient
//
// Known limitation (build 799): the native client requires an XPC bootstrap
// from the Codex app to connect to SkyComputerUseService. When launched from
// CLI (e.g. via an MCP wrapper), the XPC connection is not established and
// tool calls that need the service hang. This proxy adds a configurable
// timeout so callers get a clear error instead of blocking forever.

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT_DIR = __dirname;
const HELPER_BIN = path.join(SCRIPT_DIR, 'list-apps-helper');

// Timeout for tool calls forwarded to the native service.
// Set via NATIVE_TOOL_TIMEOUT env var (seconds); default 15s.
const NATIVE_TOOL_TIMEOUT_MS =
  (parseInt(process.env.NATIVE_TOOL_TIMEOUT, 10) || 15) * 1000;

// Locate native client
function findClientBin() {
  if (process.env.COMPUTER_USE_CLIENT_BIN) {
    return process.env.COMPUTER_USE_CLIENT_BIN;
  }

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
const CLIENT_CWD = process.env.COMPUTER_USE_CLIENT_CWD || path.resolve(CLIENT_BIN, '../../../../../../..');

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

let nativeAlive = true;

// Forward native responses -> stdout, but answer native server->client
// elicitations locally. Newer native Computer Use builds ask for app-use
// permission via MCP elicitation before get_app_state; some Codex builds do not
// handle that nested request reliably through a stdio proxy.
let nativeBuffer = '';
nativeClient.stdout.on('data', (data) => {
  nativeBuffer += data.toString();
  const lines = nativeBuffer.split('\n');
  nativeBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) {
      process.stdout.write(line + '\n');
      continue;
    }

    if (handleNativeMessage(line)) continue;

    // Clear pending timeout when native responds
    try {
      const parsed = JSON.parse(line);
      if (parsed.id !== undefined && parsed.id !== null) {
        clearPendingRequest(String(parsed.id));
      }
    } catch { /* ignore */ }

    process.stdout.write(line + '\n');
  }
});

nativeClient.stderr.on('data', (data) => {
  process.stderr.write(data);
});

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

function writeNativeJson(message) {
  if (!nativeAlive || nativeClient.stdin.destroyed || !nativeClient.stdin.writable) {
    return;
  }
  nativeClient.stdin.write(JSON.stringify(message) + '\n');
}

function requestedSchemaIsEmptyObject(schema) {
  return schema?.type === 'object'
    && (!schema.properties || Object.keys(schema.properties).length === 0)
    && (!schema.required || schema.required.length === 0);
}

function handleNativeMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return false;
  }

  if (msg.method !== 'elicitation/create' || msg.id === undefined || msg.id === null) {
    return false;
  }

  const schema = msg.params?.requestedSchema;
  const action = requestedSchemaIsEmptyObject(schema) ? 'accept' : 'decline';

  writeNativeJson({
    jsonrpc: '2.0',
    id: msg.id,
    result: {
      action,
      content: {}
    }
  });

  process.stderr.write(`Handled native elicitation locally: ${action}\n`);
  return true;
}

// Pending tool-call requests forwarded to the native service.
// Each entry maps the MCP request id to a timeout handle and metadata.
const pendingNativeRequests = new Map();

// Cached Accessibility check for input-helper (undefined = not checked yet)
let inputHelperHasAccess = undefined;

// Cached SkyComputerUseService check (refreshed every 30s)
// Only routes to native when BOTH the service is running AND we're inside
// the Codex Desktop process tree (i.e., the native client is authenticated).
let serviceRunningCache = undefined;
let serviceCheckedAt = 0;
function isServiceRunning() {
  const now = Date.now();
  if (serviceRunningCache !== undefined && (now - serviceCheckedAt) < 30000) {
    return serviceRunningCache;
  }
  try {
    execSync('pgrep -x SkyComputerUseService', { timeout: 1000 });
    serviceRunningCache = true;
  } catch {
    serviceRunningCache = false;
  }
  serviceCheckedAt = now;
  return serviceRunningCache;
}

// Detect if we're running inside the Codex Desktop process tree.
// The native client is only authenticated when launched by Codex.
let inCodexTreeCache = undefined;
function isInCodexTree() {
  if (inCodexTreeCache !== undefined) return inCodexTreeCache;
  try {
    const ppid = process.ppid;
    const parentCmd = execSync(`ps -o command= -p ${ppid}`, { encoding: 'utf8', timeout: 1000 }).trim();
    // Match Codex Desktop's specific binary paths, not generic "codex" in CWD
    inCodexTreeCache =
      parentCmd.startsWith('/Applications/Codex.app/') ||
      parentCmd.includes('/codex app-server') ||
      parentCmd.includes('/node_repl');
  } catch {
    inCodexTreeCache = false;
  }
  return inCodexTreeCache;
}

function respondNativeError(id, message) {
  if (id === undefined || id === null) return;
  writeJson({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message
    }
  });
}

function clearPendingRequest(id) {
  const entry = pendingNativeRequests.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingNativeRequests.delete(id);
}

function forwardToNative(line, id, msg) {
  if (!nativeAlive || nativeClient.stdin.destroyed || !nativeClient.stdin.writable) {
    respondNativeError(id, 'Native Computer Use client is not available');
    return;
  }

  // Set up timeout for tool calls (which need the XPC service)
  const isToolCall = msg?.method === 'tools/call' && id !== undefined && id !== null;
  if (isToolCall) {
    const timer = setTimeout(() => {
      pendingNativeRequests.delete(String(id));
      respondNativeError(String(id),
        `Native tool call timed out after ${NATIVE_TOOL_TIMEOUT_MS / 1000}s. ` +
        'The native Computer Use service may not be reachable from this context. ' +
        'Ensure Codex Desktop is running and the service is registered.');
      process.stderr.write(
        `[timeout] Native tool call ${msg?.params?.name || 'unknown'} (id=${id}) timed out\n`
      );
    }, NATIVE_TOOL_TIMEOUT_MS);
    pendingNativeRequests.set(String(id), { timer, toolName: msg?.params?.name });
  }

  nativeClient.stdin.write(line + '\n', (error) => {
    if (error) {
      nativeAlive = false;
      clearPendingRequest(String(id));
      respondNativeError(String(id), 'Native Computer Use client is not available');
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

      // If SkyComputerUseService is running AND we're in the Codex Desktop
      // process tree, forward ALL tool calls to the authenticated native client.
      if (msg.method === 'tools/call' && msg.id !== undefined && msg.id !== null) {
        if (isInCodexTree() && isServiceRunning()) {
          forwardToNative(line, msg.id, msg);
          continue;
        }
      }

      // Intercept get_app_state with degraded fallback (screenshot + AppleScript)
      // Native XPC requires Codex Desktop context; this provides basic info from CLI.
      if (msg.method === 'tools/call' && msg.params?.name === 'get_app_state' && msg.id !== undefined && msg.id !== null) {
        try {
          const app = msg.params?.arguments?.app;
          if (!app) throw new Error('Missing app argument');
          const helperPath = path.join(SCRIPT_DIR, 'get-app-state-helper.js');
          const result = execSync(`node "${helperPath}" ${JSON.stringify(app)}`, {
            timeout: 15000, encoding: 'utf8', env: process.env,
            maxBuffer: 10 * 1024 * 1024 // 10MB for base64 screenshots
          });
          const parsed = JSON.parse(result.trim());
          if (parsed.error) {
            writeJson({
              jsonrpc: '2.0', id: msg.id,
              error: { code: -32000, message: parsed.error }
            });
          } else if (parsed.content) {
            writeJson({ jsonrpc: '2.0', id: msg.id, result: parsed });
          } else {
            writeJson({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(parsed) }] } });
          }
        } catch (e) {
          // Fallback to native (which will likely timeout, but at least we tried)
          process.stderr.write(`[degraded] get_app_state helper failed: ${e.message}, forwarding to native\n`);
          forwardToNative(line, msg.id, msg);
        }
        continue;
      }

      // Intercept input tools (click, type_text, press_key, scroll, drag) with input-helper
      // These need Accessibility permission for the input-helper binary.
      const INPUT_TOOLS = new Set(['click', 'type_text', 'press_key', 'scroll', 'drag']);
      if (msg.method === 'tools/call' && INPUT_TOOLS.has(msg.params?.name) && msg.id !== undefined && msg.id !== null) {
        const toolName = msg.params.name;
        const args = msg.params?.arguments || {};
        const inputHelper = path.join(SCRIPT_DIR, 'input-helper');
        
        // Check Accessibility (cached after first check)
        if (inputHelperHasAccess === undefined) {
          try {
            execSync(`"${inputHelper}" click 0 0`, { timeout: 2000 });
            inputHelperHasAccess = true;
          } catch(e) {
            const errOut = (e.stderr && e.stderr.toString()) || '';
            inputHelperHasAccess = !errOut.includes('Accessibility permission not granted');
          }
        }
        
        if (!inputHelperHasAccess) {
          writeJson({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: toolName + ' requires Accessibility permission. Grant in System Settings > Privacy & Security > Accessibility for input-helper.' } });
          continue;
        }
        
        try {
          const axHelper = path.join(SCRIPT_DIR, 'ax-tree-helper');
          let cmd = null;

          if (toolName === 'click' && args.x !== undefined && args.y !== undefined) {
            cmd = `"${inputHelper}" click ${args.x} ${args.y}`;
          } else if (toolName === 'type_text' && args.text) {
            const escaped = args.text.replace(/'/g, "'\\''");
            cmd = `"${inputHelper}" type '${escaped}'`;
          } else if (toolName === 'press_key' && args.key) {
            // Map common key names to macOS keycodes
            const KEY_MAP = {
              'Return': 36, 'Enter': 36, 'Tab': 48, 'Space': 49, 'Delete': 51, 'Backspace': 51,
              'Escape': 53, 'Esc': 53, 'Command': 55, 'Cmd': 55, 'Shift': 56, 'CapsLock': 57,
              'Option': 58, 'Alt': 58, 'Control': 59, 'Ctrl': 59, 'RightShift': 60,
              'RightOption': 61, 'RightControl': 62, 'Up': 126, 'Down': 125, 'Left': 123, 'Right': 124,
              'Home': 115, 'End': 119, 'PageUp': 116, 'PageDown': 121,
              'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118, 'F5': 96, 'F6': 97, 'F7': 98, 'F8': 100,
              'F9': 101, 'F10': 109, 'F11': 103, 'F12': 111,
            };
            const parts = args.key.split('+');
            const mainKey = parts.pop();
            const keycode = KEY_MAP[mainKey] || 0;
            const mods = parts.map(p => `--${p.toLowerCase().replace('cmd', 'cmd').replace('ctrl', 'ctrl').replace('shift', 'shift').replace('opt', 'opt').replace('alt', 'opt')}`);
            cmd = `"${inputHelper}" key ${keycode} ${mods.join(' ')}`;
          } else if (toolName === 'scroll' && args.direction) {
            const delta = args.pages ? Math.round(parseFloat(args.pages) * 300) : 300;
            const dx = args.direction === 'left' ? delta : args.direction === 'right' ? -delta : 0;
            const dy = args.direction === 'up' ? -delta : args.direction === 'down' ? delta : 0;
            cmd = `"${inputHelper}" scroll 0 0 ${dx} ${dy}`;
          } else if (toolName === 'drag' && args.from_x !== undefined && args.to_x !== undefined) {
            cmd = `"${inputHelper}" drag ${args.from_x} ${args.from_y} ${args.to_x} ${args.to_y}`;
          }

          if (cmd) {
            execSync(cmd, { timeout: 5000 });
            // Take a post-action screenshot to confirm
            const postScreenshot = path.join(os.tmpdir(), `post-action-${Date.now()}.png`);
            try {
              execSync(`screencapture -x -t png "${postScreenshot}"`, { timeout: 3000 });
              const imgBuf = fs.readFileSync(postScreenshot);
              const b64 = imgBuf.toString('base64');
              writeJson({
                jsonrpc: '2.0', id: msg.id,
                result: { content: [
                  { type: 'image', data: b64, mimeType: 'image/png' },
                  { type: 'text', text: `${toolName} executed at (${args.x || '?'}, ${args.y || '?'}) via input-helper` }
                ] }
              });
              try { fs.unlinkSync(postScreenshot); } catch {}
            } catch {
              writeJson({
                jsonrpc: '2.0', id: msg.id,
                result: { content: [{ type: 'text', text: `${toolName} executed via input-helper` }] }
              });
            }
          } else {
            throw new Error(`No input-helper mapping for ${toolName} with these arguments`);
          }
        } catch (e) {
          const errMsg = (e.stderr && e.stderr.toString()) || e.message || '';
          if (errMsg.includes('Accessibility permission not granted')) {
            const errResp = JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: toolName + ' requires Accessibility permission for input-helper. Grant in System Settings > Privacy & Security > Accessibility.' } });
            // Use nextTick to ensure stdout write completes before potential process exit
            process.nextTick(() => process.stdout.write(errResp + '\n'));
          } else {
            process.stderr.write(`[degraded] input tool failed: ${e.message}, forwarding to native\n`);
            forwardToNative(line, msg.id, msg);
          }
        }
        continue;
      }

      // Forward everything else to native, with timeout
      forwardToNative(line, msg.id, msg);
    } catch {
      // Non-JSON line, forward as-is
      forwardToNative(line);
    }
  }
});

process.stdin.on('end', () => {
  // Allow pending catch handlers to complete before exiting
  setTimeout(() => {
    nativeClient.kill();
    process.exit(0);
  }, 100);
});

process.on('SIGTERM', () => {
  nativeClient.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  nativeClient.kill();
  process.exit(0);
});
