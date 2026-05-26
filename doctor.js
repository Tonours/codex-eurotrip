#!/usr/bin/env node
// Local diagnostics for computer-use-local.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const STRICT = process.argv.includes('--strict') || process.env.COMPUTER_USE_STRICT === '1';

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: options.timeout || 10000,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    env: options.env || process.env,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    elapsedMs: Date.now() - started,
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error?.message,
  };
}

function ok(name, detail = '') {
  console.log(`OK   ${name}${detail ? `: ${detail}` : ''}`);
}

function warn(name, detail = '') {
  console.log(`WARN ${name}${detail ? `: ${detail}` : ''}`);
  warnings.push({ name, detail });
}

function fail(name, detail = '') {
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  failures++;
}

function summarizeCommand(name, result) {
  const detail = `${result.elapsedMs}ms`;
  if (result.status === 0) {
    ok(name, detail);
  } else if (result.timedOut) {
    fail(name, `timed out after ${detail}`);
  } else {
    fail(name, `exit ${result.status ?? result.signal}; ${result.stderr.trim() || result.stdout.trim() || result.error || 'no output'}`);
  }
}

function executable(file) {
  try {
    fs.accessSync(path.join(ROOT, file), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function freshBinary(source, binary) {
  const sourcePath = path.join(ROOT, source);
  const binaryPath = path.join(ROOT, binary);
  try {
    const sourceStat = fs.statSync(sourcePath);
    const binaryStat = fs.statSync(binaryPath);
    if (binaryStat.mtimeMs + 1000 >= sourceStat.mtimeMs) {
      ok(`fresh ${binary}`, `${binary} is newer than ${source}`);
    } else {
      warn(`fresh ${binary}`, `${source} is newer; run ./build.sh before granting Accessibility`);
    }
  } catch (error) {
    fail(`fresh ${binary}`, error.message);
  }
}

function signatureStatus() {
  const result = run('/usr/bin/codesign', ['-dv', '--verbose=4', 'ax-action-helper'], { timeout: 5000 });
  if (result.status !== 0) {
    fail('codesign ax-action-helper identity', result.stderr.trim() || result.error || 'codesign failed');
    return;
  }

  const details = `${result.stdout}\n${result.stderr}`;
  if (details.includes('Identifier=dev.local.codex-eurotrip.ax-action-helper')) {
    ok('codesign ax-action-helper identity', 'dev.local.codex-eurotrip.ax-action-helper');
  } else {
    warn('codesign ax-action-helper identity', 'unexpected identifier; run ./build.sh');
  }
}

function configStatus() {
  const configPath = path.join(os.homedir(), '.codex/config.toml');
  if (!fs.existsSync(configPath)) {
    warn('codex config', `${configPath} not found`);
    return;
  }

  const config = fs.readFileSync(configPath, 'utf8');
  const activeConfig = config
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const expectedCommand = path.join(ROOT, 'run-computer-use-mcp.sh');
  if (activeConfig.includes('[mcp_servers.computer-use-local]') && activeConfig.includes(`command = "${expectedCommand}"`)) {
    ok('codex config', 'computer-use-local points to this checkout');
  } else {
    warn('codex config', 'computer-use-local does not appear to point to this checkout');
  }

  if (activeConfig.includes('notify = [') && activeConfig.includes('SkyComputerUseClient')) {
    warn('codex notify', 'notify still points to SkyComputerUseClient; MCP tools remain local, but turn-ended notifications may use native code');
  }
}

function processStatus() {
  const ps = execFileSync('/bin/ps', ['-axo', 'pid,ppid,args'], { encoding: 'utf8' });
  const lines = ps.split('\n');
  const nativeMcp = lines.filter((line) => line.includes('/SkyComputerUseClient') && line.includes(' mcp'));
  const service = lines.filter((line) => line.includes('/SkyComputerUseService'));

  if (nativeMcp.length === 0) {
    ok('native MCP process', 'SkyComputerUseClient mcp is not running');
  } else {
    warn('native MCP process', nativeMcp.join(' | '));
  }

  if (service.length === 0) {
    ok('native service', 'SkyComputerUseService is not running; local MCP does not require it');
  } else {
    warn('native service', 'SkyComputerUseService is running but local MCP should not depend on it');
  }
}

let failures = 0;
const warnings = [];

console.log(`computer-use-local doctor (${ROOT})`);

for (const file of [
  'build.sh',
  'run-computer-use-mcp.sh',
  'list-apps-helper',
  'ax-action-helper',
  'smoke-test.js',
  'schema-parity-test.js',
  'ui-e2e-test.js',
]) {
  executable(file) ? ok(`executable ${file}`) : fail(`executable ${file}`, 'missing or not executable');
}

freshBinary('list-apps-helper.swift', 'list-apps-helper');
freshBinary('ax-action-helper.swift', 'ax-action-helper');
summarizeCommand('codesign ax-action-helper', run('/usr/bin/codesign', ['-v', 'ax-action-helper'], { timeout: 5000 }));
signatureStatus();

configStatus();
processStatus();

summarizeCommand('list_apps helper', run('./list-apps-helper', [], { timeout: 5000 }));
summarizeCommand('get_app_state helper', run(process.execPath, ['get-app-state-helper.js', process.env.COMPUTER_USE_TEST_APP || 'Terminal'], { timeout: 15000 }));
summarizeCommand(
  'MCP wrapper with GUI PATH',
  run('./run-computer-use-mcp.sh', ['--print-node'], {
    env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    timeout: 3000,
  })
);

const axTree = run('./ax-action-helper', [JSON.stringify({ command: 'tree', app: 'Finder' })], { timeout: 5000 });
if (axTree.status === 0 && axTree.stdout.includes('Accessibility permission not granted')) {
  warn('Accessibility ax-action-helper', 'permission not granted');
} else {
  summarizeCommand('Accessibility ax-action-helper tree', axTree);
}

const axAction = run('./ax-action-helper', [JSON.stringify({ command: 'pressKey', app: 'Finder', key: 'Escape' })], { timeout: 5000 });
if (axTree.status === 0 && !axTree.stdout.includes('Accessibility permission not granted')) {
  summarizeCommand('Accessibility ax-action-helper', axAction);
}

summarizeCommand('MCP smoke', run(process.execPath, ['smoke-test.js'], { timeout: 15000 }));
summarizeCommand('tool schema parity', run(process.execPath, ['schema-parity-test.js'], { timeout: 15000 }));

if (failures > 0) {
  console.log(`doctor result: ${failures} failure(s)`);
  process.exit(1);
}

if (STRICT && warnings.length > 0) {
  console.log(`doctor result: ${warnings.length} strict warning(s)`);
  process.exit(1);
}

console.log('doctor result: ok');
