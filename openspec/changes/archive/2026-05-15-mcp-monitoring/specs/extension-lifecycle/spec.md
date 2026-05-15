## ADDED Requirements

### Requirement: `myai.showMcpConfig` surfaces all configured MCP servers with type-appropriate guidance
The `myai.showMcpConfig` command SHALL display all configured MCP servers found in the active workspace `.vscode/mcp.json` or, if that yields no servers, the IDE's user-level `mcp.json`. Output SHALL cover both HTTP URL and stdio server types, with actionable guidance for each.

#### Scenario: Workspace HTTP servers found
- **WHEN** the active workspace `.vscode/mcp.json` contains one or more HTTP URL server entries
- **THEN** the command SHALL open the MyAI output channel and show a proxy snippet re-pointing each HTTP server to `http://127.0.0.1:<proxy-port>/<name>`
- **THEN** the command SHALL show a success notification directing the user to Output → MyAI

#### Scenario: Workspace config has stdio servers only
- **WHEN** the active workspace `.vscode/mcp.json` contains only stdio entries (no HTTP URL servers)
- **THEN** the command SHALL open the MyAI output channel and list the stdio servers with their command and args
- **THEN** the output SHALL include a note directing the user to run "MyAI: Enable MCP Monitoring" for stdio servers

#### Scenario: No workspace servers; IDE user config used as fallback
- **GIVEN** no workspace `.vscode/mcp.json` exists or it contains no configured servers
- **WHEN** the user runs `myai.showMcpConfig`
- **THEN** the command SHALL read from the IDE user-level `mcp.json` instead
- **THEN** the output SHALL annotate the source file path so the user knows which config was read

#### Scenario: Both `servers` and `mcpServers` roots are scanned
- **WHEN** a `mcp.json` file uses either `"servers"` or `"mcpServers"` as the root key
- **THEN** the command SHALL enumerate entries from whichever root key is present, checking both

#### Scenario: Mixed HTTP and stdio servers in the same config
- **WHEN** a config file contains both HTTP URL entries and stdio entries
- **THEN** the output SHALL include the proxy snippet for HTTP entries AND the stdio listing for stdio entries in the same MyAI output channel view

#### Scenario: No servers found anywhere
- **WHEN** neither workspace nor user-level config contains any configured servers
- **THEN** the command SHALL show an information message: "No MCP servers found in workspace .vscode/mcp.json or IDE user mcp.json."

---

### Requirement: Extension registers myai.enableMonitoring and myai.disableMonitoring commands
The extension SHALL register `myai.enableMonitoring` and `myai.disableMonitoring` commands on activation, in addition to the existing `myai.openPanel` and `myai.clearSession` commands.

#### Scenario: Commands registered on activation
- **WHEN** the extension activates
- **THEN** `myai.enableMonitoring` and `myai.disableMonitoring` SHALL be available in the Command Palette

---

### Requirement: Extension checks for stale wrappers on every activation
On activation, the extension SHALL read the user-level `mcp.json` for the detected IDE and check whether any wrapped entries reference a wrapper path that no longer exists on disk.

#### Scenario: Stale wrapper path detected on activation
- **WHEN** a wrapped entry's `args[0]` path does not exist
- **THEN** the extension SHALL show a warning notification: "MyAI monitoring needs to be re-enabled. Run 'MyAI: Enable MCP Monitoring'."
- **THEN** the extension SHALL NOT attempt to auto-restore or auto-re-enable

#### Scenario: No stale wrappers on activation
- **WHEN** all wrapped entries have valid wrapper paths, or no entries are wrapped
- **THEN** the extension SHALL activate without any monitoring-related notification

---

## MODIFIED Requirements

### Requirement: `myai.showMcpConfig` surfaces all configured MCP servers with type-appropriate guidance
The `myai.showMcpConfig` command SHALL display all configured MCP servers found in the IDE's user-level `mcp.json` only. Output SHALL cover both HTTP URL and stdio server types, with actionable guidance for each. Workspace-level `mcp.json` is not supported in this phase.

#### Scenario: IDE user config has HTTP servers
- **WHEN** the IDE user-level `mcp.json` contains one or more HTTP URL server entries
- **THEN** the command SHALL open the MyAI output channel and show a proxy snippet re-pointing each HTTP server to `http://127.0.0.1:<proxy-port>/<name>`
- **THEN** the command SHALL show a success notification directing the user to Output → MyAI

#### Scenario: IDE user config has stdio servers only
- **WHEN** the IDE user-level `mcp.json` contains only stdio entries (no HTTP URL servers)
- **THEN** the command SHALL open the MyAI output channel and list the stdio servers with their command and args
- **THEN** the output SHALL include a note directing the user to run "MyAI: Enable MCP Monitoring" for stdio servers

#### Scenario: Mixed HTTP and stdio servers in the same config
- **WHEN** the IDE user-level `mcp.json` contains both HTTP URL entries and stdio entries
- **THEN** the output SHALL include the proxy snippet for HTTP entries AND the stdio listing for stdio entries in the same MyAI output channel view

#### Scenario: Both `servers` and `mcpServers` roots are scanned
- **WHEN** the IDE user-level `mcp.json` uses either `"servers"` or `"mcpServers"` as the root key
- **THEN** the command SHALL enumerate entries from whichever root key is present, checking both

#### Scenario: No servers found in IDE user config
- **WHEN** the IDE user-level `mcp.json` does not exist or contains no configured servers
- **THEN** the command SHALL show an information message: "No MCP servers found in IDE user mcp.json."
