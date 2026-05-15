## Context

The MyAI extension runs an MCP proxy HTTP server to intercept and monitor tool calls made by AI agents. The current implementation only supports HTTP/SSE MCP servers via URL redirection, ignoring the `stdio` transport used by the overwhelming majority of real-world MCP configurations. All servers in the user's actual `mcp.json` are stdio-based.

The extension also has no mechanism for managing MCP configuration files — it reads them but never writes them. To observe stdio traffic, the extension must modify the user's `mcp.json` to route servers through an interception layer. This introduces new responsibilities: configuration lifecycle management, cross-platform path resolution, IDE detection, and safe restoration on disable or uninstall.

## Goals / Non-Goals

**Goals:**
- Intercept stdio MCP server traffic transparently without breaking server functionality
- Provide stable wrapper path across extension version updates
- Correctly locate and rewrite `mcp.json` for both VS Code and Cursor, on macOS, Linux, and Windows
- Restore original config on explicit disable, extension uninstall, or wrapper self-heal
- Inform users clearly about the trust prompt they will see when enabling

**Non-Goals:**
- Workspace-level `mcp.json` support (user-level only for this change)
- Managing server entries (add/remove/edit), only wrapping existing ones
- Cross-IDE config sync
- Supporting Cursor's HTTP MCP transport differences (stdio only, same as VS Code)

## Decisions

### Decision 1: Stdio wrapper as a separate spawned process (not an in-process pipe)

The wrapper is a standalone Node.js script that the IDE spawns in place of the real MCP server. It relays all stdin/stdout bytes between the IDE and the real server, and taps the JSON-RPC stream on the side to POST telemetry to the proxy.

**Alternatives considered:**
- *Register via `vscode.lm.registerMcpServerDefinitionProvider`*: Does not expose traffic observation; only allows providing servers, not monitoring them. No equivalent in Cursor.
- *HTTP redirect for all servers*: Requires changing `type` from `stdio` to `http`, which Cursor does not fully support and loses stdio semantics.
- *In-process pipe via Node IPC*: Would require the extension host to manage the child process, coupling the wrapper lifecycle to the extension. The IDE-spawned pattern keeps the wrapper self-contained.

### Decision 2: Copy wrapper to `~/.myai/stdio-wrapper.js` (stable path)

The extension writes the compiled wrapper to `~/.myai/stdio-wrapper.js` once on first enable, and overwrites it only when the embedded wrapper version changes. The `mcp.json` entry points to this stable path, not the versioned extension directory.

**Alternatives considered:**
- *Point directly to extension `dist/` path*: Version upgrades break the path silently; all MCP servers stop working until re-enable.
- *Symlinks*: Not reliably available on Windows without Developer Mode or admin rights.
- *Named proxy script in `PATH`*: Requires modifying the system PATH; unacceptably invasive.

The wrapper embeds a version comment (`// MYAI_WRAPPER_VERSION=1`). On activate, the extension reads the deployed wrapper version and overwrites if stale.

### Decision 3: Original config embedded in env vars (self-describing entries)

Each wrapped `mcp.json` entry stores its original configuration inside `MYAI_REAL_SERVER` (JSON-serialized) and cleanup metadata in `MYAI_CONFIG_PATH`, `MYAI_SERVER_NAME`, `MYAI_EXT_DIR`, `MYAI_WRAPPER_VERSION`. Restoration reads these directly from the file — no separate backup store needed.

**Alternatives considered:**
- *Backup file (`mcp.json.myai-backup`)*: Can't be committed; secrets may leak; stale if user edits the file after wrapping.
- *`globalState` backup*: Lost on reinstall; stale if user edits config while wrapped.

Self-describing entries mean the wrapped file is the single source of truth, and restoration works even on a fresh machine with no extension state.

### Decision 4: IPC transport is platform-aware at the wrapper level

```
macOS / Linux:  Unix domain socket  → /tmp/myai-extension.sock
Windows:        Named pipe          → \\.\pipe\myai-extension
```

The `MYAI_IPC_SOCKET` env var holds the platform-appropriate address. Both the wrapper and the `vscode:uninstall` script detect `process.platform === 'win32'` at runtime.

### Decision 5: Three-layer uninstall protocol

1. **`vscode:uninstall` script** (`dist/lifecycle.js`): Runs as a plain Node.js process (no VS Code API) after extension removal. Scans all known config paths for all IDEs and platforms, restores wrapped entries, deletes `~/.myai/`.
2. **Self-healing wrapper** (defense in depth): On startup, the wrapper checks whether `MYAI_EXT_DIR` still exists on disk. If not, it restores its own `mcp.json` entry and `exec()`s the real server, replacing itself transparently.
3. **`myai.disableMonitoring` command** (user escape hatch): Available at any time for manual restore.

### Decision 6: Explicit enable/disable commands (no auto-activation)

The extension never modifies `mcp.json` automatically on activate. The user must run `myai.enableMonitoring` explicitly. A Quick Pick lets them choose user-level config, workspace config (future), or both.

**Rationale:** Auto-modifying config files on extension activate is too aggressive — especially given it triggers IDE trust dialogs for every server. The user should opt in deliberately.

### Decision 7: IDE and platform detection

```typescript
const isVSCode = vscode.env.appName === 'Visual Studio Code';
const isCursor = vscode.env.appName === 'Cursor';
```

Config paths are resolved at runtime using `os.homedir()` and `process.platform`, not hardcoded:

| IDE    | Platform | User config path |
|--------|----------|-----------------|
| VS Code | macOS   | `~/Library/Application Support/Code/User/mcp.json` |
| VS Code | Linux   | `~/.config/Code/User/mcp.json` |
| VS Code | Windows | `%APPDATA%\Code\User\mcp.json` |
| Cursor  | all     | `~/.cursor/mcp.json` |

Root key differs: VS Code uses `"servers"`, Cursor uses `"mcpServers"`. The rewrite logic handles both.

## Risks / Trade-offs

**Trust dialogs on enable** → Mitigated by an explicit warning message shown before the config is rewritten, explaining that one trust prompt per MCP server is expected and intentional.

**Stale wrapper after extension update** → Mitigated by version check on activate: if deployed wrapper version differs from bundled version, show notification prompting re-enable.

**User edits wrapped entry manually** → `MYAI_REAL_SERVER` becomes stale. Restoration produces the reconstructed original, not the user's modified version. Mitigation: document this clearly; the escape hatch is to disable monitoring before editing.

**`vscode:uninstall` not honored by Cursor** → Cursor is a VS Code fork and should honor the hook, but is untested. The self-healing wrapper (Layer 2) covers this case.

**Wrapper process overhead** → The wrapper is a pure byte-relay with async stream parsing. Measured overhead should be negligible (<5ms) for typical MCP payloads. The existing proxy already adds a similar hop for HTTP servers.

**`~/.myai/` directory creation** → On first enable, the extension creates this directory. It is removed by the uninstall script. On Windows, this is `%USERPROFILE%\.myai\`.

## Migration Plan

1. Extension activates → checks for existing wrapped entries (stale wrapper detection)
2. User runs `myai.enableMonitoring` → IDE/platform detected, config path shown, warning shown, config rewritten
3. IDE detects `mcp.json` change → trust prompts per server
4. On disable or uninstall → config fully restored, trust prompts re-shown for originals (likely skipped if command was previously trusted)

No data migration required — no persistent state beyond `mcp.json` and `~/.myai/stdio-wrapper.js`.

### Decision 8: `myai.showMcpConfig` reads IDE user-level `mcp.json` only (this phase)

The command reads all configured servers (HTTP and stdio) from the IDE user-level `mcp.json` exclusively. It surfaces both server types in a single output view, generating a proxy snippet for HTTP servers and a listing with Enable Monitoring guidance for stdio servers. Workspace-level `.vscode/mcp.json` is out of scope for this phase and will be integrated later.

**Alternatives considered:**
- *Separate commands for HTTP and stdio*: Adds surface area and requires the user to know which command applies before they've seen their config.
- *Show only HTTP servers and silently skip stdio*: Causes apparent "nothing happened" behavior for any user whose config is entirely stdio-based — which is the common real-world case. Confusing and unhelpful.
- *Workspace-first with IDE fallback*: Originally planned, but deferred — workspace config adds complexity around root-key detection and multi-root workspaces that is better tackled as a dedicated follow-on.

The output always annotates which file was read (`// Source: <path>`), and always closes with the appropriate next action for each server type found.

### Decision 9: Internal telemetry test must complete the event lifecycle

The smoke test (`scripts/test-proxy.mjs`) verifies `/internal/telemetry` broadcasting by posting a synthetic event pair — `tool_call_started` immediately followed by `tool_call_completed` with the same `id`. Posting only a started event left a permanent in-progress spinner in the AI Agent Monitor panel during test runs.

**Rationale:** Test harnesses that interact with the live UI must clean up any state they create. A started event without a terminal (completed/failed) event is valid in production but incorrect in a test that leaves the panel open for visual inspection.

## Open Questions

- Does Cursor's `vscode:uninstall` hook actually fire? Needs a test install/uninstall cycle in Cursor to verify Layer 1 works, or whether Layer 2 must be the primary safety net for Cursor users.
- Should the stale wrapper notification auto-trigger re-enable, or only show a message? Current decision: message only, user must run the command.
