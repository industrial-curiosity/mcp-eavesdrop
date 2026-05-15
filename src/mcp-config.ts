import * as os from 'os';
import * as path from 'path';

export type IdeKind = 'vscode' | 'cursor';
export type McpRootKey = 'servers' | 'mcpServers';

export interface IdeConfig {
  ide: IdeKind;
  appName: string;
  rootKey: McpRootKey;
}

function resolveRuntimeAppName(): string {
  try {
    // Lazy import so this module can run in plain Node.js scripts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require('vscode') as typeof import('vscode');
    return vscode.env.appName;
  } catch {
    return 'Visual Studio Code';
  }
}

export function detectIde(appNameOverride?: string): IdeConfig {
  const appName = appNameOverride ?? resolveRuntimeAppName();
  if (appName === 'Cursor') {
    return {
      ide: 'cursor',
      appName,
      rootKey: 'mcpServers',
    };
  }

  return {
    ide: 'vscode',
    appName,
    rootKey: 'servers',
  };
}

export function resolveUserMcpConfigPath(
  ide: IdeKind,
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): string {
  if (ide === 'cursor') {
    if (platform === 'win32') {
      return path.join(homeDir, '.cursor', 'mcp.json');
    }
    return path.join(homeDir, '.cursor', 'mcp.json');
  }

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, 'Code', 'User', 'mcp.json');
    }
    return path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json');
  }
  return path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
}

export function resolveRootKey(ide: IdeKind): McpRootKey {
  return ide === 'cursor' ? 'mcpServers' : 'servers';
}

export function resolveUserMcpConfigForCurrentIde(): {
  configPath: string;
  ideConfig: IdeConfig;
} {
  const ideConfig = detectIde();
  return {
    configPath: resolveUserMcpConfigPath(ideConfig.ide),
    ideConfig,
  };
}
