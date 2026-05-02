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
var vscode2 = __toESM(require("vscode"));
var cp = __toESM(require("child_process"));
var net = __toESM(require("net"));
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));

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

// src/extension.ts
var IPC_SOCKET_PATH = path2.join(os.tmpdir(), "myai-extension.sock");
var ipcServer;
function startIpcServer() {
  try {
    fs2.unlinkSync(IPC_SOCKET_PATH);
  } catch {
  }
  ipcServer = net.createServer((socket) => {
    const response = JSON.stringify({ port: proxyPort ?? null }) + "\n";
    socket.end(response);
  });
  ipcServer.listen(IPC_SOCKET_PATH);
}
function stopIpcServer() {
  ipcServer?.close();
  ipcServer = void 0;
  try {
    fs2.unlinkSync(IPC_SOCKET_PATH);
  } catch {
  }
}
var outputChannel;
var proxyProcess;
var proxyPort;
function activate(context) {
  outputChannel = vscode2.window.createOutputChannel("MyAI");
  context.subscriptions.push(outputChannel);
  startIpcServer();
  outputChannel.appendLine(`MyAI: IPC socket at ${IPC_SOCKET_PATH}`);
  const proxyPath = context.asAbsolutePath(path2.join("dist", "proxy", "server.js"));
  startProxy(context, proxyPath, false);
  const openPanelCmd = vscode2.commands.registerCommand("myai.openPanel", () => {
    if (proxyPort === void 0) {
      vscode2.window.showErrorMessage("MyAI: Proxy is not running. Try reloading the window.");
      return;
    }
    context.globalState.update("panelWasOpen", true);
    AgentPanel.createOrShow(context.extensionUri, proxyPort);
  });
  AgentPanel.onDidDispose = () => context.globalState.update("panelWasOpen", false);
  const clearSessionCmd = vscode2.commands.registerCommand("myai.clearSession", async () => {
    if (proxyPort === void 0)
      return;
    try {
      await fetch(`http://127.0.0.1:${proxyPort}/internal/clear`, { method: "POST" });
    } catch (err) {
      outputChannel.appendLine(`clearSession failed: ${err}`);
    }
  });
  const showConfigCmd = vscode2.commands.registerCommand("myai.showMcpConfig", () => {
    if (proxyPort === void 0) {
      vscode2.window.showErrorMessage("MyAI: Proxy is not running yet. Please wait a moment and try again.");
      return;
    }
    showProxyConfigSnippet(proxyPort, outputChannel);
  });
  context.subscriptions.push(openPanelCmd, clearSessionCmd, showConfigCmd);
}
function startProxy(context, proxyPath, isRestart) {
  const mcpServers = readMcpConfig();
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
      vscode2.window.showErrorMessage(
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
function readMcpConfig() {
  const servers = {};
  const workspaceFolders = vscode2.workspace.workspaceFolders;
  if (!workspaceFolders)
    return servers;
  for (const folder of workspaceFolders) {
    const mcpPath = path2.join(folder.uri.fsPath, ".vscode", "mcp.json");
    try {
      const raw = fs2.readFileSync(mcpPath, "utf8");
      const mcpJson = JSON.parse(raw);
      for (const [name, cfg] of Object.entries(mcpJson.servers ?? {})) {
        if (cfg.url) {
          servers[name] = cfg.url;
        }
      }
    } catch {
    }
  }
  return servers;
}
function showProxyConfigSnippet(port, channel) {
  const mcpServers = readMcpConfig();
  if (Object.keys(mcpServers).length === 0) {
    vscode2.window.showInformationMessage(
      "MyAI: No HTTP MCP servers found in workspace .vscode/mcp.json."
    );
    return;
  }
  const proxied = {};
  for (const name of Object.keys(mcpServers)) {
    proxied[name] = {
      type: "http",
      url: `http://127.0.0.1:${port}/${name}`
    };
  }
  const snippet = JSON.stringify({ servers: proxied }, null, 2);
  channel.clear();
  channel.appendLine('// Replace the "servers" section in your .vscode/mcp.json with this proxy-wrapped version:');
  channel.appendLine("// (Do NOT overwrite the file automatically \u2014 review and paste manually)");
  channel.appendLine("");
  channel.appendLine(snippet);
  channel.show();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IPC_SOCKET_PATH,
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
