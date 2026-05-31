import * as vscode from 'vscode';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as cp from 'node:child_process';
import { AgentPanel } from './panel/AgentPanel';
import { logMcpConfigDiagnostics, registerMonitoringCommands } from './monitoring-commands';
import { checkForStaleWrappers } from './stale-check';
import { detectIde, resolveUserMcpConfigPath } from './mcp-config';
import { DAEMON_SOCKET_PATH } from './daemon/constants';
import { deployWrapper } from './wrapper-deploy';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MYAI_DIR = path.join(os.homedir(), '.myai');
const DAEMON_JSON_PATH = path.join(MYAI_DIR, 'daemon.json');
const LOCK_PATH = path.join(MYAI_DIR, 'ipc.lock');
const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_INTERVAL_MS = 5_000;
const SOCKET_POLL_TIMEOUT_MS = 5_000;
const SOCKET_POLL_INTERVAL_MS = 200;
const LOCK_STALE_AGE_MS = 10_000;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel | undefined;

/** Avoid "Channel has been closed" races when the debug session ends mid-activate (common in Cursor). */
function myaiLog(message: string): void {
  const channel = outputChannel;
  if (!channel) return;
  try {
    channel.appendLine(message);
  } catch {
    // Output channel disposed during extension host reload.
  }
}
let instanceId: string;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectFailureCount = 0;
let daemonConnected = false;
let ideConfig: ReturnType<typeof detectIde>;
let extensionContext: vscode.ExtensionContext | undefined;
let registeredWorkspaceName = 'default';
let registeredWorkspaceSlug = 'default';

interface DaemonJson {
  pid: number;
  socketPath: string;
  startedAt: number;
}

function isDaemonProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readDaemonJson(): DaemonJson | undefined {
  try {
    return JSON.parse(fs.readFileSync(DAEMON_JSON_PATH, 'utf8')) as DaemonJson;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Daemon connection helpers
// ---------------------------------------------------------------------------

function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath);
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.setTimeout(400);
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
    sock.on('timeout', () => done(false));
  });
}

function postDaemon(socketPath: string, urlPath: string, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { socketPath, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 200, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getDaemon(socketPath: string, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: urlPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 200, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function pollSocketReady(socketPath: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeSocket(socketPath)) return true;
    await new Promise(r => setTimeout(r, SOCKET_POLL_INTERVAL_MS));
  }
  return false;
}

async function acquireLock(): Promise<boolean> {
  try {
    fs.mkdirSync(MYAI_DIR, { recursive: true });
    const fd = fs.openSync(LOCK_PATH, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function checkLockStale(): boolean {
  try {
    const stat = fs.statSync(LOCK_PATH);
    return (Date.now() - stat.mtimeMs) > LOCK_STALE_AGE_MS;
  } catch {
    return false;
  }
}

async function spawnDaemon(context: vscode.ExtensionContext): Promise<void> {
  const daemonPath = context.asAbsolutePath(path.join('dist', 'daemon', 'index.js'));
  const child = cp.spawn('node', [daemonPath], { detached: true, stdio: 'ignore' });
  child.unref();
  myaiLog(`MyAI: spawned daemon (pid ${child.pid})`);
}

async function connectToDaemon(context: vscode.ExtensionContext): Promise<boolean> {
  const reachable = await probeSocket(DAEMON_SOCKET_PATH);
  if (reachable) {
    myaiLog('MyAI: daemon already running');
    return true;
  }

  const locked = await acquireLock();
  if (!locked) {
    if (checkLockStale()) {
      myaiLog('MyAI: stale lock detected, removing and retrying');
      try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
      return connectToDaemon(context);
    }
    myaiLog('MyAI: waiting for another instance to start daemon');
    return pollSocketReady(DAEMON_SOCKET_PATH, SOCKET_POLL_TIMEOUT_MS);
  }

  try {
    await spawnDaemon(context);
    const ready = await pollSocketReady(DAEMON_SOCKET_PATH, SOCKET_POLL_TIMEOUT_MS);
    if (!ready) myaiLog('MyAI: daemon failed to start within timeout');
    return ready;
  } finally {
    try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

async function fetchAndSendConnections(): Promise<void> {
  try {
    const res = await getDaemon(DAEMON_SOCKET_PATH, '/connections');
    const data = JSON.parse(res.body) as { connections: unknown[] };
    AgentPanel.postMessage({ type: 'connections', connections: data.connections });
  } catch { /* daemon not reachable */ }
}

// ---------------------------------------------------------------------------
// Daemon connection monitor (reconnects on drop, respawns daemon if dead)
// ---------------------------------------------------------------------------

function startDaemonMonitor(): void {
    function subscribeToDaemon(): void {
      const daemonReq = http.request(
        { socketPath: DAEMON_SOCKET_PATH, path: `/events?instanceId=${encodeURIComponent(instanceId)}`, method: 'GET' },
        (daemonRes) => {
          const status = daemonRes.statusCode ?? 0;
          if (status !== 200) {
            const chunks: Buffer[] = [];
            daemonRes.on('data', (c: Buffer) => chunks.push(c));
            daemonRes.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              const details = body ? `: ${body}` : '';
              myaiLog(`MyAI: daemon SSE subscribe rejected (${status})${details}`);
              daemonConnected = false;
              AgentPanel.postMessage({ type: 'status', connected: false });
              scheduleReconnect();
            });
            daemonRes.on('error', () => {
              daemonConnected = false;
              AgentPanel.postMessage({ type: 'status', connected: false });
              scheduleReconnect();
            });
            return;
          }

          reconnectFailureCount = 0;
          daemonConnected = true;
          AgentPanel.postMessage({ type: 'status', connected: true });
          let buf = '';
          daemonRes.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            const parts = buf.split('\n\n');
            buf = parts.pop() ?? '';
            for (const part of parts) {
              if (!part.trim() || part.startsWith(':')) continue;
              const dataLine = part.split('\n').find((l: string) => l.startsWith('data: '));
              if (!dataLine) continue;
              const payload = dataLine.slice(6);
              try {
                const evt = JSON.parse(payload) as Record<string, unknown>;
                AgentPanel.postMessage({ type: 'event', event: evt });
                if (evt['type'] === 'connections_changed') {
                  void fetchAndSendConnections();
                }
              } catch { /* ignore malformed */ }
            }
          });
          daemonRes.on('end', () => {
            myaiLog('MyAI: daemon SSE stream ended, scheduling reconnect');
            daemonConnected = false;
            AgentPanel.postMessage({ type: 'status', connected: false });
            scheduleReconnect();
          });
          daemonRes.on('error', () => {
            daemonConnected = false;
            AgentPanel.postMessage({ type: 'status', connected: false });
            scheduleReconnect();
          });
        },
      );
      daemonReq.on('error', () => {
        daemonConnected = false;
        AgentPanel.postMessage({ type: 'status', connected: false });
        scheduleReconnect();
      });
      daemonReq.end();
    }

    function scheduleReconnect(): void {
      reconnectFailureCount++;
      if (reconnectFailureCount % 3 === 0) {
        void vscode.window.showWarningMessage(`MyAI: Lost connection to daemon (${reconnectFailureCount} failures). Reconnecting...`);
      }
      reconnectTimer = setTimeout(async () => {
        const socketOk = await probeSocket(DAEMON_SOCKET_PATH).catch(() => false);
        if (socketOk) {
          // Socket may be up after daemon restart while this instance is no longer registered.
          await registerInstanceWithDaemon();
          subscribeToDaemon();
          return;
        }

        // Probe daemon liveness via daemon.json PID
        const daemonInfo = readDaemonJson();
        const daemonDead = !daemonInfo || !isDaemonProcessAlive(daemonInfo.pid);

        if (daemonDead && extensionContext) {
          myaiLog('MyAI: daemon appears dead, replaying full startup sequence...');
          const reconnected = await connectToDaemon(extensionContext);
          if (reconnected) {
            reconnectFailureCount = 0;
            const newInfo = readDaemonJson();
            if (newInfo) {
              myaiLog(`MyAI: daemon restarted (pid=${newInfo.pid})`);
            }
            // Re-register with the fresh daemon
            await postDaemon(DAEMON_SOCKET_PATH, '/register', {
              instanceId,
              ide: ideConfig.ide,
              workspace: registeredWorkspaceName,
              workspaceSlug: registeredWorkspaceSlug,
            }).catch(() => { /* best-effort */ });
            subscribeToDaemon();
          } else {
            scheduleReconnect();
          }
        } else {
          scheduleReconnect();
        }
      }, RECONNECT_INTERVAL_MS);
    }

  subscribeToDaemon();
}

function stopDaemonMonitor(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = undefined; }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  heartbeatTimer = setInterval(async () => {
    try {
      await postDaemon(DAEMON_SOCKET_PATH, '/heartbeat', { instanceId });
    } catch { /* daemon not reachable; reconnect loop handles it */ }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = undefined; }
}

// ---------------------------------------------------------------------------
// Workspace identity (Extension Development Host may start with no folder)
// ---------------------------------------------------------------------------

function normalizeWorkspaceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function resolveWorkspaceIdentity(context: vscode.ExtensionContext): { name: string; slug: string } {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    return {
      name: folder.name,
      slug: normalizeWorkspaceSlug(path.basename(folder.uri.fsPath)),
    };
  }

  const devRoot = context.extensionUri.fsPath;
  const name = path.basename(devRoot);
  return { name, slug: normalizeWorkspaceSlug(name) };
}

async function registerInstanceWithDaemon(): Promise<void> {
  try {
    await postDaemon(DAEMON_SOCKET_PATH, '/register', {
      instanceId,
      ide: ideConfig.ide,
      workspace: registeredWorkspaceName,
      workspaceSlug: registeredWorkspaceSlug,
    });
  } catch (err) {
    myaiLog(`MyAI: failed to register with daemon: ${err}`);
  }
}

function applyWorkspaceIdentity(context: vscode.ExtensionContext): void {
  const { name, slug } = resolveWorkspaceIdentity(context);
  registeredWorkspaceName = name;
  registeredWorkspaceSlug = slug;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('MyAI');
  context.subscriptions.push(outputChannel);

  instanceId = crypto.randomUUID();
  ideConfig = detectIde();

  if (ideConfig.appName !== 'Visual Studio Code' && ideConfig.appName !== 'Cursor') {
    myaiLog(`MyAI: unknown IDE appName "${ideConfig.appName}", defaulting to VS Code conventions.`);
  }

  extensionContext = context;

  const connected = await connectToDaemon(context);
  if (!connected) {
    vscode.window.showErrorMessage('MyAI: Failed to start monitoring daemon. Try reloading the window.');
    return;
  }

  const daemonInfo = readDaemonJson();
  if (daemonInfo) {
    myaiLog(`MyAI: daemon running (pid=${daemonInfo.pid})`);
  }

  applyWorkspaceIdentity(context);
  const folder = vscode.workspace.workspaceFolders?.[0];
  myaiLog(
    `MyAI: activated in ${ideConfig.appName} (ide=${ideConfig.ide}, workspaceFolders=${vscode.workspace.workspaceFolders?.length ?? 0}${folder ? `, path=${folder.uri.fsPath}` : ''})`,
  );
  if (!folder) {
    myaiLog(
      `MyAI: no workspace folder open; using "${registeredWorkspaceName}" for workspace identity — open this repo in the Extension Development Host if Cursor shows NoWorkspaceUriError`,
    );
  }

  await registerInstanceWithDaemon();

  logMcpConfigDiagnostics(
    ideConfig.ide,
    myaiLog,
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const prevSlug = registeredWorkspaceSlug;
      applyWorkspaceIdentity(context);
      if (registeredWorkspaceSlug === prevSlug) return;
      myaiLog(`MyAI: workspace changed → ${registeredWorkspaceName} (${registeredWorkspaceSlug})`);
      void registerInstanceWithDaemon();
    }),
  );

  startDaemonMonitor();
  myaiLog('MyAI: daemon monitor started');

  AgentPanel.onPanelReady = () => {
    AgentPanel.postMessage({ type: 'status', connected: daemonConnected });
    void fetchAndSendConnections();
  };

  startHeartbeat();

  const configPath = resolveUserMcpConfigPath(ideConfig.ide);

  // Always re-deploy wrapper on activation in case the bundled version changed.
  deployWrapper(context);

  const staleWrappers = checkForStaleWrappers(configPath, ideConfig.rootKey);
  if (staleWrappers.length > 0) {
    void vscode.window.showWarningMessage('MyAI monitoring needs to be re-enabled. Run "MyAI: Enable MCP Monitoring".');
  }

  const openPanelCmd = vscode.commands.registerCommand('myai.openPanel', () => {
    context.globalState.update('panelWasOpen', true);
    AgentPanel.createOrShow(context.extensionUri);
  });

  AgentPanel.onDidDispose = () => { void context.globalState.update('panelWasOpen', false); };

  // ---------------------------------------------------------------------------
  // Fetch connections and push to panel
  // ---------------------------------------------------------------------------

  const clearSessionCmd = vscode.commands.registerCommand('myai.clearSession', async () => {
    try {
      await postDaemon(DAEMON_SOCKET_PATH, '/internal/clear', {});
    } catch (err) {
      myaiLog(`clearSession failed: ${err}`);
    }
  });

  const showConfigCmd = vscode.commands.registerCommand('myai.showMcpConfig', () => {
    if (outputChannel) showProxyConfigSnippet(outputChannel);
  });

  context.subscriptions.push(openPanelCmd, clearSessionCmd, showConfigCmd);

  registerMonitoringCommands(context, {
    ide: ideConfig.ide,
    workspaceSlugProvider: () => registeredWorkspaceSlug,
  });

  if (context.globalState.get('panelWasOpen')) {
    AgentPanel.createOrShow(context.extensionUri);
  }
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

export async function deactivate(): Promise<void> {
  stopHeartbeat();
  try {
    await postDaemon(DAEMON_SOCKET_PATH, '/deregister', { instanceId });
    const connsRes = await getDaemon(DAEMON_SOCKET_PATH, '/connections');
    const conns = JSON.parse(connsRes.body) as { total: number };
    if (conns.total <= 1) {
      await postDaemon(DAEMON_SOCKET_PATH, '/shutdown', {});
    }
  } catch { /* daemon may already be gone */ }
  stopDaemonMonitor();
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
  if (mcpJson.servers) Object.assign(merged, mcpJson.servers);
  if (mcpJson.mcpServers) Object.assign(merged, mcpJson.mcpServers);
  return merged;
}

function collectHttpServerUrls(servers: Record<string, McpServerConfig>): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg.url) continue;
    if (cfg.type && cfg.type !== 'http') continue;
    urls[name] = cfg.url;
  }
  return urls;
}

function readMcpConfigForDisplay(): { servers: Record<string, McpServerConfig>; source: string; } {
  const ide = detectIde();
  const userConfigPath = resolveUserMcpConfigPath(ide.ide);
  try {
    const raw = fs.readFileSync(userConfigPath, 'utf8');
    const mcpJson = JSON.parse(raw) as McpJsonFile;
    return { servers: collectAllServers(mcpJson), source: userConfigPath };
  } catch {
    return { servers: {}, source: 'none' };
  }
}

function showProxyConfigSnippet(channel: vscode.OutputChannel): void {
  const { servers: allServers, source } = readMcpConfigForDisplay();
  if (Object.keys(allServers).length === 0) {
    vscode.window.showInformationMessage('MyAI: No MCP servers found in IDE user mcp.json.');
    return;
  }

  const mcpServers = collectHttpServerUrls(allServers);
  const stdioServers: Array<{ name: string; command: string; args: string[] }> = [];
  for (const [name, cfg] of Object.entries(allServers)) {
    if (cfg.url && (!cfg.type || cfg.type === 'http')) continue;
    if (cfg.type === 'stdio' || cfg.command) {
      stdioServers.push({ name, command: cfg.command ?? '(unknown)', args: cfg.args ?? [] });
    }
  }

  channel.clear();
  channel.appendLine(`// Source: ${source}`);
  channel.appendLine(`// Found ${Object.keys(allServers).length} total server(s)`);
  channel.appendLine(`// HTTP URL server(s): ${Object.keys(mcpServers).length}`);
  channel.appendLine(`// Stdio server(s): ${stdioServers.length}`);
  channel.appendLine('');
  if (Object.keys(mcpServers).length > 0) {
    channel.appendLine('// HTTP servers (monitored via direct forwarding):');
    for (const [name, url] of Object.entries(mcpServers)) {
      channel.appendLine(`// - ${name}: ${url}`);
    }
    channel.appendLine('');
  }
  if (stdioServers.length > 0) {
    channel.appendLine('// Stdio servers detected (not converted by this snippet):');
    for (const server of stdioServers) {
      channel.appendLine(`// - ${server.name}: ${[server.command, ...server.args].join(' ')}`);
    }
    channel.appendLine('// To monitor stdio servers, run "MyAI: Enable MCP Monitoring".');
  }
  channel.show();
  void vscode.window.showInformationMessage(`MyAI: MCP config summary generated from ${source}. See Output -> MyAI.`);
}
