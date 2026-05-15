## ADDED Requirements

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
