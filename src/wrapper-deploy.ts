import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DAEMON_SOCKET_PATH } from './daemon/constants';

export interface DeployResult {
  deployedPath: string;
  deployed: boolean;
  version: string;
}

const VERSION_PATTERN = /^\/\/\s*MCPEAVESDROP_WRAPPER_VERSION=(.+)$/m;
const SOCKET_PLACEHOLDER = '__DAEMON_SOCKET_PATH__';

export function resolveStableWrapperPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.mcpEavesdrop', 'stdio-wrapper.js');
}

export function readWrapperVersionFromContent(content: string): string | undefined {
  const match = VERSION_PATTERN.exec(content);
  return match?.[1]?.trim();
}

export function deployWrapper(context: vscode.ExtensionContext): DeployResult {
  const bundledPath = context.asAbsolutePath(path.join('dist', 'proxy', 'stdio-wrapper.js'));
  const stablePath = resolveStableWrapperPath();
  const stableDir = path.dirname(stablePath);

  let bundledContent = fs.readFileSync(bundledPath, 'utf8');
  const bundledVersion = readWrapperVersionFromContent(bundledContent) ?? 'unknown';

  // Inject daemon constants into the deployed copy
  bundledContent = bundledContent.replace(SOCKET_PLACEHOLDER, DAEMON_SOCKET_PATH);

  fs.mkdirSync(stableDir, { recursive: true });

  let shouldCopy = true;
  if (fs.existsSync(stablePath)) {
    const existingContent = fs.readFileSync(stablePath, 'utf8');
    const existingVersion = readWrapperVersionFromContent(existingContent);
    shouldCopy = existingVersion !== bundledVersion;
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
