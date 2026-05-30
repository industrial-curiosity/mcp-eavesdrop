# TODO

use https://agentskills.io/

## proxy whether extension active or not

right now the mcp servers configured for proxying are only proxied if the extension is active, but if the extension is inactive then calls to those servers will fail. the wrapper should activate the proxy regardless of extension state and the proxy should record the results regardless of extension state.

## Agent monitoring panel

It should always open empty, if the user wants to see historical events that should be available either on command or in a different window.

## test cursor meta fields for session id

## MCP configurations

it needs to be able to read the configured mcps in vscode or cursor format, rewrite them to point to the local proxy, and then the proxy needs to forward calls and emit events to the panel. the panel needs to display those events in a readable format.

current implementation (broken):

what is showMcpConfig supposed to do?

It reads the workspace's .vscode/mcp.json, and for each HTTP MCP server entry it generates a proxy-wrapped replacement URL pointing at the extension's proxy (http://127.0.0.1:<port>/<namespace>). It then prints the resulting snippet to the MyAI output channel for the user to review and paste manually — it never auto-writes the file.

Example: if your mcp.json has a server named context7 at https://mcp.context7.com, running myai.showMcpConfig would output:

You paste that into your mcp.json, and from then on VS Code routes context7 tool calls through the proxy, which intercepts them and shows them in the panel.

## MCP status

we need to be able to enable or disable mcps via the extension and see their status in the panel. we also need to show a status indicator for the proxy and provide enable/disable/restart controls.

instead of enable disable commands, show mcp list in the agent monitoring window

status of mcp server (monitoring enabled / disabled) and whether mcp is currently in use should be displayed with an indicator (red / grey / green)

poll whether the mcps are enabled or disabled every ten seconds

## Activated rules and skills
