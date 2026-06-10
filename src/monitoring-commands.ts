import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { detectIde, listMcpConfigPaths, resolveWorkspaceMcpConfigCandidates, type IdeKind } from './mcp-config';
import {
  countServers,
  readMcpConfig,
  resolveConfigRoot,
  writeMcpConfig,
  type McpConfig,
} from './mcp-config-io';
import { isWrapped, unwrapEntry, wrapEntry } from './mcp-wrap';
import { deployWrapper } from './wrapper-deploy';

interface MonitoringCommandOptions {
  ide: string;
}

function workspaceFolderPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function existingConfigPaths(ide: IdeKind): string[] {
  return listMcpConfigPaths(ide, workspaceFolderPath()).filter((p) => fs.existsSync(p));
}

function countUnwrappedServers(config: McpConfig, preferredKey: 'servers' | 'mcpServers'): number {
  const { root } = resolveConfigRoot(config, preferredKey);
  return Object.values(root).filter((entry) => !isWrapped(entry)).length;
}

async function enableMonitoring(
  context: vscode.ExtensionContext,
  options: MonitoringCommandOptions,
): Promise<void> {
  const ide = detectIde();
  const configPaths = existingConfigPaths(ide.ide);
  const pathsWithServers = configPaths.filter((p) => {
    const config = readMcpConfig(p);
    return config && countServers(config) > 0;
  });

  if (pathsWithServers.length === 0) {
    const folder = workspaceFolderPath();
    const hint = folder
      ? ` Expected user config or workspace ${resolveWorkspaceMcpConfigCandidates(ide.ide, folder).join(' or ')}.`
      : ' Open a workspace folder, then retry.';
    vscode.window.showErrorMessage(`MCP Eavesdrop: No MCP configuration with servers found.${hint}`);
    return;
  }

  const pathList = pathsWithServers.map((p) => `  • ${p}`).join('\n');
  const decision = await vscode.window.showInformationMessage(
    `MCP Eavesdrop will wrap MCP servers in:\n${pathList}\n\nExpect one trust prompt per server per config file.`,
    { modal: true },
    'Enable',
    'Cancel',
  );

  if (decision !== 'Enable') {
    return;
  }

  const deploy = deployWrapper(context);
  const extensionDir = context.extension.extensionPath;
  let totalWrapped = 0;

  for (const configPath of pathsWithServers) {
    const config = readMcpConfig(configPath);
    if (!config) continue;

    const { root } = resolveConfigRoot(config, ide.rootKey);
    let wrappedInFile = 0;

    for (const [serverName, entry] of Object.entries(root)) {
      if (isWrapped(entry)) continue;
      root[serverName] = wrapEntry(entry, {
        serverName,
        wrapperPath: deploy.deployedPath,
        configPath,
        extensionDir,
        wrapperVersion: deploy.version,
        ide: options.ide,
      });
      wrappedInFile += 1;
    }

    if (wrappedInFile > 0) {
      writeMcpConfig(configPath, config);
      totalWrapped += wrappedInFile;
    }
  }

  if (totalWrapped === 0) {
    vscode.window.showInformationMessage('MCP Eavesdrop: MCP monitoring is already enabled for all configured servers.');
    return;
  }

  vscode.window.showInformationMessage(
    `MCP Eavesdrop: MCP monitoring enabled for ${totalWrapped} server(s) across ${pathsWithServers.length} config file(s). Reload the window, then use the agent.`,
  );
}

async function disableMonitoring(): Promise<void> {
  const ide = detectIde();
  const configPaths = existingConfigPaths(ide.ide);
  let restored = 0;

  for (const configPath of configPaths) {
    const config = readMcpConfig(configPath);
    if (!config) continue;

    const { root } = resolveConfigRoot(config, ide.rootKey);
    let restoredInFile = 0;
    for (const [name, entry] of Object.entries(root)) {
      if (!isWrapped(entry)) continue;
      root[name] = unwrapEntry(entry);
      restoredInFile += 1;
    }
    if (restoredInFile > 0) {
      writeMcpConfig(configPath, config);
      restored += restoredInFile;
    }
  }

  if (restored === 0) {
    vscode.window.showInformationMessage('MCP Eavesdrop: MCP monitoring is not currently enabled.');
    return;
  }

  vscode.window.showInformationMessage(`MCP Eavesdrop: Restored ${restored} server(s) to original config.`);
}

export function registerMonitoringCommands(
  context: vscode.ExtensionContext,
  options: MonitoringCommandOptions,
): vscode.Disposable {
  const enable = vscode.commands.registerCommand('mcpEavesdrop.enableMonitoring', async () => {
    await enableMonitoring(context, options);
  });

  const disable = vscode.commands.registerCommand('mcpEavesdrop.disableMonitoring', async () => {
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

/** Log MCP config coverage for the active IDE (helps diagnose Cursor vs VS Code dev host). */
export function logMcpConfigDiagnostics(
  ide: IdeKind,
  log: (line: string) => void,
  workspaceFolder?: string,
): void {
  for (const configPath of listMcpConfigPaths(ide, workspaceFolder)) {
    const config = readMcpConfig(configPath);
    if (!config) {
      log(`MCP Eavesdrop: MCP config not found: ${configPath}`);
      continue;
    }
    const { root } = resolveConfigRoot(config, ide === 'cursor' ? 'mcpServers' : 'servers');
    const total = Object.keys(root).length;
    const wrapped = Object.values(root).filter((e) => isWrapped(e)).length;
    log(`MCP Eavesdrop: MCP ${configPath} — ${wrapped}/${total} server(s) monitored`);
  }

  if (ide === 'cursor' && workspaceFolder) {
    const [cursorWs, vscodeWs] = resolveWorkspaceMcpConfigCandidates('cursor', workspaceFolder);
    if (!fs.existsSync(cursorWs) && fs.existsSync(vscodeWs)) {
      const config = readMcpConfig(vscodeWs);
      const unwrapped = config ? countUnwrappedServers(config, 'mcpServers') : 0;
      if (unwrapped > 0) {
        log(
          `MCP Eavesdrop: Cursor uses ${cursorWs} for workspace MCP; this repo only has ${vscodeWs}. ` +
            'Run "MCP Eavesdrop: Enable MCP Monitoring" to wrap workspace servers, or add .cursor/mcp.json.',
        );
      }
    }
  }
}
