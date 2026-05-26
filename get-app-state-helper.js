#!/usr/bin/env node
// Local get_app_state implementation for Codex Computer Use.
// It returns the same MCP content shape as the native tool: a screenshot block
// followed by an accessibility-tree text block when available.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = __dirname;
const LIST_APPS_HELPER = path.join(SCRIPT_DIR, 'list-apps-helper');
const AX_HELPER = path.join(SCRIPT_DIR, 'ax-action-helper');

const appArg = process.argv[2];
if (!appArg) {
  process.stderr.write('Usage: get-app-state-helper <app_name_or_bundle_id_or_path>\n');
  process.exit(1);
}

const BUNDLE_MAP = {
  'com.google.Chrome': 'Google Chrome',
  'com.apple.finder': 'Finder',
  'com.apple.Safari': 'Safari',
  'com.apple.TextEdit': 'TextEdit',
  'com.apple.Notes': 'Notes',
  'com.apple.mail': 'Mail',
  'com.microsoft.VSCode': 'Code',
  'com.apple.Terminal': 'Terminal',
  'com.mitchellh.ghostty': 'Ghostty',
  'com.googlecode.iterm2': 'iTerm2',
  'com.openai.codex': 'Codex',
  'com.tdesktop.Telegram': 'Telegram',
  'com.anthropic.claudefordesktop': 'Claude',
};

function execText(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    timeout: options.timeout || 5000,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
    env: process.env,
  }).trim();
}

function execJson(file, args, options = {}) {
  const text = execText(file, args, options);
  return JSON.parse(text || '{}');
}

function runOsa(script) {
  const tmp = path.join(os.tmpdir(), `osa-${process.pid}-${Date.now()}.applescript`);
  try {
    fs.writeFileSync(tmp, script);
    return execText('/usr/bin/osascript', [tmp], { timeout: 5000 }).replace(/\r/g, '');
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function osaString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function getApps() {
  try {
    const data = execJson(LIST_APPS_HELPER, [], { timeout: 3000 });
    return Array.isArray(data.apps) ? data.apps : [];
  } catch {
    return [];
  }
}

function resolveApp(id) {
  const apps = getApps();
  const lowered = id.toLowerCase();

  const exactBundle = apps.find((app) => app.bundleIdentifier === id);
  if (exactBundle) return exactBundle;

  const exactPath = apps.find((app) => app.bundlePath === id);
  if (exactPath) return exactPath;

  const exactName = apps.find((app) => (app.appName || '').toLowerCase() === lowered);
  if (exactName) return exactName;

  if (id.includes('.')) {
    const last = id.split('.').pop().toLowerCase();
    const byLastBundlePart = apps.find((app) =>
      (app.bundleIdentifier || '').split('.').pop().toLowerCase() === last
    );
    if (byLastBundlePart) return byLastBundlePart;
  }

  if (BUNDLE_MAP[id]) {
    return {
      bundleIdentifier: id,
      appName: BUNDLE_MAP[id],
      bundlePath: '',
      isRunning: false,
    };
  }

  return null;
}

function launchIfNeeded(app) {
  if (app.isRunning) return resolveApp(app.bundleIdentifier) || app;

  const args = app.bundleIdentifier
    ? ['-b', app.bundleIdentifier]
    : app.bundlePath
      ? [app.bundlePath]
      : ['-a', app.appName];

  execFileSync('/usr/bin/open', args, { timeout: 10000, stdio: 'ignore' });

  const target = app.bundleIdentifier || app.bundlePath || app.appName;
  for (let i = 0; i < 40; i++) {
    const resolved = resolveApp(target);
    if (resolved?.isRunning) return resolved;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }

  return resolveApp(target) || app;
}

function getAxData(bundleId) {
  if (!bundleId || !fs.existsSync(AX_HELPER)) return null;
  try {
    const data = execJson(AX_HELPER, [JSON.stringify({ command: 'tree', app: bundleId })], { timeout: 5000 });
    if (data && data.ok === false) return { error: data.error, bundleId: data.bundleId || bundleId };
    return data;
  } catch {
    return null;
  }
}

function getBoundsFromAppleScript(appName) {
  const boundsStr = runOsa(`
tell application ${osaString(appName)}
  try
    set b to bounds of front window
    set x1 to item 1 of b as text
    set y1 to item 2 of b as text
    set x2 to item 3 of b as text
    set y2 to item 4 of b as text
    return x1 & "," & y1 & "," & x2 & "," & y2
  on error
    return "NO_WINDOW"
  end try
end tell
`);

  if (!boundsStr || boundsStr === 'NO_WINDOW') return null;
  const [x1, y1, x2, y2] = boundsStr.split(',').map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, title: '' };
}

function captureBounds(bounds) {
  const screenshotPath = path.join(os.tmpdir(), `app-state-${process.pid}-${Date.now()}.png`);
  try {
    execFileSync('/usr/sbin/screencapture', [
      '-R',
      `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`,
      '-x',
      '-t',
      'png',
      screenshotPath,
    ], { timeout: 5000, stdio: 'ignore' });

    return fs.readFileSync(screenshotPath).toString('base64');
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(screenshotPath); } catch {}
  }
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function formatAxTree(axData, app) {
  const lines = [];
  let nodeIndex = 0;

  const x = formatNumber(axData.x);
  const y = formatNumber(axData.y);
  const width = formatNumber(axData.width);
  const height = formatNumber(axData.height);
  const title = axData.title || app.appName || '';
  lines.push(`Window "${title}" [${x},${y},${x + width},${y + height}]`);

  function formatNode(node, depth) {
    if (!node) return;
    const indent = '  '.repeat(depth);
    const role = node.role || 'unknown';
    const titleText = node.title || '';
    const value = node.value !== undefined ? `="${node.value}"` : '';
    const desc = node.description ? ` (${node.description})` : '';
    const hasPosition = node.x !== undefined && node.y !== undefined;
    const pos = hasPosition
      ? ` [@${formatNumber(node.x)},${formatNumber(node.y)} ${formatNumber(node.width)}x${formatNumber(node.height)}]`
      : '';
    const focused = node.focused ? ' [FOCUSED]' : '';
    const enabled = node.enabled === false ? ' [DISABLED]' : '';
    const idx = `[${nodeIndex}]`;
    nodeIndex++;

    lines.push(`${indent}${idx} ${role}${desc} "${titleText}"${value}${pos}${focused}${enabled}`);

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        formatNode(child, depth + 1);
      }
    }
  }

  if (axData.tree) {
    formatNode(axData.tree, 1);
  } else {
    lines.push(`  App: ${app.appName || app.bundleIdentifier}`);
    if (axData.error) lines.push(`  AX: ${axData.error}`);
  }

  return lines.join('\n');
}

function getAppState(appId) {
  const resolved = resolveApp(appId);
  if (!resolved) {
    return { error: `Could not resolve app: ${appId}`, app: appId, isRunning: false };
  }

  let app;
  try {
    app = launchIfNeeded(resolved);
  } catch (error) {
    return {
      error: `Could not launch app: ${resolved.appName || appId}: ${error.message}`,
      app: appId,
      isRunning: false,
    };
  }

  const axData = getAxData(app.bundleIdentifier);
  const bounds = axData && axData.x !== undefined && axData.y !== undefined
    ? {
        x: Number(axData.x),
        y: Number(axData.y),
        width: Number(axData.width || 0),
        height: Number(axData.height || 0),
        title: axData.title || '',
      }
    : getBoundsFromAppleScript(app.appName);

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    const reason = axData?.error ? ` AX: ${axData.error}.` : '';
    return {
      content: [{
        type: 'text',
        text: `App "${app.appName || app.bundleIdentifier}" is running but no key window was found.${reason}`,
      }],
    };
  }

  const content = [];
  const screenshotB64 = captureBounds(bounds);
  if (screenshotB64) {
    content.push({ type: 'image', data: screenshotB64, mimeType: 'image/png' });
  }

  if (axData) {
    content.push({ type: 'text', text: formatAxTree({ ...axData, ...bounds }, app) });
  } else {
    const x1 = formatNumber(bounds.x);
    const y1 = formatNumber(bounds.y);
    const x2 = x1 + formatNumber(bounds.width);
    const y2 = y1 + formatNumber(bounds.height);
    content.push({
      type: 'text',
      text: [
        `Window "${bounds.title || ''}" [${x1},${y1},${x2},${y2}]`,
        `  App: ${app.appName || app.bundleIdentifier}`,
        `  Size: ${formatNumber(bounds.width)}x${formatNumber(bounds.height)}`,
      ].join('\n'),
    });
  }

  return { content };
}

console.log(JSON.stringify(getAppState(appArg)));
