### Requirement: `vscode:uninstall` script restores all wrapped MCP entries
The extension SHALL register a `vscode:uninstall` script at `dist/lifecycle.js` in `package.json` that, when executed after extension removal, scans all known user-level `mcp.json` locations for both VS Code and Cursor on the current platform, restores any wrapped entries, and removes `~/.mcpEavesdrop/`.

#### Scenario: Wrapped entries found during uninstall
- **WHEN** the uninstall script runs and finds entries containing `MCPEAVESDROP_IPC_SOCKET` in any known `mcp.json`
- **THEN** the script SHALL restore each such entry to its original `command`, `args`, and `env` by reading `MCPEAVESDROP_REAL_SERVER` (stripping all `MCPEAVESDROP_*` keys)
- **THEN** the script SHALL write the restored `mcp.json` back to disk

#### Scenario: No wrapped entries found during uninstall
- **WHEN** the uninstall script runs and finds no `MCPEAVESDROP_*` env vars in any `mcp.json`
- **THEN** the script SHALL make no changes to any config file

#### Scenario: `mcp.json` is missing or unreadable
- **WHEN** a config file does not exist or cannot be parsed
- **THEN** the script SHALL skip that file and continue processing others without error

---

### Requirement: `vscode:uninstall` script removes the `~/.mcpEavesdrop/` directory
After processing all config files, the uninstall script SHALL delete the `~/.mcpEavesdrop/` directory and all its contents.

#### Scenario: Directory exists
- **WHEN** `~/.mcpEavesdrop/` exists on disk
- **THEN** the script SHALL remove it recursively

#### Scenario: Directory does not exist
- **WHEN** `~/.mcpEavesdrop/` does not exist
- **THEN** the script SHALL skip deletion without error

---

### Requirement: Uninstall script operates without VS Code API
The `vscode:uninstall` script SHALL use only Node.js built-in modules (`fs`, `os`, `path`) and SHALL NOT import the `vscode` module or any runtime that requires the extension host.

#### Scenario: Script runs as plain Node.js
- **WHEN** VS Code executes `node ./dist/lifecycle.js` after uninstall
- **THEN** the script SHALL complete successfully in a plain Node.js process with no VS Code API available

---

### Requirement: Uninstall script scans all known config paths for all supported IDEs and platforms
The script SHALL check all paths where `mcp.json` may exist for VS Code and Cursor on the current OS, without requiring any stored state about which IDE the user was running.

#### Scenario: Multiple config files present
- **WHEN** both `~/Library/Application Support/Code/User/mcp.json` and `~/.cursor/mcp.json` exist and contain wrapped entries
- **THEN** the script SHALL restore both files
