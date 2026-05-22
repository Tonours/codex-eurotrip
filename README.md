# Codex Eurotrip 🎒🇪🇺🇬🇧

A simple, stable way to use **Computer Use** with Codex through a manual MCP wrapper — even when geography politely disagrees.

## What it does

Codex Computer Use requires the native `SkyComputerUseService` running alongside the
Desktop app. This wrapper proxies tool calls through the authenticated native client
when the service is running, and falls back to local screencapture/AppleScript otherwise.

## Setup

```bash
# 1. Start the XPC service (auto-restarts via LaunchAgent)
./launch-service.sh

# 2. Add to ~/.codex/config.toml:
```
```toml
[mcp_servers.computer-use-local]
command = "/Volumes/Crucial/codex-eurotrip/run-computer-use-mcp.sh"
cwd = "/Volumes/Crucial/codex-eurotrip"
enabled = true
```
```bash
# 3. Restart Codex
```

## Tool status

| Tool | With service | Without service |
|------|-------------|-----------------|
| `list_apps` | ✅ native | ✅ local helper |
| `get_app_state` | ✅ native | ✅ screencapture |
| `click` `type_text` `press_key` `scroll` `drag` | ✅ native | 🔒 needs Accessibility |
| `set_value` `select_text` `perform_secondary_action` | ✅ native | ⏱ timeout |

## Files

| File | Purpose |
|------|---------|
| `run-computer-use-mcp.sh` | Entry point Codex launches |
| `local-list-apps.js` | MCP proxy + routing logic |
| `get-app-state-helper.js` | Screenshot + window info |
| `list-apps-helper` | App listing (NSWorkspace) |
| `input-helper` | Click/type/scroll/drag (CGEvent) |
| `ax-tree-helper` | Full AX tree extraction |
| `launch-service.sh` | Start SkyComputerUseService |
| `*.swift` | Sources for compiled helpers |
