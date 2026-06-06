### Requirement: Extension detects active IDE at runtime
The extension SHALL identify whether it is running inside VS Code or Cursor using `vscode.env.appName` and use this to resolve the correct MCP config paths and root key.

#### Scenario: Running in VS Code
- **WHEN** `vscode.env.appName` equals `"Visual Studio Code"`
- **THEN** the extension SHALL use `"servers"` as the root key when reading and writing `mcp.json`
- **THEN** the extension SHALL resolve user config paths under the VS Code application support directory

#### Scenario: Running in Cursor
- **WHEN** `vscode.env.appName` equals `"Cursor"`
- **THEN** the extension SHALL use `"mcpServers"` as the root key when reading and writing `mcp.json`
- **THEN** the extension SHALL resolve user config paths under `~/.cursor/`

#### Scenario: Unknown IDE
- **WHEN** `vscode.env.appName` does not match a known IDE
- **THEN** the extension SHALL default to VS Code path conventions and log a warning

---

### Requirement: Extension resolves user-level MCP config path cross-platform
The extension SHALL determine the absolute path to the user-level `mcp.json` for the active IDE on macOS, Linux, and Windows without hardcoding platform-specific paths.

#### Scenario: VS Code on macOS
- **WHEN** IDE is VS Code and `process.platform` is `"darwin"`
- **THEN** the resolved path SHALL be `~/Library/Application Support/Code/User/mcp.json`

#### Scenario: VS Code on Linux
- **WHEN** IDE is VS Code and `process.platform` is `"linux"`
- **THEN** the resolved path SHALL be `~/.config/Code/User/mcp.json`

#### Scenario: VS Code on Windows
- **WHEN** IDE is VS Code and `process.platform` is `"win32"`
- **THEN** the resolved path SHALL be `%APPDATA%\Code\User\mcp.json`

#### Scenario: Cursor on any platform
- **WHEN** IDE is Cursor
- **THEN** the resolved path SHALL be `~/.cursor/mcp.json` (Unix) or `%USERPROFILE%\.cursor\mcp.json` (Windows)

---

### Requirement: Extension deploys the stdio wrapper to a stable path
When monitoring is first enabled, the extension SHALL copy `dist/proxy/stdio-wrapper.js` to `~/.mcpEavesdrop/stdio-wrapper.js` (or `%USERPROFILE%\.mcpEavesdrop\stdio-wrapper.js` on Windows), creating the directory if it does not exist. The extension SHALL overwrite the deployed wrapper if the bundled version number differs.

#### Scenario: First-time deploy
- **WHEN** the user enables monitoring and `~/.mcpEavesdrop/stdio-wrapper.js` does not exist
- **THEN** the extension SHALL create `~/.mcpEavesdrop/` and copy the bundled wrapper into it

#### Scenario: Wrapper version mismatch
- **WHEN** `~/.mcpEavesdrop/stdio-wrapper.js` exists and its embedded `MCPEAVESDROP_WRAPPER_VERSION` comment differs from the bundled wrapper
- **THEN** the extension SHALL overwrite the deployed wrapper with the bundled version

#### Scenario: Wrapper up to date
- **WHEN** `~/.mcpEavesdrop/stdio-wrapper.js` exists and its version matches the bundled wrapper
- **THEN** the extension SHALL skip the copy

---

### Requirement: `mcpEavesdrop.enableMonitoring` command wraps all MCP servers
The extension SHALL register a `mcpEavesdrop.enableMonitoring` command that reads the user-level `mcp.json`, displays the file path and a trust-prompt warning to the user, and on confirmation rewrites each server entry to route through the stdio wrapper.

#### Scenario: Command invoked — user confirms
- **WHEN** the user runs `mcpEavesdrop.enableMonitoring`
- **THEN** the extension SHALL show an information message stating the config file path and that each MCP server will require a new trust confirmation
- **WHEN** the user selects "Enable"
- **THEN** the extension SHALL deploy the wrapper, rewrite all unwrapped server entries, and show a confirmation message

#### Scenario: Command invoked — user cancels
- **WHEN** the user selects "Cancel"
- **THEN** the extension SHALL make no changes to `mcp.json`

#### Scenario: Config file not found
- **WHEN** no `mcp.json` exists at the resolved path
- **THEN** the extension SHALL show an error message stating the expected path and that no configuration was found

#### Scenario: All servers already wrapped
- **WHEN** every entry in `mcp.json` already contains `MCPEAVESDROP_IPC_SOCKET` in its `env`
- **THEN** the extension SHALL inform the user that monitoring is already enabled and take no action

---

### Requirement: Wrapped stdio entries embed original config and metadata as env vars
Each wrapped stdio server entry in `mcp.json` SHALL contain the original server's `command`, `args`, and non-mcpEavesdrop `env` entries reconstructable from the `MCPEAVESDROP_REAL_SERVER` env var, plus monitoring metadata sufficient for restore and self-healing.

#### Scenario: Wrapped entry structure
- **WHEN** a stdio entry is wrapped
- **THEN** `command` SHALL be `"node"`
- **THEN** `args` SHALL be `["<absolute-path-to-~/.mcpEavesdrop/stdio-wrapper.js>", "<server-name>"]`
- **THEN** `env` SHALL contain all original env vars plus: `MCPEAVESDROP_IPC_SOCKET`, `MCPEAVESDROP_REAL_SERVER` (JSON-serialized original command/args), `MCPEAVESDROP_SERVER_NAME`, `MCPEAVESDROP_CONFIG_PATH`, `MCPEAVESDROP_EXT_DIR`, `MCPEAVESDROP_WRAPPER_VERSION`

#### Scenario: Wrapped HTTP entry structure
- **WHEN** an HTTP/SSE server entry is wrapped
- **THEN** `url` SHALL be rewritten to `http://127.0.0.1:<proxy-port>/<server-name>`
- **THEN** `env` SHALL contain `MCPEAVESDROP_REAL_URL` (original URL), `MCPEAVESDROP_SERVER_NAME`, `MCPEAVESDROP_CONFIG_PATH`, `MCPEAVESDROP_WRAPPER_VERSION`

---

### Requirement: `mcpEavesdrop.disableMonitoring` command restores all MCP servers
The extension SHALL register a `mcpEavesdrop.disableMonitoring` command that reads `mcp.json`, detects all wrapped entries, reconstructs the originals from their embedded metadata, and writes the restored config.

#### Scenario: Disable with wrapped entries present
- **WHEN** the user runs `mcpEavesdrop.disableMonitoring`
- **THEN** the extension SHALL restore every entry that contains `MCPEAVESDROP_IPC_SOCKET` in its `env` to its original `command`, `args`, and `env` (stripping all `MCPEAVESDROP_*` keys)
- **THEN** the extension SHALL show a confirmation message

#### Scenario: No wrapped entries found
- **WHEN** no entries contain `MCPEAVESDROP_IPC_SOCKET`
- **THEN** the extension SHALL inform the user that monitoring is not currently enabled

---

### Requirement: Extension detects stale wrapper on activate and notifies user
On every activation, the extension SHALL check whether any wrapped entries in the user-level `mcp.json` point to a wrapper path that no longer exists on disk, and if so show a notification prompting re-enable.

#### Scenario: Stale wrapper detected
- **WHEN** a wrapped entry's `args[0]` path does not exist on disk
- **THEN** the extension SHALL show a warning: "MCP Eavesdrop monitoring needs to be re-enabled. Run 'MCP Eavesdrop: Enable MCP Monitoring' to restore it."

#### Scenario: No stale wrappers
- **WHEN** all wrapped entries point to existing wrapper paths (or no entries are wrapped)
- **THEN** the extension SHALL activate silently with no notification
