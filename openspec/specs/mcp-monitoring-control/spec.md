## MODIFIED Requirements

### Requirement: Wrapped stdio entries embed original config and metadata as env vars
Each wrapped stdio server entry in `mcp.json` SHALL contain the original server's `command`, `args`, and non-mcpEavesdrop `env` entries reconstructable from the `MCPEAVESDROP_REAL_SERVER` env var, plus monitoring metadata sufficient for restore and self-healing. Workspace identity SHALL NOT be stored in wrapper env metadata.

#### Scenario: Wrapped entry structure
- **WHEN** a stdio entry is wrapped
- **THEN** `command` SHALL be `"node"`
- **THEN** `args` SHALL be `["<absolute-path-to-~/.mcpEavesdrop/stdio-wrapper.js>"]`
- **THEN** `env` SHALL contain all original env vars plus: `MCPEAVESDROP_REAL_SERVER` (JSON-serialized original command/args), `MCPEAVESDROP_SERVER_NAME`, `MCPEAVESDROP_CONFIG_PATH`, `MCPEAVESDROP_EXT_DIR`, `MCPEAVESDROP_WRAPPER_VERSION`, and `MCPEAVESDROP_IDE`
- **THEN** `env` SHALL NOT contain `MCPEAVESDROP_WORKSPACE_SLUG`

#### Scenario: Wrapped HTTP entry structure
- **WHEN** an HTTP/SSE server entry is wrapped
- **THEN** `command` SHALL be `"node"`
- **THEN** `args` SHALL be `["<absolute-path-to-~/.mcpEavesdrop/stdio-wrapper.js>"]`
- **THEN** `env` SHALL contain `MCPEAVESDROP_REAL_URL` (original URL), `MCPEAVESDROP_SERVER_NAME`, `MCPEAVESDROP_CONFIG_PATH`, `MCPEAVESDROP_EXT_DIR`, `MCPEAVESDROP_WRAPPER_VERSION`, and `MCPEAVESDROP_IDE`
- **THEN** `env` SHALL NOT contain `MCPEAVESDROP_WORKSPACE_SLUG`

#### Scenario: Legacy workspace metadata cleanup
- **WHEN** enable monitoring wraps an entry
- **THEN** `MCPEAVESDROP_WORKSPACE_SLUG` SHALL NOT be added to wrapper env metadata

#### Scenario: Disable removes legacy workspace metadata when present
- **WHEN** disable monitoring restores a wrapped entry and `MCPEAVESDROP_WORKSPACE_SLUG` exists in env metadata
- **THEN** the restored entry env SHALL NOT contain `MCPEAVESDROP_WORKSPACE_SLUG`
