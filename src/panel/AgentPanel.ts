import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export class AgentPanel {
  public static currentPanel: AgentPanel | undefined;
  public static onDidDispose: (() => void) | undefined;
  private static readonly viewType = 'myaiAgentMonitor';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _proxyPort: number;
  private readonly _disposables: vscode.Disposable[] = [];

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  /**
   * If a panel is already open, send it an updated proxy port without
   * revealing or disrupting it. Called whenever the proxy (re)starts.
   */
  public static notifyProxyPort(proxyPort: number): void {
    if (AgentPanel.currentPanel) {
      AgentPanel.currentPanel._proxyPort = proxyPort;
      AgentPanel.currentPanel._panel.webview.postMessage({ type: 'init', proxyPort });
    }
  }

  public static createOrShow(extensionUri: vscode.Uri, proxyPort: number): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (AgentPanel.currentPanel) {
      // Panel already open — reveal it and re-send init (handles proxy restarts)
      AgentPanel.currentPanel._panel.reveal(column);
      AgentPanel.currentPanel._proxyPort = proxyPort;
      AgentPanel.currentPanel._panel.webview.postMessage({ type: 'init', proxyPort });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AgentPanel.viewType,
      'AI Agent Monitor',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    AgentPanel.currentPanel = new AgentPanel(panel, extensionUri, proxyPort);
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    proxyPort: number,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._proxyPort = proxyPort;

    this._panel.title = 'AI Agent Monitor';
    this._panel.webview.html = this._buildHtml(this._panel.webview);

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: { type: string }) => this._handleMessage(message),
      null,
      this._disposables,
    );
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private _handleMessage(message: { type: string }): void {
    switch (message.type) {
      case 'ready':
        // WebView has loaded — send the proxy port so it can connect
        this._panel.webview.postMessage({ type: 'init', proxyPort: this._proxyPort });
        break;

      case 'clearSession':
        vscode.commands.executeCommand('myai.clearSession');
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  private _buildHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'panel', 'webview', 'app.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'panel', 'webview', 'styles.css'),
    );

    const htmlPath = path.join(
      this._extensionUri.fsPath,
      'dist',
      'panel',
      'webview',
      'index.html',
    );
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{cspSource\}\}/g, webview.cspSource)
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private _dispose(): void {
    AgentPanel.currentPanel = undefined;
    AgentPanel.onDidDispose?.();
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      d?.dispose();
    }
  }
}
