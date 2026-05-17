# myai-extension

## What Is This?

`myai-extension` is a VS Code-based IDE extension that provides real-time and post-hoc visibility into AI agent behavior, with a focus on MCP (Model Context Protocol) tool usage.

When an AI agent (Copilot, Cursor, or any MCP-compatible agent) processes a prompt, the extension shows you what's happening behind the scenes: which tools are being called, with what arguments, how long each call takes, and what was returned. After the agent finishes, you can review the full session timeline.

## Why This Exists

AI agents operating in editors are increasingly autonomous — they can read files, run searches, call external services, and chain multiple tool calls together to fulfill a single prompt. This activity is currently invisible to the user. You submit a prompt and eventually get a result, with no insight into what happened in between.

This extension addresses that gap by acting as an observable MCP proxy layer between the agent and its tools.

## Core Concepts

### MCP Proxy

The extension spawns a local MCP proxy server that sits between the agent and any configured MCP servers. Every tool call passes through this proxy, which records request/response pairs, timing, and correlation metadata before forwarding to the real server.

The user reconfigures their MCP tool endpoints (in `mcp.json` or VS Code/Cursor settings) to point at the proxy instead of the real servers. The proxy transparently forwards all calls.

### Event Stream

The proxy emits a structured event stream (WebSocket or SSE) for every tool lifecycle event: `tool_call_started`, `tool_call_completed`, `tool_call_failed`. The extension subscribes to this stream and updates the UI in real time.

### WebView Panel

A VS Code WebView panel renders the live activity feed and historical session log. It shows:

- Which tool is currently executing (with a spinner)
- A timeline of all tool calls in the current session
- Expandable detail for each call: arguments, response, duration, status

## Compatibility

This extension uses only the standard VS Code extension API (`vscode.*`) and is intended to be fully compatible with all VSCodium-based editors without modification.

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

This repository ships OpenSpec workflow prompts and skills that work in both GitHub Copilot (`.github/`) and Cursor (`.cursor/`). The `.opsx/` directory is the single source of truth — the `.github/` and `.cursor/` directories are generated from it.

### Syncing after changes

After modifying any file under `.opsx/prompts/` or `.opsx/skills/`, run:

```sh
npm run opsx
```

This is both the init and update command. It overwrites `.cursor/commands/` and `.github/prompts/` and both `skills/` directories to match `.opsx/`. Run it whenever `.opsx/` changes.

### How it works

| Source | Cursor output | GitHub Copilot output |
|---|---|---|
| `.opsx/prompts/*.md` | `.cursor/commands/*.md` (verbatim) | `.github/prompts/*.prompt.md` (`name`/`id`/`category` frontmatter fields stripped) |
| `.opsx/skills/*/SKILL.md` | `.cursor/skills/*/SKILL.md` | `.github/skills/*/SKILL.md` |
