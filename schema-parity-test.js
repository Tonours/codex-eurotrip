#!/usr/bin/env node
// Compare local Computer Use MCP tool schemas with the bundled Codex native
// client. This only calls initialize + tools/list, so it does not trigger the
// native get_app_state hang.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const LOCAL_SERVER = path.join(ROOT, 'run-computer-use-mcp.sh');
const LIST_APPS_HELPER = path.join(ROOT, 'list-apps-helper');
const RESPONSE_TIMEOUT_MS = 8000;

function nativeClientCandidates() {
  const candidates = [];
  if (process.env.COMPUTER_USE_NATIVE_CLIENT_BIN) {
    candidates.push(process.env.COMPUTER_USE_NATIVE_CLIENT_BIN);
  }

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  candidates.push(nativeClientPath(path.join(codexHome, '.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use')));

  const codexApp = applicationPath('com.openai.codex');
  if (codexApp) {
    candidates.push(nativeClientPath(path.join(codexApp, 'Contents/Resources/plugins/openai-bundled/plugins/computer-use')));
  }

  return candidates;
}

function applicationPath(bundleId) {
  try {
    const output = execFileSync('/usr/bin/osascript', [
      '-e',
      `POSIX path of (path to application id "${bundleId}")`,
    ], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.replace(/\/$/, '');
  } catch {
    return applicationPathFromListApps(bundleId);
  }
}

function applicationPathFromListApps(bundleId) {
  try {
    const output = execFileSync(LIST_APPS_HELPER, [], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const data = JSON.parse(output);
    const app = data.apps?.find((candidate) => candidate.bundleIdentifier === bundleId);
    return app?.bundlePath || null;
  } catch {
    return null;
  }
}

function nativeClientPath(pluginRoot) {
  return path.join(
    pluginRoot,
    'Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient'
  );
}

function nativeClientCwd(clientBin) {
  return path.resolve(clientBin, '../../../../../../..');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requestTools(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let toolsResult = null;
    let killTimer = null;
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for tools/list from ${command}\n${stderr}`));
    }, RESPONSE_TIMEOUT_MS);

    function finish(error, tools) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      toolsResult = tools || null;
      try { child.stdin.end(); } catch {}
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
      if (error) {
        reject(error);
      }
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
        } catch (error) {
          finish(new Error(`Invalid JSON from ${command}: ${line}`));
          return;
        }

        if (msg.id === 2) {
          finish(null, msg.result?.tools || []);
          return;
        }
      }
    });

    child.on('exit', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (!settled) {
        clearTimeout(timeout);
        reject(new Error(`Server exited before tools/list: code=${code} signal=${signal}\n${stderr}`));
        return;
      }
      if (toolsResult) {
        resolve(toolsResult);
      }
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'computer-use-local-schema-parity', version: '0.1' },
      },
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n');
  });
}

function normalizeTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

(async () => {
  const nativeBin = nativeClientCandidates().find((candidate) => fs.existsSync(candidate));
  if (!nativeBin) {
    fail('Native SkyComputerUseClient not found; set COMPUTER_USE_NATIVE_CLIENT_BIN to compare tool schema parity.');
  }

  const [localTools, nativeTools] = await Promise.all([
    requestTools(LOCAL_SERVER, [], ROOT),
    requestTools(nativeBin, ['mcp'], nativeClientCwd(nativeBin)),
  ]);

  const localJson = JSON.stringify(normalizeTools(localTools));
  const nativeJson = JSON.stringify(normalizeTools(nativeTools));
  if (localJson !== nativeJson) {
    console.error('Computer Use tool schema mismatch.');
    console.error(`local:  ${localTools.map((tool) => tool.name).join(', ')}`);
    console.error(`native: ${nativeTools.map((tool) => tool.name).join(', ')}`);
    process.exit(1);
  }

  console.log('schema parity ok');
})().catch((error) => fail(error.stack || error.message));
