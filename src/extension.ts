import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { AgentPanel } from './panel/AgentPanel';
import { registerMonitoringCommands } from './monitoring-commands';
import { checkForStaleWrappers } from './stale-check';
import { detectIde, resolveUserMcpConfigPath } from './mcp-config';

/**
 * Well-known Unix domain socket path. The stdio wrapper connects here
 * and POSTs telemetry as HTTP to `/internal/telemetry`. The server
 * forwards each POST to the proxy's TCP HTTP server.
 */
export const IPC_SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\myai-extension'
    : path.join(os.tmpdir(), 'myai-extension.sock');

// ---------------------------------------------------------------------------
// IPC socket server
// ---------------------------------------------------------------------------

let ipcServer: http.Server | undefined;

function startIpcServer(): void {
  // Remove any stale socket from a previous session (e.g. crash)
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(IPC_SOCKET_PATH); } catch { /* not present */ }
  }

  ipcServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/internal/telemetry') {
      if (!proxyPort) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy not ready' }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const proxyReq = http.request(
          {
            hostname: '127.0.0.1',
            port: proxyPort,
            path: '/internal/telemetry',
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': body.length },
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 200, { 'content-type': 'application/json' });
            proxyRes.pipe(res);
          },
        );
        proxyReq.on('error', () => {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end('{}');
        });
        proxyReq.write(body);
        proxyReq.end();
      });
      return;
    }
    // Any other request: return the proxy port for diagnostic purposes
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ port: proxyPort ?? null }) + '\n');
  });

  ipcServer.listen(IPC_SOCKET_PATH);
}

function stopIpcServer(): void {
  ipcServer?.close();
  ipcServer = undefined;
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(IPC_SOCKET_PATH); } catch { /* already gone */ }
  }
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

  const ideConfig = detectIde();
  if (ideConfig.appName !== 'Visual Studio Code' && ideConfig.appName !== 'Cursor') {
    outputChannel.appendLine(
      `MyAI: unknown IDE appName "${ideConfig.appName}", defaulting to VS Code conventions.`,
    );
  }

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

  registerMonitoringCommands(context, {
    ipcSocketPath: IPC_SOCKET_PATH,
    proxyPortProvider: () => proxyPort,
  });
}

// ---------------------------------------------------------------------------
// Proxy lifecycle
// ---------------------------------------------------------------------------

function startProxy(
  context: vscode.ExtensionContext,
  proxyPath: string,
  isRestart: boolean,
): void {
  const mcpServers = readWorkspaceHttpServerMap();
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

          const ideConfig = detectIde();
          const configPath = resolveUserMcpConfigPath(ideConfig.ide);
          const staleWrappers = checkForStaleWrappers(configPath, ideConfig.rootKey);
          if (staleWrappers.length > 0) {
            void vscode.window.showWarningMessage(
              'MyAI monitoring needs to be re-enabled. Run "MyAI: Enable MCP Monitoring".',
            );
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
  command?: string;
  args?: string[];
}

interface McpJsonFile {
  servers?: Record<string, McpServerConfig>;
  mcpServers?: Record<string, McpServerConfig>;
}

function collectAllServers(mcpJson: McpJsonFile): Record<string, McpServerConfig> {
  const merged: Record<string, McpServerConfig> = {};
  if (mcpJson.servers) {
    Object.assign(merged, mcpJson.servers);
  }
  if (mcpJson.mcpServers) {
    Object.assign(merged, mcpJson.mcpServers);
  }
  return merged;
}

function collectHttpServerUrls(servers: Record<string, McpServerConfig>): Record<string, string> {
  const urls: Record<string, string> = {};

  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg.url) {
      continue;
    }

    if (cfg.type && cfg.type !== 'http') {
      continue;
    }

    urls[name] = cfg.url;
  }

  return urls;
}

function readWorkspaceHttpServerMap(): Record<string, string> {
  const fromWorkspace: Record<string, string> = {};
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const mcpPath = path.join(folder.uri.fsPath, '.vscode', 'mcp.json');
      try {
        const raw = fs.readFileSync(mcpPath, 'utf8');
        const mcpJson = JSON.parse(raw) as McpJsonFile;
        Object.assign(fromWorkspace, collectHttpServerUrls(collectAllServers(mcpJson)));
      } catch {
        // File not found or malformed — skip
      }
    }
  }

  return fromWorkspace;
}

function readMcpConfigForDisplay(): {
  servers: Record<string, McpServerConfig>;
  source: string;
} {
  const ide = detectIde();
  const userConfigPath = resolveUserMcpConfigPath(ide.ide);
  try {
    const raw = fs.readFileSync(userConfigPath, 'utf8');
    const mcpJson = JSON.parse(raw) as McpJsonFile;
    return { servers: collectAllServers(mcpJson), source: userConfigPath };
  } catch {
    // User config missing or malformed — fall through
  }

  return { servers: {}, source: 'none' };
}

function showProxyConfigSnippet(port: number, channel: vscode.OutputChannel): void {
  const { servers: allServers, source } = readMcpConfigForDisplay();

  if (Object.keys(allServers).length === 0) {
    vscode.window.showInformationMessage(
      'MyAI: No MCP servers found in IDE user mcp.json.',
    );
    return;
  }

  const mcpServers = collectHttpServerUrls(allServers);
  const stdioServers: Array<{ name: string; command: string; args: string[] }> = [];
  for (const [name, cfg] of Object.entries(allServers)) {
    const isHttp = Boolean(cfg.url && (!cfg.type || cfg.type === 'http'));
    if (isHttp) {
      continue;
    }
    if (cfg.type === 'stdio' || cfg.command) {
      stdioServers.push({
        name,
        command: cfg.command ?? '(unknown)',
        args: cfg.args ?? [],
      });
    }
  }

  const proxied: Record<string, { type: string; url: string }> = {};
  for (const name of Object.keys(mcpServers)) {
    proxied[name] = {
      type: 'http',
      url: `http://127.0.0.1:${port}/${name}`,
    };
  }

  channel.clear();
  channel.appendLine(`// Source: ${source}`);
  channel.appendLine(`// Found ${Object.keys(allServers).length} total server(s)`);
  channel.appendLine(`// HTTP URL server(s): ${Object.keys(mcpServers).length}`);
  channel.appendLine(`// Stdio server(s): ${stdioServers.length}`);
  channel.appendLine('');

  if (Object.keys(mcpServers).length > 0) {
    const snippet = JSON.stringify({ servers: proxied }, null, 2);
    channel.appendLine('// HTTP proxy snippet: replace your "servers" section with this if desired');
    channel.appendLine('// (Do NOT overwrite the file automatically — review and paste manually)');
    channel.appendLine('');
    channel.appendLine(snippet);
    channel.appendLine('');
  }

  if (stdioServers.length > 0) {
    channel.appendLine('// Stdio servers detected (not converted by this snippet):');
    for (const server of stdioServers) {
      const argv = [server.command, ...server.args].join(' ').trim();
      channel.appendLine(`// - ${server.name}: ${argv}`);
    }
    channel.appendLine('// To monitor stdio servers, run "MyAI: Enable MCP Monitoring".');
  }

  channel.show();
  void vscode.window.showInformationMessage(
    `MyAI: MCP config summary generated from ${source}. See Output -> MyAI.`,
  );
}
