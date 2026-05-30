import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export class AgentPanel {
  public static currentPanel: AgentPanel | undefined;
  public static onDidDispose: (() => void) | undefined;
  public static onPanelReady: (() => void) | undefined;
  private static readonly viewType = 'myaiAgentMonitor';

  public static postMessage(message: unknown): void {
    AgentPanel.currentPanel?._panel.webview.postMessage(message);
  }

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _disposables: vscode.Disposable[] = [];

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (AgentPanel.currentPanel) {
      AgentPanel.currentPanel._panel.reveal(column);
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

    AgentPanel.currentPanel = new AgentPanel(panel, extensionUri);
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

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
      case 'ready': {
        const history = this._loadHistory();
        if (history.length > 0) {
          this._panel.webview.postMessage({ type: 'history', events: history });
        }
        AgentPanel.onPanelReady?.();
        break;
      }

      case 'clearSession':
        vscode.commands.executeCommand('myai.clearSession');
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // History loading
  // ---------------------------------------------------------------------------

  private _loadHistory(): unknown[] {
    const logsDir = path.join(os.homedir(), '.myai', 'logs');
    const events: unknown[] = [];
    try {
      // Structure: <logsDir>/<ide>/<workspaceSlug>/<YYYY-MM-DD>/<serverName>.jsonl
      const ideDirs = fs.readdirSync(logsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(logsDir, d.name));
      for (const ideDir of ideDirs) {
        const workspaceDirs = fs.readdirSync(ideDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(ideDir, d.name));
        for (const wsDir of workspaceDirs) {
          const dateDirs = fs.readdirSync(wsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => path.join(wsDir, d.name));
          for (const dateDir of dateDirs) {
            const logFiles = fs.readdirSync(dateDir).filter(f => f.endsWith('.jsonl'));
            for (const logFile of logFiles) {
              const content = fs.readFileSync(path.join(dateDir, logFile), 'utf8');
              for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try { events.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
              }
            }
          }
        }
      }
    } catch { /* logs dir not present yet */ }
    // Sort by timestamp ascending
    events.sort((a, b) => {
      const ta = (a as { timestamp?: number }).timestamp ?? 0;
      const tb = (b as { timestamp?: number }).timestamp ?? 0;
      return ta - tb;
    });
    return events;
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
