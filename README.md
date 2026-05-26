# Codex Eurotrip

Local Computer Use MCP server for macOS.

The bundled Codex `SkyComputerUseClient` can hang when it is launched directly
and asks for nested MCP elicitation. This wrapper keeps the MCP server local and
implements the Codex Computer Use tool schema with macOS APIs, so it does not
depend on region availability, VPN routing, or the native XPC service for normal
use.

## Setup

Build the local helpers first:

```bash
./build.sh
```

Then add or update `~/.codex/config.toml`:

```toml
notify = ["/usr/bin/true"]

[mcp_servers.computer-use-local]
command = "<repo>/run-computer-use-mcp.sh"
cwd = "<repo>"
enabled = true
startup_timeout_sec = 120
```

Replace `<repo>` with the absolute path to this checkout.

The `notify` line disables native Computer Use turn notifications. If your config
already has a top-level `notify` setting, update that existing key deliberately
instead of adding a duplicate. In particular, remove any `notify` command that
still launches `SkyComputerUseClient`.

Restart the Codex process that owns the thread after editing config.

## Permissions

- `list_apps`: no extra permission.
- `get_app_state` and actions: Screen Recording for the process that launches the MCP server.
- Accessibility for `ax-action-helper`.

Run `./build.sh` before granting Accessibility. Rebuilding `ax-action-helper`
afterward can require granting Accessibility again.

## Tools

Implemented locally:
`list_apps`, `get_app_state`, `click`, `perform_secondary_action`, `set_value`,
`select_text`, `scroll`, `drag`, `press_key`, `type_text`.

Startup probes return empty lists:
`resources/list`, `resources/templates/list`, `prompts/list`.

## Files

| File | Purpose |
| --- | --- |
| `run-computer-use-mcp.sh` | Codex MCP entry point |
| `local-list-apps.js` | MCP server |
| `get-app-state-helper.js` | Window state and screenshot helper |
| `list-apps-helper(.swift)` | App listing helper and source |
| `ax-action-helper(.swift)` | Accessibility/action helper and source |
| `build.sh` | Compile and sign helpers |
| `doctor.js` | Readiness check |
| `smoke-test.js` | MCP smoke test |
| `schema-parity-test.js` | Tool schema parity check |
| `ui-e2e-test.js` | Optional TextEdit UI action test |

## Validation

Required local readiness checks:

```bash
./build.sh
node --check local-list-apps.js
node --check get-app-state-helper.js
node smoke-test.js
node doctor.js --strict
```

`doctor.js --strict` must pass before considering the setup ready.

Optional native schema parity check:

```bash
node schema-parity-test.js
```

This compares local tool schemas against the bundled native
`SkyComputerUseClient`, so it requires the native client to be installed or
`COMPUTER_USE_NATIVE_CLIENT_BIN` to point to it. It is not required for normal
local setup.

Optional real UI test:

```bash
COMPUTER_USE_RUN_UI_E2E=1 node ui-e2e-test.js
```
