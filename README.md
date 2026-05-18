# Codex Eurotrip

Manual MCP setup for Codex Computer Use on macOS.

## TL;DR

Use the native wrapper as the main MCP server:

```text
./run-computer-use-mcp.sh
```

Do **not** use `run-mcp-proxy.sh` as the main Codex MCP command. It is only for
debugging the known native `list_apps` issue.

## How it works

```text
Codex
  ↓
run-computer-use-mcp.sh
  ↓
SkyComputerUseClient
  ↓
SkyComputerUseService
```

This path is validated for native UI tools such as `get_app_state`, `click`, and
`type_text`.

Known limitation: native `list_apps` can hang. The local proxy can test that one
tool separately without becoming the main server.

## Install

```bash
bash ./start-here.sh
```

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
- Experimental `list_apps` proxy: `METRIC list_apps_success=1`

## Files

| File | Purpose |
|---|---|
| `run-computer-use-mcp.sh` | Stable MCP entry point |
| `start-here.sh` | Generates local config and prints setup values |
| `doctor.sh` | Checks native plugin and local helper files |
| `test-suite.sh` | Runs the local non-UI test suite |
| `test-list-apps.sh` | Tests the experimental `list_apps` proxy |
| `run-mcp-proxy.sh` | Experimental `list_apps` proxy entry |
| `local-list-apps.js` | Experimental proxy implementation |
| `list-apps-helper(.swift)` | Local app lister used by the proxy |

## Permissions

Enable in **System Settings -> Privacy & Security**:

- **Accessibility**: `Codex` and `Codex Computer Use`
- **Screen Recording**: `Codex Computer Use`

Restart Codex after changing permissions.

## Rebuild helper

```bash
swiftc list-apps-helper.swift -o list-apps-helper
```
