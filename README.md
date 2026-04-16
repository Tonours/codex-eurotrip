# Codex Eurotrip 🎒🇪🇺🇬🇧

A simple, stable way to use **Computer Use** with Codex through a manual MCP wrapper — even when geography politely disagrees.

This package provides a minimal setup that:

- use the already-installed bundled Computer Use plugin
- expose it to Codex as a **manual MCP server**
- avoids binary patching, proxy tricks, and app-signature issues

---

## Small architecture diagram

```text
Codex UI
  ↓
Settings → MCP Servers
  ↓
run-computer-use-mcp.sh
  ↓
SkyComputerUseClient (MCP client)
  ↓
SkyComputerUseService (native macOS service)
  ↓
Accessibility + Screen Recording permissions
  ↓
Control of macOS apps
```

---

## Why this works

The wrapper looks for the bundled plugin in either of these locations:

```text
~/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use
/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use
```

That plugin already contains:

- `SkyComputerUseClient`
- `SkyComputerUseService`
- signed native app bundles
- app-specific instruction bundles

Instead of depending on a dedicated in-app setup flow, this package connects Codex directly to the locally installed MCP client.

---

## Quick start

### 1. Run the helper

From inside the folder:

```bash
bash ./start-here.sh
```

Or from anywhere:

```bash
bash /path/to/codex-eurotrip/start-here.sh
```

It will:

- verify the plugin exists
- verify the native binaries are executable
- verify signature status
- copy the wrapper path to your clipboard
- print the exact values to paste into Codex

### 2. Add the MCP server in Codex

Open:

**Settings → MCP Servers**

Add a server with:

- **Name**: `computer-use-local`
- **Command**: the path printed by `start-here.sh`
- **Args**: leave empty
- **Working directory**: the folder printed by `start-here.sh`

### 3. Restart Codex

Then test with:

```text
List the Mac apps you can control.
```

---

The folder is relocatable: `start-here.sh` regenerates `computer-use.mcp.json` for its current location.

---

## Included files

- `run-computer-use-mcp.sh` — starts the native Computer Use MCP client
- `computer-use.mcp.json` — optional importable config
- `start-here.sh` — setup helper
- `doctor.sh` — healthcheck
- `README.md` — this file

---

## Healthcheck

Run:

```bash
bash ./doctor.sh
```

It checks:

- plugin directory exists
- app bundle exists
- MCP client exists
- service binary exists
- app signature is valid

---

## Permissions

If Codex sees the MCP server but actions fail, the issue is usually macOS permissions.

Check:

- **System Settings → Privacy & Security → Accessibility**
- **System Settings → Privacy & Security → Screen Recording**

Grant access to:

- **Codex**
- **Codex Computer Use**

Important: in practice, allowing only `Codex Computer Use` is often not enough.
You usually need to allow **Codex itself** as well, especially under **Accessibility**.

Recommended setup:

- **Accessibility**: enable `Codex` and `Codex Computer Use`
- **Screen Recording**: enable at least `Codex Computer Use`

Then fully quit and restart Codex.

---

## Recommended test prompts

```text
List the Mac apps you can control.
```

```text
Open Finder and go to my Desktop.
```

```text
Open Notes and create a note titled "Computer Use test".
```

```text
Use computer use, not browser tools.
```

---

## Troubleshooting

### Codex does not see the MCP server

- re-open **Settings → MCP Servers**
- verify the command path exactly matches the wrapper
- restart Codex
- open a new conversation

### Computer Use is connected but authorization still fails

Most likely missing macOS permissions.

Re-check:

- **Accessibility** → `Codex` and `Codex Computer Use`
- **Screen Recording** → `Codex Computer Use`

If you just changed a toggle, fully quit and relaunch Codex before testing again.

### Wrapper fails

Run directly:

```bash
bash ./run-computer-use-mcp.sh
```

Then run:

```bash
bash ./doctor.sh
```

### Plugin disappeared after a Codex update

Re-run:

```bash
bash ./doctor.sh
```

If nothing is found, install Codex again and launch it once, then retry.
