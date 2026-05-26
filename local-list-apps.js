#!/usr/bin/env node
// Standalone MCP server for local Codex Computer Use on macOS.
//
// The native SkyComputerUseClient can hang waiting for nested MCP elicitation
// when it is launched directly from the Desktop app or CLI. This server keeps
// all core Computer Use tools local and exposes the same tool schemas as the
// bundled Codex Computer Use server.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const LIST_APPS_HELPER = path.join(SCRIPT_DIR, 'list-apps-helper');
const GET_APP_STATE_HELPER = path.join(SCRIPT_DIR, 'get-app-state-helper.js');
const AX_ACTION_HELPER = path.join(SCRIPT_DIR, 'ax-action-helper');

const LOCAL_SERVER_VERSION = 'local-2026-05-26';

const LOCAL_TOOLS = [
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    description:
      'List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days, including details on usage frequency',
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: 'object',
    },
    name: 'list_apps',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    description:
      "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app",
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
      },
      required: ['app'],
      type: 'object',
    },
    name: 'get_app_state',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description: 'Click an element by index or pixel coordinates from screenshot',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        click_count: {
          description: 'Number of clicks. Defaults to 1',
          type: 'integer',
        },
        element_index: {
          description: 'Element index to click',
          type: 'string',
        },
        mouse_button: {
          description: 'Mouse button to click. Defaults to left.',
          enum: ['left', 'right', 'middle'],
          type: 'string',
        },
        x: {
          description: 'X coordinate in screenshot pixel coordinates',
          type: 'number',
        },
        y: {
          description: 'Y coordinate in screenshot pixel coordinates',
          type: 'number',
        },
      },
      required: ['app'],
      type: 'object',
    },
    name: 'click',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description: 'Invoke a secondary accessibility action exposed by an element',
    inputSchema: {
      additionalProperties: false,
      properties: {
        action: {
          description: 'Secondary accessibility action name',
          type: 'string',
        },
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        element_index: {
          description: 'Element identifier',
          type: 'string',
        },
      },
      required: ['app', 'element_index', 'action'],
      type: 'object',
    },
    name: 'perform_secondary_action',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description: 'Set the value of a settable accessibility element',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        element_index: {
          description: 'Element identifier',
          type: 'string',
        },
        value: {
          description: 'Value to assign',
          type: 'string',
        },
      },
      required: ['app', 'element_index', 'value'],
      type: 'object',
    },
    name: 'set_value',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description:
      'Select text inside a text element, or place the text cursor before or after it. Provide text exactly as it appears in the accessibility tree, including any Markdown formatting. If the text is not unique, provide surrounding prefix or suffix text to disambiguate it.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name or bundle identifier',
          type: 'string',
        },
        element_index: {
          description: 'Text element identifier',
          type: 'string',
        },
        prefix: {
          description: 'Optional text immediately before the target, used to disambiguate repeated matches',
          type: 'string',
        },
        selection: {
          description: 'Whether to select the text or place the cursor before or after it. Defaults to text.',
          enum: ['text', 'cursor_before', 'cursor_after'],
          type: 'string',
        },
        suffix: {
          description: 'Optional text immediately after the target, used to disambiguate repeated matches',
          type: 'string',
        },
        text: {
          description: 'Target text as shown in the accessibility tree',
          type: 'string',
        },
      },
      required: ['app', 'element_index', 'text'],
      type: 'object',
    },
    name: 'select_text',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description: 'Scroll an element in a direction by a number of pages',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        direction: {
          description: 'Scroll direction: up, down, left, or right',
          type: 'string',
        },
        element_index: {
          description: 'Element identifier',
          type: 'string',
        },
        pages: {
          description: 'Number of pages to scroll. Fractional values are supported. Defaults to 1',
          type: 'number',
        },
      },
      required: ['app', 'element_index', 'direction'],
      type: 'object',
    },
    name: 'scroll',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description: 'Drag from one point to another using pixel coordinates',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        from_x: {
          description: 'Start X coordinate',
          type: 'number',
        },
        from_y: {
          description: 'Start Y coordinate',
          type: 'number',
        },
        to_x: {
          description: 'End X coordinate',
          type: 'number',
        },
        to_y: {
          description: 'End Y coordinate',
          type: 'number',
        },
      },
      required: ['app', 'from_x', 'from_y', 'to_x', 'to_y'],
      type: 'object',
    },
    name: 'drag',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description:
      'Press a key or key-combination on the keyboard, including modifier and navigation keys.\n  - This supports xdotool\'s `key` syntax.\n  - Examples: "a", "Return", "Tab", "super+c", "Up", "KP_0" (for the numpad 0 key).',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        key: {
          description: 'Key or key combination to press',
          type: 'string',
        },
      },
      required: ['app', 'key'],
      type: 'object',
    },
    name: 'press_key',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    description: 'Type literal text using keyboard input',
    inputSchema: {
      additionalProperties: false,
      properties: {
        app: {
          description: 'App name, full app path, or unambiguous bundle identifier',
          type: 'string',
        },
        text: {
          description: 'Literal text to type',
          type: 'string',
        },
      },
      required: ['app', 'text'],
      type: 'object',
    },
    name: 'type_text',
  },
];

function writeJson(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function result(id, value) {
  writeJson({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message) {
  writeJson({ jsonrpc: '2.0', id, error: { code, message } });
}

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

function textToolResult(text) {
  return { content: [{ type: 'text', text }] };
}

function listAppsLocal() {
  try {
    return execJson(LIST_APPS_HELPER, [], { timeout: 5000 });
  } catch (helperError) {
    try {
      const names = execText('/usr/bin/osascript', [
        '-e',
        'tell application "System Events" to get name of every process whose background only is false',
      ], { timeout: 3000 });
      const apps = names.split(', ').filter(Boolean).map((name) => ({
        bundleIdentifier: name.trim(),
        appName: name.trim(),
        isRunning: true,
        usageFrequency: 'frequently',
      }));
      return { apps, totalRunning: apps.length, totalInstalled: apps.length };
    } catch {
      return {
        apps: [],
        totalRunning: 0,
        totalInstalled: 0,
        error: `Failed to list apps: ${helperError.message}`,
      };
    }
  }
}

function getAppStateLocal(args) {
  if (!args.app) throw new Error('Missing app argument');
  const parsed = execJson(process.execPath, [GET_APP_STATE_HELPER, args.app], {
    timeout: 15000,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (parsed.error) throw new Error(parsed.error);
  if (!Array.isArray(parsed.content)) {
    return textToolResult(JSON.stringify(parsed));
  }
  return parsed;
}

function runAxAction(command, args) {
  if (!fs.existsSync(AX_ACTION_HELPER)) {
    throw new Error(`Missing ax-action-helper binary at ${AX_ACTION_HELPER}. Rebuild it with swiftc.`);
  }

  const payload = { ...args, command };
  const parsed = execJson(AX_ACTION_HELPER, [JSON.stringify(payload)], {
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (!parsed.ok) {
    throw new Error(parsed.error || `${command} failed`);
  }
  return parsed;
}

function actionStateResult(args, fallbackText) {
  try {
    return getAppStateLocal(args);
  } catch (stateError) {
    return textToolResult(`${fallbackText}. Could not read updated app state: ${stateError.message}`);
  }
}

function handleToolCall(id, name, args) {
  switch (name) {
    case 'list_apps':
      return result(id, textToolResult(JSON.stringify(listAppsLocal(), null, 2)));

    case 'get_app_state':
      return result(id, getAppStateLocal(args));

    case 'click': {
      if (args.element_index !== undefined) {
        runAxAction('clickElement', args);
        return result(id, actionStateResult(args, `click executed locally on element ${args.element_index}`));
      }
      if (args.x !== undefined && args.y !== undefined) {
        runAxAction('clickPoint', args);
        return result(id, actionStateResult(args, `click executed locally at ${args.x},${args.y}`));
      }
      throw new Error('click requires element_index or x/y coordinates');
    }

    case 'perform_secondary_action':
      runAxAction('performAction', args);
      return result(id, actionStateResult(args, `perform_secondary_action executed locally: ${args.action}`));

    case 'set_value':
      runAxAction('setValue', args);
      return result(id, actionStateResult(args, `set_value executed locally on element ${args.element_index}`));

    case 'select_text':
      runAxAction('selectText', args);
      return result(id, actionStateResult(args, `select_text executed locally on element ${args.element_index}`));

    case 'scroll':
      runAxAction('scrollElement', args);
      return result(id, actionStateResult(args, `scroll executed locally ${args.direction || 'down'} on element ${args.element_index}`));

    case 'drag':
      runAxAction('drag', args);
      return result(id, actionStateResult(args, 'drag executed locally'));

    case 'press_key':
      runAxAction('pressKey', args);
      return result(id, actionStateResult(args, `press_key executed locally: ${args.key}`));

    case 'type_text':
      runAxAction('typeText', args);
      return result(id, actionStateResult(args, 'type_text executed locally'));

    default:
      throw new Error(`Unknown Computer Use tool: ${name}`);
  }
}

function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === 'initialize') {
    return result(msg.id, {
      capabilities: { tools: { listChanged: false } },
      protocolVersion: msg.params?.protocolVersion || '2025-06-18',
      serverInfo: {
        name: 'Computer Use',
        version: LOCAL_SERVER_VERSION,
      },
    });
  }

  if (msg.method === 'notifications/initialized') {
    return;
  }

  if (msg.method === 'ping') {
    return result(msg.id, {});
  }

  if (msg.method === 'tools/list') {
    return result(msg.id, { tools: LOCAL_TOOLS });
  }

  if (msg.method === 'resources/list') {
    return result(msg.id, { resources: [] });
  }

  if (msg.method === 'resources/templates/list') {
    return result(msg.id, { resourceTemplates: [] });
  }

  if (msg.method === 'prompts/list') {
    return result(msg.id, { prompts: [] });
  }

  if (msg.method === 'tools/call') {
    try {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      return handleToolCall(msg.id, name, args);
    } catch (toolError) {
      return error(msg.id, -32000, toolError.message);
    }
  }

  if (msg.id !== undefined && msg.id !== null) {
    return error(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

let stdinBuffer = '';

process.stdin.on('data', (data) => {
  stdinBuffer += data.toString();
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() || '';

  for (const line of lines) {
    if (line.trim()) handleMessage(line);
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
