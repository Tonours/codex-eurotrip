# Codex Eurotrip

Manual MCP setup for Codex Computer Use on macOS.

## TL;DR

Use the local wrapper as the main MCP server:

```text
./run-computer-use-mcp.sh
```

The wrapper runs the native Computer Use client and intercepts `list_apps` with a
local macOS app query, because the native `list_apps` call can hang.

## How it works

```text
Codex
  ↓
run-computer-use-mcp.sh
  ↓
local-list-apps.js
  ├─ list_apps → list-apps-helper
  ↓
SkyComputerUseClient
  ↓
SkyComputerUseService
```

This path is validated for native UI tools such as `get_app_state`, `click`, and
`type_text`, while `list_apps` is served locally.

## Install

```bash
bash ./start-here.sh
```

The wrapper needs a Node.js runtime for the local proxy. It uses `node` from
`PATH` when available, otherwise it falls back to Codex.app's bundled Node at
`/Applications/Codex.app/Contents/Resources/node`.

Then in Codex:

- **Name**: `computer-use-local`
- **Command**: printed by `start-here.sh`
- **Args**: empty
- **Working directory**: printed by `start-here.sh`

Restart Codex after changing MCP settings.

## Test

Automated local checks:

```bash
bash ./test-suite.sh
```

Manual Codex checks after restart:

```text
Open TextEdit and create a short note.
Open Safari and tell me what window is visible.
```

The automated suite intentionally does not drive live UI actions. Use Codex
Computer Use for that E2E check.

## Known Good

Validated:

- `get_app_state`: TextEdit, Finder, Safari
- `click`: Finder and TextEdit menus
- `type_text`: TextEdit
- TextEdit flow: create, save, edit, save again, verify file content
- `list_apps` through the configured wrapper

## Files

| File | Purpose |
|---|---|
| `run-computer-use-mcp.sh` | Stable MCP entry point, including the `list_apps` fix |
| `start-here.sh` | Generates local config and prints setup values |
| `doctor.sh` | Checks native plugin and local helper files |
| `test-suite.sh` | Runs the local non-UI test suite |
| `test-list-apps.sh` | Tests the `list_apps` proxy path |
| `run-mcp-proxy.sh` | Direct proxy entry for focused debugging |
| `local-list-apps.js` | Proxy implementation |
| `list-apps-helper(.swift)` | Local app lister used for `list_apps` |

## Permissions

Enable in **System Settings -> Privacy & Security**:

- **Accessibility**: `Codex` and `Codex Computer Use`
- **Screen Recording**: `Codex Computer Use`

Restart Codex after changing permissions.

## Rebuild helper

```bash
swiftc list-apps-helper.swift -o list-apps-helper
```
