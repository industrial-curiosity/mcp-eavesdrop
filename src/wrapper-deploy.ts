import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DAEMON_SOCKET_PATH } from './daemon/index';

export interface DeployResult {
  deployedPath: string;
  deployed: boolean;
  version: string;
}

const VERSION_PATTERN = /^\/\/\s*MYAI_WRAPPER_VERSION=(.+)$/m;
const SOCKET_PLACEHOLDER = '__DAEMON_SOCKET_PATH__';
const PORT_PLACEHOLDER = '__DAEMON_PROXY_PORT__';

export function resolveStableWrapperPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.myai', 'stdio-wrapper.js');
}

export function readWrapperVersionFromContent(content: string): string | undefined {
  const match = content.match(VERSION_PATTERN);
  return match?.[1]?.trim();
}

/** Extract the embedded proxy port from a deployed wrapper file. */
export function readWrapperProxyPort(content: string): number | undefined {
  const match = content.match(/parseInt\(['"](\d+)['"],\s*10\)/);
  return match ? parseInt(match[1], 10) : undefined;
}

export function deployWrapper(context: vscode.ExtensionContext, daemonProxyPort: number): DeployResult {
  const bundledPath = context.asAbsolutePath(path.join('dist', 'proxy', 'stdio-wrapper.js'));
  const stablePath = resolveStableWrapperPath();
  const stableDir = path.dirname(stablePath);

  let bundledContent = fs.readFileSync(bundledPath, 'utf8');
  const bundledVersion = readWrapperVersionFromContent(bundledContent) ?? 'unknown';

  // Inject daemon constants into the deployed copy
  bundledContent = bundledContent
    .replace(SOCKET_PLACEHOLDER, DAEMON_SOCKET_PATH)
    .replace(PORT_PLACEHOLDER, String(daemonProxyPort));

  fs.mkdirSync(stableDir, { recursive: true });

  let shouldCopy = true;
  if (fs.existsSync(stablePath)) {
    const existingContent = fs.readFileSync(stablePath, 'utf8');
    const existingVersion = readWrapperVersionFromContent(existingContent);
    const existingPort = readWrapperProxyPort(existingContent);
    // Re-deploy if version changed or port changed
    shouldCopy = existingVersion !== bundledVersion || existingPort !== daemonProxyPort;
  }

  if (shouldCopy) {
    fs.writeFileSync(stablePath, bundledContent, 'utf8');
  }

  return {
    deployedPath: stablePath,
    deployed: shouldCopy,
    version: bundledVersion,
  };
}
