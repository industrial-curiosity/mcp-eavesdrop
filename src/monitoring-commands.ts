import * as fs from 'fs';
import * as vscode from 'vscode';
import { detectIde, resolveUserMcpConfigPath } from './mcp-config';
import { isWrapped, unwrapEntry, wrapEntry } from './mcp-wrap';
import { deployWrapper } from './wrapper-deploy';

interface MonitoringCommandOptions {
  ipcSocketPath: string;
  proxyPortProvider: () => number | undefined;
}

type RootKey = 'servers' | 'mcpServers';

interface McpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
}

interface McpConfig {
  servers?: Record<string, McpEntry>;
  mcpServers?: Record<string, McpEntry>;
}

function readConfig(configPath: string): McpConfig | undefined {
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as McpConfig;
  } catch {
    return undefined;
  }
}

function writeConfig(configPath: string, data: McpConfig): void {
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getRoot(config: McpConfig, rootKey: RootKey): Record<string, McpEntry> {
  if (!config[rootKey]) {
    config[rootKey] = {};
  }
  return config[rootKey] ?? {};
}

async function enableMonitoring(
  context: vscode.ExtensionContext,
  options: MonitoringCommandOptions,
): Promise<void> {
  const ide = detectIde();
  const configPath = resolveUserMcpConfigPath(ide.ide);

  const decision = await vscode.window.showInformationMessage(
    `MyAI will update ${configPath}. You should expect one trust prompt per MCP server.`,
    'Enable',
    'Cancel',
  );

  if (decision !== 'Enable') {
    return;
  }

  const config = readConfig(configPath);
  if (!config) {
    vscode.window.showErrorMessage(`MyAI: No MCP configuration found at ${configPath}`);
    return;
  }

  const root = getRoot(config, ide.rootKey);
  const entries = Object.entries(root);
  if (entries.length === 0) {
    vscode.window.showInformationMessage('MyAI: No MCP servers found to wrap.');
    return;
  }

  if (entries.every(([, entry]) => isWrapped(entry))) {
    vscode.window.showInformationMessage('MyAI: MCP monitoring is already enabled.');
    return;
  }

  const deploy = deployWrapper(context);
  const proxyPort = options.proxyPortProvider();
  if (proxyPort === undefined) {
    vscode.window.showErrorMessage('MyAI: Proxy is not running, cannot enable monitoring yet.');
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
      proxyPort,
    });
  }

  writeConfig(configPath, config);
  vscode.window.showInformationMessage(`MyAI: MCP monitoring enabled for ${entries.length} server(s).`);
}

async function disableMonitoring(): Promise<void> {
  const ide = detectIde();
  const configPath = resolveUserMcpConfigPath(ide.ide);
  const config = readConfig(configPath);

  if (!config) {
    vscode.window.showErrorMessage(`MyAI: No MCP configuration found at ${configPath}`);
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
    vscode.window.showInformationMessage('MyAI: MCP monitoring is not currently enabled.');
    return;
  }

  writeConfig(configPath, config);
  vscode.window.showInformationMessage(`MyAI: Restored ${restored} server(s) to original config.`);
}

export function registerMonitoringCommands(
  context: vscode.ExtensionContext,
  options: MonitoringCommandOptions,
): vscode.Disposable {
  const enable = vscode.commands.registerCommand('myai.enableMonitoring', async () => {
    await enableMonitoring(context, options);
  });

  const disable = vscode.commands.registerCommand('myai.disableMonitoring', async () => {
    await disableMonitoring();
  });

  context.subscriptions.push(enable, disable);

  return {
    dispose() {
      enable.dispose();
      disable.dispose();
    },
  };
}
