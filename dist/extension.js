"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  IPC_SOCKET_PATH: () => IPC_SOCKET_PATH,
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode3 = __toESM(require("vscode"));
var cp = __toESM(require("child_process"));
var http = __toESM(require("http"));
var os3 = __toESM(require("os"));
var path4 = __toESM(require("path"));
var fs5 = __toESM(require("fs"));

// src/panel/AgentPanel.ts
var vscode = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
var AgentPanel = class _AgentPanel {
  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  constructor(panel, extensionUri, proxyPort2) {
    this._disposables = [];
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._proxyPort = proxyPort2;
    this._panel.title = "AI Agent Monitor";
    this._panel.webview.html = this._buildHtml(this._panel.webview);
    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      null,
      this._disposables
    );
  }
  static {
    this.viewType = "myaiAgentMonitor";
  }
  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------
  /**
   * If a panel is already open, send it an updated proxy port without
   * revealing or disrupting it. Called whenever the proxy (re)starts.
   */
  static notifyProxyPort(proxyPort2) {
    if (_AgentPanel.currentPanel) {
      _AgentPanel.currentPanel._proxyPort = proxyPort2;
      _AgentPanel.currentPanel._panel.webview.postMessage({ type: "init", proxyPort: proxyPort2 });
    }
  }
  static createOrShow(extensionUri, proxyPort2) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
    if (_AgentPanel.currentPanel) {
      _AgentPanel.currentPanel._panel.reveal(column);
      _AgentPanel.currentPanel._proxyPort = proxyPort2;
      _AgentPanel.currentPanel._panel.webview.postMessage({ type: "init", proxyPort: proxyPort2 });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      _AgentPanel.viewType,
      "AI Agent Monitor",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")]
      }
    );
    _AgentPanel.currentPanel = new _AgentPanel(panel, extensionUri, proxyPort2);
  }
  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------
  _handleMessage(message) {
    switch (message.type) {
      case "ready":
        this._panel.webview.postMessage({ type: "init", proxyPort: this._proxyPort });
        break;
      case "clearSession":
        vscode.commands.executeCommand("myai.clearSession");
        break;
    }
  }
  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------
  _buildHtml(webview) {
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "panel", "webview", "app.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "panel", "webview", "styles.css")
    );
    const htmlPath = path.join(
      this._extensionUri.fsPath,
      "dist",
      "panel",
      "webview",
      "index.html"
    );
    let html = fs.readFileSync(htmlPath, "utf8");
    html = html.replace(/\{\{nonce\}\}/g, nonce).replace(/\{\{cspSource\}\}/g, webview.cspSource).replace(/\{\{styleUri\}\}/g, styleUri.toString()).replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
    return html;
  }
  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  _dispose() {
    _AgentPanel.currentPanel = void 0;
    _AgentPanel.onDidDispose?.();
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }
};

// src/monitoring-commands.ts
var fs3 = __toESM(require("fs"));
var vscode2 = __toESM(require("vscode"));

// src/mcp-config.ts
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));
function resolveRuntimeAppName() {
  try {
    const vscode4 = require("vscode");
    return vscode4.env.appName;
  } catch {
    return "Visual Studio Code";
  }
}
function detectIde(appNameOverride) {
  const appName = appNameOverride ?? resolveRuntimeAppName();
  if (appName === "Cursor") {
    return {
      ide: "cursor",
      appName,
      rootKey: "mcpServers"
    };
  }
  return {
    ide: "vscode",
    appName,
    rootKey: "servers"
  };
}
function resolveUserMcpConfigPath(ide, platform = process.platform, homeDir = os.homedir()) {
  if (ide === "cursor") {
    if (platform === "win32") {
      return path2.join(homeDir, ".cursor", "mcp.json");
    }
    return path2.join(homeDir, ".cursor", "mcp.json");
  }
  if (platform === "darwin") {
    return path2.join(homeDir, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      return path2.join(appData, "Code", "User", "mcp.json");
    }
    return path2.join(homeDir, "AppData", "Roaming", "Code", "User", "mcp.json");
  }
  return path2.join(homeDir, ".config", "Code", "User", "mcp.json");
}

// src/types/index.ts
var MYAI_IPC_SOCKET = "MYAI_IPC_SOCKET";
var MYAI_REAL_SERVER = "MYAI_REAL_SERVER";
var MYAI_REAL_URL = "MYAI_REAL_URL";
var MYAI_SERVER_NAME = "MYAI_SERVER_NAME";
var MYAI_CONFIG_PATH = "MYAI_CONFIG_PATH";
var MYAI_EXT_DIR = "MYAI_EXT_DIR";
var MYAI_WRAPPER_VERSION = "MYAI_WRAPPER_VERSION";

// src/mcp-wrap.ts
function stripMyAiEnv(env) {
  const result = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!key.startsWith("MYAI_")) {
      result[key] = value;
    }
  }
  return result;
}
function isWrapped(entry) {
  return Boolean(entry?.env?.[MYAI_IPC_SOCKET] || entry?.env?.[MYAI_REAL_URL]);
}
function wrapEntry(entry, options) {
  const baseEnv = stripMyAiEnv(entry.env);
  const metadata = {
    [MYAI_SERVER_NAME]: options.serverName,
    [MYAI_CONFIG_PATH]: options.configPath,
    [MYAI_EXT_DIR]: options.extensionDir,
    [MYAI_WRAPPER_VERSION]: options.wrapperVersion
  };
  if (entry.url) {
    return {
      ...entry,
      url: `http://127.0.0.1:${options.proxyPort}/${options.serverName}`,
      env: {
        ...baseEnv,
        ...metadata,
        [MYAI_REAL_URL]: entry.url
      }
    };
  }
  const serialized = {
    command: entry.command,
    args: [...entry.args ?? []],
    env: { ...baseEnv }
  };
  return {
    command: "node",
    args: [options.wrapperPath, options.serverName],
    env: {
      ...baseEnv,
      ...metadata,
      [MYAI_IPC_SOCKET]: options.ipcSocket,
      [MYAI_REAL_SERVER]: JSON.stringify(serialized)
    }
  };
}
function unwrapEntry(entry) {
  const env = { ...entry.env ?? {} };
  if (env[MYAI_REAL_URL]) {
    const realUrl = env[MYAI_REAL_URL];
    const cleanEnv = stripMyAiEnv(env);
    const restored2 = {
      ...entry,
      url: realUrl
    };
    if (Object.keys(cleanEnv).length > 0) {
      restored2.env = cleanEnv;
    } else {
      delete restored2.env;
    }
    return restored2;
  }
  if (!env[MYAI_REAL_SERVER]) {
    return {
      ...entry,
      env: stripMyAiEnv(env)
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(env[MYAI_REAL_SERVER]);
  } catch {
    parsed = void 0;
  }
  const restoredEnv = {
    ...parsed?.env ?? {},
    ...stripMyAiEnv(env)
  };
  const restored = {
    command: parsed?.command,
    args: [...parsed?.args ?? []]
  };
  if (Object.keys(restoredEnv).length > 0) {
    restored.env = restoredEnv;
  }
  return restored;
}

// src/wrapper-deploy.ts
var fs2 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path3 = __toESM(require("path"));
var VERSION_PATTERN = /^\/\/\s*MYAI_WRAPPER_VERSION=(.+)$/m;
function resolveStableWrapperPath(homeDir = os2.homedir()) {
  return path3.join(homeDir, ".myai", "stdio-wrapper.js");
}
function readWrapperVersionFromContent(content) {
  const match = content.match(VERSION_PATTERN);
  return match?.[1]?.trim();
}
function deployWrapper(context) {
  const bundledPath = context.asAbsolutePath(path3.join("dist", "proxy", "stdio-wrapper.js"));
  const stablePath = resolveStableWrapperPath();
  const stableDir = path3.dirname(stablePath);
  const bundledContent = fs2.readFileSync(bundledPath, "utf8");
  const bundledVersion = readWrapperVersionFromContent(bundledContent) ?? "unknown";
  fs2.mkdirSync(stableDir, { recursive: true });
  let shouldCopy = true;
  if (fs2.existsSync(stablePath)) {
    const existingContent = fs2.readFileSync(stablePath, "utf8");
    const existingVersion = readWrapperVersionFromContent(existingContent);
    shouldCopy = existingVersion !== bundledVersion;
  }
  if (shouldCopy) {
    fs2.writeFileSync(stablePath, bundledContent, "utf8");
  }
  return {
    deployedPath: stablePath,
    deployed: shouldCopy,
    version: bundledVersion
  };
}

// src/monitoring-commands.ts
function readConfig(configPath) {
  if (!fs3.existsSync(configPath)) {
    return void 0;
  }
  try {
    return JSON.parse(fs3.readFileSync(configPath, "utf8"));
  } catch {
    return void 0;
  }
}
function writeConfig(configPath, data) {
  fs3.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}
`, "utf8");
}
function getRoot(config, rootKey) {
  if (!config[rootKey]) {
    config[rootKey] = {};
  }
  return config[rootKey] ?? {};
}
async function enableMonitoring(context, options) {
  const ide = detectIde();
  const configPath = resolveUserMcpConfigPath(ide.ide);
  const decision = await vscode2.window.showInformationMessage(
    `MyAI will update ${configPath}. You should expect one trust prompt per MCP server.`,
    "Enable",
    "Cancel"
  );
  if (decision !== "Enable") {
    return;
  }
  const config = readConfig(configPath);
  if (!config) {
    vscode2.window.showErrorMessage(`MyAI: No MCP configuration found at ${configPath}`);
    return;
  }
  const root = getRoot(config, ide.rootKey);
  const entries = Object.entries(root);
  if (entries.length === 0) {
    vscode2.window.showInformationMessage("MyAI: No MCP servers found to wrap.");
    return;
  }
  if (entries.every(([, entry]) => isWrapped(entry))) {
    vscode2.window.showInformationMessage("MyAI: MCP monitoring is already enabled.");
    return;
  }
  const deploy = deployWrapper(context);
  const proxyPort2 = options.proxyPortProvider();
  if (proxyPort2 === void 0) {
    vscode2.window.showErrorMessage("MyAI: Proxy is not running, cannot enable monitoring yet.");
    return;
  }
  const extensionDir = context.extension.extensionPath;
  for (const [serverName, entry] of entries) {
    if (isWrapped(entry)) {
      continue;
    }
    root[serverName] = wrapEntry(entry, {
      serverName,
      wrapperPath: deploy.deployedPath,
      configPath,
      extensionDir,
      wrapperVersion: deploy.version,
      ipcSocket: options.ipcSocketPath,
      proxyPort: proxyPort2
    });
  }
  writeConfig(configPath, config);
  vscode2.window.showInformationMessage(`MyAI: MCP monitoring enabled for ${entries.length} server(s).`);
}
async function disableMonitoring() {
  const ide = detectIde();
  const configPath = resolveUserMcpConfigPath(ide.ide);
  const config = readConfig(configPath);
  if (!config) {
    vscode2.window.showErrorMessage(`MyAI: No MCP configuration found at ${configPath}`);
    return;
  }
  const root = getRoot(config, ide.rootKey);
  const entries = Object.entries(root);
  let restored = 0;
  for (const [name, entry] of entries) {
    if (!entry?.env?.MYAI_IPC_SOCKET && !entry?.env?.MYAI_REAL_URL) {
      continue;
    }
    root[name] = unwrapEntry(entry);
    restored += 1;
  }
  if (restored === 0) {
    vscode2.window.showInformationMessage("MyAI: MCP monitoring is not currently enabled.");
    return;
  }
  writeConfig(configPath, config);
  vscode2.window.showInformationMessage(`MyAI: Restored ${restored} server(s) to original config.`);
}
function registerMonitoringCommands(context, options) {
  const enable = vscode2.commands.registerCommand("myai.enableMonitoring", async () => {
    await enableMonitoring(context, options);
  });
  const disable = vscode2.commands.registerCommand("myai.disableMonitoring", async () => {
    await disableMonitoring();
  });
  context.subscriptions.push(enable, disable);
  return {
    dispose() {
      enable.dispose();
      disable.dispose();
    }
  };
}

// src/stale-check.ts
var fs4 = __toESM(require("fs"));
function checkForStaleWrappers(configPath, rootKey) {
  if (!fs4.existsSync(configPath)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(fs4.readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  const root = parsed[rootKey] ?? {};
  const stale = [];
  for (const [serverName, entry] of Object.entries(root)) {
    if (!entry?.env?.MYAI_IPC_SOCKET) {
      continue;
    }
    const wrapperPath = entry.args?.[0];
    if (!wrapperPath) {
      continue;
    }
    if (!fs4.existsSync(wrapperPath)) {
      stale.push({ serverName, wrapperPath });
    }
  }
  return stale;
}

// src/extension.ts
var IPC_SOCKET_PATH = process.platform === "win32" ? "\\\\.\\pipe\\myai-extension" : path4.join(os3.tmpdir(), "myai-extension.sock");
var ipcServer;
function startIpcServer() {
  if (process.platform !== "win32") {
    try {
      fs5.unlinkSync(IPC_SOCKET_PATH);
    } catch {
    }
  }
  ipcServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/internal/telemetry") {
      if (!proxyPort) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "proxy not ready" }));
        return;
      }
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const proxyReq = http.request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            path: "/internal/telemetry",
            method: "POST",
            headers: { "content-type": "application/json", "content-length": body.length }
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 200, { "content-type": "application/json" });
            proxyRes.pipe(res);
          }
        );
        proxyReq.on("error", () => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end("{}");
        });
        proxyReq.write(body);
        proxyReq.end();
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ port: proxyPort ?? null }) + "\n");
  });
  ipcServer.listen(IPC_SOCKET_PATH);
}
function stopIpcServer() {
  ipcServer?.close();
  ipcServer = void 0;
  if (process.platform !== "win32") {
    try {
      fs5.unlinkSync(IPC_SOCKET_PATH);
    } catch {
    }
  }
}
var outputChannel;
var proxyProcess;
var proxyPort;
function activate(context) {
  outputChannel = vscode3.window.createOutputChannel("MyAI");
  context.subscriptions.push(outputChannel);
  startIpcServer();
  outputChannel.appendLine(`MyAI: IPC socket at ${IPC_SOCKET_PATH}`);
  const proxyPath = context.asAbsolutePath(path4.join("dist", "proxy", "server.js"));
  startProxy(context, proxyPath, false);
  const ideConfig = detectIde();
  if (ideConfig.appName !== "Visual Studio Code" && ideConfig.appName !== "Cursor") {
    outputChannel.appendLine(
      `MyAI: unknown IDE appName "${ideConfig.appName}", defaulting to VS Code conventions.`
    );
  }
  const openPanelCmd = vscode3.commands.registerCommand("myai.openPanel", () => {
    if (proxyPort === void 0) {
      vscode3.window.showErrorMessage("MyAI: Proxy is not running. Try reloading the window.");
      return;
    }
    context.globalState.update("panelWasOpen", true);
    AgentPanel.createOrShow(context.extensionUri, proxyPort);
  });
  AgentPanel.onDidDispose = () => context.globalState.update("panelWasOpen", false);
  const clearSessionCmd = vscode3.commands.registerCommand("myai.clearSession", async () => {
    if (proxyPort === void 0)
      return;
    try {
      await fetch(`http://127.0.0.1:${proxyPort}/internal/clear`, { method: "POST" });
    } catch (err) {
      outputChannel.appendLine(`clearSession failed: ${err}`);
    }
  });
  const showConfigCmd = vscode3.commands.registerCommand("myai.showMcpConfig", () => {
    if (proxyPort === void 0) {
      vscode3.window.showErrorMessage("MyAI: Proxy is not running yet. Please wait a moment and try again.");
      return;
    }
    showProxyConfigSnippet(proxyPort, outputChannel);
  });
  context.subscriptions.push(openPanelCmd, clearSessionCmd, showConfigCmd);
  registerMonitoringCommands(context, {
    ipcSocketPath: IPC_SOCKET_PATH,
    proxyPortProvider: () => proxyPort
  });
}
function startProxy(context, proxyPath, isRestart) {
  const mcpServers = readWorkspaceHttpServerMap();
  const configArg = JSON.stringify({ servers: mcpServers });
  const child = cp.spawn("node", [proxyPath, configArg], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  proxyProcess = child;
  proxyPort = void 0;
  let portReceived = false;
  let stdoutBuffer = "";
  const portTimeout = setTimeout(() => {
    if (!portReceived) {
      outputChannel.appendLine("MyAI: Proxy did not report a port within 5 seconds.");
      vscode3.window.showErrorMessage(
        'MyAI: Proxy failed to start. Run "MyAI: Open Agent Monitor Panel" again after reloading.'
      );
    }
  }, 5e3);
  child.stdout?.on("data", (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed)
        continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.port === "number") {
          portReceived = true;
          proxyPort = parsed.port;
          clearTimeout(portTimeout);
          outputChannel.appendLine(`MyAI: Proxy listening on port ${proxyPort}`);
          if (context.globalState.get("panelWasOpen")) {
            AgentPanel.createOrShow(context.extensionUri, proxyPort);
          } else {
            AgentPanel.notifyProxyPort(proxyPort);
          }
          const ideConfig = detectIde();
          const configPath = resolveUserMcpConfigPath(ideConfig.ide);
          const staleWrappers = checkForStaleWrappers(configPath, ideConfig.rootKey);
          if (staleWrappers.length > 0) {
            void vscode3.window.showWarningMessage(
              'MyAI monitoring needs to be re-enabled. Run "MyAI: Enable MCP Monitoring".'
            );
          }
        }
      } catch {
      }
    }
  });
  child.stderr?.on("data", (data) => {
    outputChannel.appendLine(`MyAI: ${data.toString().trimEnd()}`);
  });
  child.on("exit", (code) => {
    clearTimeout(portTimeout);
    proxyPort = void 0;
    outputChannel.appendLine(`MyAI: Proxy exited (code ${code}).`);
    if (!isRestart && context.extension.isActive) {
      outputChannel.appendLine("MyAI: Attempting one proxy restart\u2026");
      startProxy(context, proxyPath, true);
    }
  });
  context.subscriptions.push({
    dispose() {
      terminateProxy();
    }
  });
}
function terminateProxy() {
  if (!proxyProcess)
    return;
  const child = proxyProcess;
  proxyProcess = void 0;
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }, 2e3);
  killTimer.unref?.();
}
function deactivate() {
  terminateProxy();
  stopIpcServer();
}
function collectAllServers(mcpJson) {
  const merged = {};
  if (mcpJson.servers) {
    Object.assign(merged, mcpJson.servers);
  }
  if (mcpJson.mcpServers) {
    Object.assign(merged, mcpJson.mcpServers);
  }
  return merged;
}
function collectHttpServerUrls(servers) {
  const urls = {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg.url) {
      continue;
    }
    if (cfg.type && cfg.type !== "http") {
      continue;
    }
    urls[name] = cfg.url;
  }
  return urls;
}
function readWorkspaceHttpServerMap() {
  const fromWorkspace = {};
  const workspaceFolders = vscode3.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const mcpPath = path4.join(folder.uri.fsPath, ".vscode", "mcp.json");
      try {
        const raw = fs5.readFileSync(mcpPath, "utf8");
        const mcpJson = JSON.parse(raw);
        Object.assign(fromWorkspace, collectHttpServerUrls(collectAllServers(mcpJson)));
      } catch {
      }
    }
  }
  return fromWorkspace;
}
function readMcpConfigForDisplay() {
  const ide = detectIde();
  const userConfigPath = resolveUserMcpConfigPath(ide.ide);
  try {
    const raw = fs5.readFileSync(userConfigPath, "utf8");
    const mcpJson = JSON.parse(raw);
    return { servers: collectAllServers(mcpJson), source: userConfigPath };
  } catch {
  }
  return { servers: {}, source: "none" };
}
function showProxyConfigSnippet(port, channel) {
  const { servers: allServers, source } = readMcpConfigForDisplay();
  if (Object.keys(allServers).length === 0) {
    vscode3.window.showInformationMessage(
      "MyAI: No MCP servers found in IDE user mcp.json."
    );
    return;
  }
  const mcpServers = collectHttpServerUrls(allServers);
  const stdioServers = [];
  for (const [name, cfg] of Object.entries(allServers)) {
    const isHttp = Boolean(cfg.url && (!cfg.type || cfg.type === "http"));
    if (isHttp) {
      continue;
    }
    if (cfg.type === "stdio" || cfg.command) {
      stdioServers.push({
        name,
        command: cfg.command ?? "(unknown)",
        args: cfg.args ?? []
      });
    }
  }
  const proxied = {};
  for (const name of Object.keys(mcpServers)) {
    proxied[name] = {
      type: "http",
      url: `http://127.0.0.1:${port}/${name}`
    };
  }
  channel.clear();
  channel.appendLine(`// Source: ${source}`);
  channel.appendLine(`// Found ${Object.keys(allServers).length} total server(s)`);
  channel.appendLine(`// HTTP URL server(s): ${Object.keys(mcpServers).length}`);
  channel.appendLine(`// Stdio server(s): ${stdioServers.length}`);
  channel.appendLine("");
  if (Object.keys(mcpServers).length > 0) {
    const snippet = JSON.stringify({ servers: proxied }, null, 2);
    channel.appendLine('// HTTP proxy snippet: replace your "servers" section with this if desired');
    channel.appendLine("// (Do NOT overwrite the file automatically \u2014 review and paste manually)");
    channel.appendLine("");
    channel.appendLine(snippet);
    channel.appendLine("");
  }
  if (stdioServers.length > 0) {
    channel.appendLine("// Stdio servers detected (not converted by this snippet):");
    for (const server of stdioServers) {
      const argv = [server.command, ...server.args].join(" ").trim();
      channel.appendLine(`// - ${server.name}: ${argv}`);
    }
    channel.appendLine('// To monitor stdio servers, run "MyAI: Enable MCP Monitoring".');
  }
  channel.show();
  void vscode3.window.showInformationMessage(
    `MyAI: MCP config summary generated from ${source}. See Output -> MyAI.`
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IPC_SOCKET_PATH,
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
