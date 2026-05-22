#!/usr/bin/env node
// Degraded get_app_state via screencapture + AppleScript
// Used when native XPC service is unavailable (CLI context)
// Provides screenshot + basic window info in native MCP response format

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_DIR = __dirname;
const appArg = process.argv[2];
if (!appArg) {
  process.stderr.write('Usage: get-app-state-helper <app_name_or_bundle_id>\n');
  process.exit(1);
}

// Run AppleScript via temp file to avoid shell escaping / locale issues
function runOsa(script) {
  const tmp = path.join(os.tmpdir(), `osa-${process.pid}-${Date.now()}.applescript`);
  try {
    fs.writeFileSync(tmp, script);
    return execSync(`osascript ${tmp}`, { timeout: 5000, encoding: 'utf8' })
      .trim().replace(/\r/g, '');
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Map common bundle IDs to AppleScript app names
const BUNDLE_MAP = {
  'com.google.Chrome': 'Google Chrome',
  'com.apple.finder': 'Finder',
  'com.apple.Safari': 'Safari',
  'com.apple.TextEdit': 'TextEdit',
  'com.apple.Notes': 'Notes',
  'com.apple.mail': 'Mail',
  'com.microsoft.VSCode': 'Visual Studio Code',
  'com.apple.Terminal': 'Terminal',
  'com.mitchellh.ghostty': 'Ghostty',
  'com.googlecode.iterm2': 'iTerm2',
  'com.openai.codex': 'Codex',
  'com.tdesktop.Telegram': 'Telegram',
  'com.anthropic.claudefordesktop': 'Claude',
};

// Cache running apps from list-apps-helper (NSWorkspace)
function getRunningApps() {
  try {
    const helper = path.join(SCRIPT_DIR, 'list-apps-helper');
    const result = execSync(helper, { timeout: 3000, encoding: 'utf8' });
    const data = JSON.parse(result.trim());
    return data.apps.filter(a => a.isRunning).map(a => ({
      bundleId: a.bundleIdentifier,
      name: a.appName,
      bundleId_last: a.bundleIdentifier.split('.').pop()
    }));
  } catch {
    return [];
  }
}

function resolveAppName(id) {
  // Direct lookup from bundle map
  if (BUNDLE_MAP[id]) return BUNDLE_MAP[id];
  
  // Validate against actually running apps
  const running = getRunningApps();
  
  // Match by bundle ID (exact)
  const byBundleId = running.find(a => a.bundleId === id);
  if (byBundleId) return byBundleId.name;
  
  // Not a bundle ID — try matching by app name
  if (!id.includes('.')) {
    const byName = running.find(a => a.name.toLowerCase() === id.toLowerCase());
    return byName ? byName.name : null;
  }
  
  // Try matching last component of bundle ID
  const last = id.split('.').pop();
  const byLast = running.find(a => a.bundleId_last.toLowerCase() === last.toLowerCase());
  return byLast ? byLast.name : null;
}

// Format AX tree data into text matching native Computer Use format
function formatAxTree(axData) {
  const lines = [];
  let nodeIndex = 0;
  
  function formatNode(node, depth) {
    if (!node) return;
    const indent = '  '.repeat(depth);
    const role = node.role || 'unknown';
    const title = node.title || '';
    const value = node.value !== undefined ? `="${node.value}"` : '';
    const desc = node.description ? ` (${node.description})` : '';
    const pos = (node.x !== undefined) ? ` [@${node.x},${node.y} ${node.width}x${node.height}]` : '';
    const focused = node.focused ? ' [FOCUSED]' : '';
    const enabled = node.enabled === false ? ' [DISABLED]' : '';
    const idx = `[${nodeIndex}]`;
    nodeIndex++;
    
    lines.push(`${indent}${idx} ${role}${desc} "${title}"${value}${pos}${focused}${enabled}`);
    
    if (node.children) {
      for (const child of node.children) {
        formatNode(child, depth + 1);
      }
    }
  }
  
  const winInfo = `Window "${axData.title || ''}" [${axData.x || 0},${axData.y || 0}, ${(axData.x || 0) + (axData.width || 0)}, ${(axData.y || 0) + (axData.height || 0)}]`;
  lines.push(winInfo);
  if (axData.tree) formatNode(axData.tree, 1);
  return lines.join('\n');
}

function getAppState(appId) {
  const appName = resolveAppName(appId);
  if (!appName) {
    return { error: `Could not resolve app: ${appId}`, app: appId, isRunning: false };
  }

  // Get window bounds
  const boundsStr = runOsa(`
tell application "${appName}"
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

  if (!boundsStr || boundsStr === 'NO_WINDOW') {
    return { app: appName, isRunning: true, hasWindow: false };
  }

  const [x1s, y1s, x2s, y2s] = boundsStr.split(',');
  const x1 = Number(x1s), y1 = Number(y1s), x2 = Number(x2s), y2 = Number(y2s);
  const width = x2 - x1;
  const height = y2 - y1;

  if (width <= 0 || height <= 0) {
    return { app: appName, isRunning: true, hasWindow: false, bounds: [x1, y1, x2, y2] };
  }

  // Get window title
  const title = runOsa(`tell application "${appName}" to get name of front window`) || '';

  // Capture screenshot of the window region
  const screenshotPath = path.join(os.tmpdir(), `app-state-${Date.now()}.png`);
  let screenshotB64 = null;
  let screenshotSize = 0;

  try {
    execSync(`screencapture -R ${x1},${y1},${width},${height} -x -t png "${screenshotPath}"`, {
      timeout: 5000
    });
    const imgBuf = fs.readFileSync(screenshotPath);
    screenshotB64 = imgBuf.toString('base64');
    screenshotSize = imgBuf.length;
  } catch {
    try {
      execSync(`screencapture -x -t png "${screenshotPath}"`, { timeout: 5000 });
      // Detect Retina scale from actual pixel dimensions vs logical screen size
      // Get logical screen dimensions from primary display (fast, cached by system)
      const screenBounds = runOsa(`
        tell application "Finder"
          set b to bounds of window of desktop
          return (item 3 of b as text) & "x" & (item 4 of b as text)
        end tell`);
      const logicalW = parseInt(screenBounds?.split('x')[0] || '1920');
      const sipsOut = execSync(`sips -g pixelWidth "${screenshotPath}"`, { encoding: 'utf8', timeout: 2000 });
      const actualPx = parseInt(sipsOut.match(/pixelWidth:\\s*(\\d+)/)?.[1] || '0');
      const scale = actualPx > 0 && logicalW > 0 ? Math.round(actualPx / logicalW) : 2;
      // Crop to window bounds using detected scale
      const px = x1 * scale, py = y1 * scale, pw = width * scale, ph = height * scale;
      try {
        execSync(`sips -c ${ph} ${pw} --cropOffset ${py} ${px} "${screenshotPath}" --out "${screenshotPath}"`, { timeout: 3000 });
      } catch { /* crop failed, use full screen */ }
      const imgBuf = fs.readFileSync(screenshotPath);
      screenshotB64 = imgBuf.toString('base64');
      screenshotSize = imgBuf.length;
    } catch {}
  } finally {
    try { fs.unlinkSync(screenshotPath); } catch {}
  }

  // Try native AX tree helper first (needs Accessibility permission)
  let axTreeText = null;
  try {
    const axHelper = path.join(SCRIPT_DIR, 'ax-tree-helper');
    if (fs.existsSync(axHelper)) {
      const axResult = execSync(`"${axHelper}" ${JSON.stringify(appId)}`, {
        timeout: 5000, encoding: 'utf8', env: process.env
      }).trim();
      const axData = JSON.parse(axResult);
      if (axData.tree) {
        // Format the AX tree as text matching native format
        axTreeText = formatAxTree(axData);
      }
    }
  } catch {
    // AX helper not available or no permission
  }

  // Build accessibility tree text (from AX helper or approximation)
  const axTree = axTreeText || [
    `Window "${title}" [${x1},${y1},${x2},${y2}]`,
    `  App: ${appName}`,
    `  Size: ${width}x${height}`,
  ].join('\n');

  // Build MCP response content blocks matching native format
  const content = [];
  if (screenshotB64) {
    content.push({ type: 'image', data: screenshotB64, mimeType: 'image/png' });
  }
  content.push({ type: 'text', text: axTree });

  return { content };
}

const result = getAppState(appArg);
console.log(JSON.stringify(result));
