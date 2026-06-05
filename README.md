# myai-extension

## What Is This?

`myai-extension` is a VS Code-based IDE extension that provides real-time and post-hoc visibility into AI agent behavior, with a focus on MCP (Model Context Protocol) tool usage.

When an AI agent (Copilot, Cursor, or any MCP-compatible agent) processes a prompt, the extension shows you what's happening behind the scenes: which tools are being called, with what arguments, how long each call takes, and what was returned. After the agent finishes, you can review the full session timeline.

## Why This Exists

AI agents operating in editors are increasingly autonomous — they can read files, run searches, call external services, and chain multiple tool calls together to fulfill a single prompt. This activity is currently invisible to the user. You submit a prompt and eventually get a result, with no insight into what happened in between.

This extension addresses that gap by acting as an observable MCP proxy layer between the agent and its tools.

## Core Concepts

### MCP Proxy

The extension manages a shared background daemon (`~/.myai/`) that a single proxy server shared across all open IDE windows. Every tool call passes through this proxy, which records request/response pairs, timing, and correlation metadata before forwarding to the real server.

The user reconfigures their MCP tool endpoints (in `mcp.json` or VS Code/Cursor settings) to point at the proxy instead of the real servers. The proxy transparently forwards all calls.

### Shared IPC Daemon

All open IDE windows (VS Code, Cursor, or any VS Code fork) connect to a single shared daemon process rather than each window running its own proxy. This means:

- Events from all open windows are visible in any panel, with per-IDE and per-workspace filters.
- Only one proxy port is used system-wide (dynamically selected from 7331–7360).
- The daemon exits automatically when the last window closes.

The daemon writes its state to `~/.myai/daemon.json`:

```json
{ "pid": 12345, "socketPath": "/Users/you/.myai/ipc.sock", "startedAt": 1700000000000 }
```

#### `~/.myai/` directory structure

| Path | Purpose |
|---|---|
| `~/.myai/daemon.json` | Daemon PID, proxy port, socket path (written at startup) |
| `~/.myai/ipc.sock` | Unix domain socket for per-window → daemon IPC |
| `~/.myai/ipc.lock` | Bootstrap lock (prevents duplicate daemon spawns) |
| `~/.myai/stdio-wrapper.js` | Deployed wrapper script injected into `mcp.json` entries |
| `~/.myai/logs/{ide}/{workspace}.jsonl` | Persistent NDJSON event log per IDE/workspace |

#### Manual daemon restart

If the daemon gets into a bad state (e.g., stale lock after a crash):

1. Kill the daemon: `kill $(jq .pid ~/.myai/daemon.json)`
2. Remove stale files: `rm -f ~/.myai/ipc.sock ~/.myai/ipc.lock`
3. Reload any open VS Code/Cursor window (⌘⇧P → "Developer: Reload Window")

The extension will automatically spawn a fresh daemon on next activation.

### Event Stream

The proxy emits a structured event stream (SSE) for every tool lifecycle event: `tool_call_started`, `tool_call_completed`, `tool_call_failed`. Each window's extension subscribes to the daemon's SSE stream and relays events to its local webview panel in real time.

Events carry attribution fields for filtering and display:

- `ide` — which IDE initiated the call (e.g. `vscode`, `cursor`)
- `workspaceSlug` — the workspace the call came from
- `conversationId` — the VS Code chat session that triggered the call (captured on the event type; not currently rendered in the panel)

### WebView Panel

A VS Code WebView panel renders the live activity feed and historical session log. The panel layout has two columns: a connections sidebar on the left and a main content area on the right.

The main content area contains:

- A **filter bar** with five controls:
  - **Sort order** — toggle between newest-first and oldest-first log ordering
  - **Tool name** — text search for substring matches on tool names (case-insensitive)
  - **Server** — select to show calls from a specific MCP server (populated dynamically as events arrive)
  - **Status** — filter by call status: All, In-progress, Completed, or Failed
  - **Time range** — filter by recency: All, Last hour, or Today
- A **log** showing the tool call timeline:
  - A left-side timestamp column for each call row (wall-clock time)
  - Which tool is currently executing (with a spinner)
  - A timeline of all tool calls in the current session
  - Expandable detail for each call: arguments, response, duration, status, and `meta` when present

The connections sidebar shows all currently connected IDE windows. Each connection has a checkbox to show or hide tool calls from that window. This filter state persists in `localStorage` across panel reloads. Filter bar state (tool name, server, status, time) resets each time the panel opens.

## Compatibility

This extension uses only the standard VS Code extension API (`vscode.*`) and is intended to be fully compatible with all VSCodium-based editors without modification. VS Code and Cursor are both explicitly supported; both can connect to the same daemon simultaneously.

## MCP Monitoring

MyAI can monitor stdio MCP servers by wrapping your user `mcp.json` entries.

### Enable Monitoring

Run `MyAI: Enable MCP Monitoring` from the Command Palette.

- MyAI detects whether you are running VS Code or Cursor.
- MyAI resolves your user config path (`mcp.json`) and shows it before making changes.
- You will usually see one trust prompt per MCP server after the file is rewritten.

### Disable Monitoring

Run `MyAI: Disable MCP Monitoring`.

- MyAI restores each wrapped entry back to its original command/args/env.
- If nothing is wrapped, MyAI shows an informational message and leaves files unchanged.

### If Extension Is Uninstalled Before Disable

This extension includes a `vscode:uninstall` lifecycle script that attempts to restore wrapped entries automatically and remove `~/.myai/`.

If that hook does not run in your environment:

1. Reinstall and run `MyAI: Disable MCP Monitoring`, or
2. Manually restore entries by replacing wrapped `node ~/.myai/stdio-wrapper.js ...` entries with the original values stored in `MYAI_REAL_SERVER`.

## What This Extension Cannot Do

- Observe the model's internal reasoning or chain-of-thought (not exposed by any editor)
- Intercept built-in (non-MCP) tool calls made natively by Copilot or Cursor
- Access LLM API traffic directly (that is handled by the editor, not the extension)

## Intended Audience

Developers building or debugging AI agent workflows who want operational visibility into MCP tool usage without leaving their editor.

## AI Prompts and Skills

This repository ships OpenSpec workflow prompts and skills for both GitHub Copilot and Cursor.

- **Skills** live in `.agents/skills/` — the [Agent Skills](https://agentskills.io/specification) cross-client convention, scanned directly by compatible clients.

### Skill Quality Analysis on Save

The [Chat Customizations Evaluations](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-chat-customizations-evaluations) extension analyzes skill files for issues (ambiguous activation conditions, persona conflicts, missing inline summaries, etc.). To trigger analysis automatically on every save of a `SKILL.md` file, add this to your `keybindings.json` (`Cmd+Shift+P` → "Preferences: Open Keyboard Shortcuts (JSON)"):

```json
{
    "key": "cmd+s",
    "command": "runCommands",
    "args": {
        "commands": [
            "workbench.action.files.save",
            "chatCustomizationsEvaluations.analyzePrompt"
        ]
    },
    "when": "editorTextFocus && resourceFilename == 'SKILL.md'"
}
```
