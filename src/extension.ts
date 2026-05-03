import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { AgentPanel } from './panel/AgentPanel';

/**
 * Well-known Unix domain socket path. External tools connect, receive
 * {"port": N} as a single newline-terminated JSON line, then the server
 * closes the connection. No files are left on disk between sessions.
 */
export const IPC_SOCKET_PATH = path.join(os.tmpdir(), 'myai-extension.sock');

// ---------------------------------------------------------------------------
// IPC socket server
// ---------------------------------------------------------------------------

let ipcServer: net.Server | undefined;

function startIpcServer(): void {
  // Remove any stale socket from a previous session (e.g. crash)
  try { fs.unlinkSync(IPC_SOCKET_PATH); } catch { /* not present */ }

  ipcServer = net.createServer((socket) => {
    const response = JSON.stringify({ port: proxyPort ?? null }) + '\n';
    socket.end(response);
  });

  ipcServer.listen(IPC_SOCKET_PATH);
}

function stopIpcServer(): void {
  ipcServer?.close();
  ipcServer = undefined;
  try { fs.unlinkSync(IPC_SOCKET_PATH); } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel;
let proxyProcess: cp.ChildProcess | undefined;
let proxyPort: number | undefined;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('MyAI');
  context.subscriptions.push(outputChannel);

  startIpcServer();
  outputChannel.appendLine(`MyAI: IPC socket at ${IPC_SOCKET_PATH}`);

  const proxyPath = context.asAbsolutePath(path.join('dist', 'proxy', 'server.js'));
  startProxy(context, proxyPath, false);

  // Command: open the monitor panel
  const openPanelCmd = vscode.commands.registerCommand('myai.openPanel', () => {
    if (proxyPort === undefined) {
      vscode.window.showErrorMessage('MyAI: Proxy is not running. Try reloading the window.');
      return;
    }
    context.globalState.update('panelWasOpen', true);
    AgentPanel.createOrShow(context.extensionUri, proxyPort);
  });

  AgentPanel.onDidDispose = () => context.globalState.update('panelWasOpen', false);

  // Command: clear the current session log
  const clearSessionCmd = vscode.commands.registerCommand('myai.clearSession', async () => {
    if (proxyPort === undefined) return;
    try {
      await fetch(`http://127.0.0.1:${proxyPort}/internal/clear`, { method: 'POST' });
    } catch (err) {
      outputChannel.appendLine(`clearSession failed: ${err}`);
    }
  });

  // Command: show the proxy-wrapped MCP config snippet
  const showConfigCmd = vscode.commands.registerCommand('myai.showMcpConfig', () => {
    if (proxyPort === undefined) {
      vscode.window.showErrorMessage('MyAI: Proxy is not running yet. Please wait a moment and try again.');
      return;
    }
    showProxyConfigSnippet(proxyPort, outputChannel);
  });

  context.subscriptions.push(openPanelCmd, clearSessionCmd, showConfigCmd);
}

// ---------------------------------------------------------------------------
// Proxy lifecycle
// ---------------------------------------------------------------------------

function startProxy(
  context: vscode.ExtensionContext,
  proxyPath: string,
  isRestart: boolean,
): void {
  const mcpServers = readMcpConfig();
  const configArg = JSON.stringify({ servers: mcpServers });

  const child = cp.spawn('node', [proxyPath, configArg], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proxyProcess = child;
  proxyPort = undefined;
  let portReceived = false;
  let stdoutBuffer = '';

  // Parse port from stdout (line-buffered JSON)
  const portTimeout = setTimeout(() => {
    if (!portReceived) {
      outputChannel.appendLine('MyAI: Proxy did not report a port within 5 seconds.');
      vscode.window.showErrorMessage(
        'MyAI: Proxy failed to start. Run "MyAI: Open Agent Monitor Panel" again after reloading.',
      );
    }
  }, 5000);

  child.stdout?.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { port?: number };
        if (typeof parsed.port === 'number') {
          portReceived = true;
          proxyPort = parsed.port;
          clearTimeout(portTimeout);
          outputChannel.appendLine(`MyAI: Proxy listening on port ${proxyPort}`);
          // Re-open or update the panel if it was open before this (re)start.
          if (context.globalState.get('panelWasOpen')) {
            AgentPanel.createOrShow(context.extensionUri, proxyPort);
          } else {
            AgentPanel.notifyProxyPort(proxyPort);
          }
        }
      } catch {
        // Non-JSON stdout — ignore
      }
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    outputChannel.appendLine(`MyAI: ${data.toString().trimEnd()}`);
  });

  child.on('exit', (code) => {
    clearTimeout(portTimeout);
    proxyPort = undefined;
    outputChannel.appendLine(`MyAI: Proxy exited (code ${code}).`);

    if (!isRestart && context.extension.isActive) {
      outputChannel.appendLine('MyAI: Attempting one proxy restart…');
      startProxy(context, proxyPath, true);
    }
  });

  context.subscriptions.push({
    dispose() {
      terminateProxy();
    },
  });
}

function terminateProxy(): void {
  if (!proxyProcess) return;
  const child = proxyProcess;
  proxyProcess = undefined;

  child.kill('SIGTERM');
  const killTimer = setTimeout(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, 2000);
  // Don't keep the process alive just for the timer
  killTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export function deactivate(): void {
  terminateProxy();
  stopIpcServer();
}

// ---------------------------------------------------------------------------
// MCP config helpers
// ---------------------------------------------------------------------------

interface McpServerConfig {
  type?: string;
  url?: string;
}

interface McpJsonFile {
  servers?: Record<string, McpServerConfig>;
}

function readMcpConfig(): Record<string, string> {
  const servers: Record<string, string> = {};
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return servers;

  for (const folder of workspaceFolders) {
    const mcpPath = path.join(folder.uri.fsPath, '.vscode', 'mcp.json');
    try {
      const raw = fs.readFileSync(mcpPath, 'utf8');
      const mcpJson = JSON.parse(raw) as McpJsonFile;
      for (const [name, cfg] of Object.entries(mcpJson.servers ?? {})) {
        if (cfg.url) {
          servers[name] = cfg.url;
        }
      }
    } catch {
      // File not found or malformed — skip
    }
  }
  return servers;
}

function showProxyConfigSnippet(port: number, channel: vscode.OutputChannel): void {
  const mcpServers = readMcpConfig();

  if (Object.keys(mcpServers).length === 0) {
    vscode.window.showInformationMessage(
      'MyAI: No HTTP MCP servers found in workspace .vscode/mcp.json.',
    );
    return;
  }

  const proxied: Record<string, { type: string; url: string }> = {};
  for (const name of Object.keys(mcpServers)) {
    proxied[name] = {
      type: 'http',
      url: `http://127.0.0.1:${port}/${name}`,
    };
  }

  const snippet = JSON.stringify({ servers: proxied }, null, 2);
  channel.clear();
  channel.appendLine('// Replace the "servers" section in your .vscode/mcp.json with this proxy-wrapped version:');
  channel.appendLine('// (Do NOT overwrite the file automatically — review and paste manually)');
  channel.appendLine('');
  channel.appendLine(snippet);
  channel.show();
}
