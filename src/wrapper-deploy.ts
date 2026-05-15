import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface DeployResult {
  deployedPath: string;
  deployed: boolean;
  version: string;
}

const VERSION_PATTERN = /^\/\/\s*MYAI_WRAPPER_VERSION=(.+)$/m;

export function resolveStableWrapperPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.myai', 'stdio-wrapper.js');
}

export function readWrapperVersionFromContent(content: string): string | undefined {
  const match = content.match(VERSION_PATTERN);
  return match?.[1]?.trim();
}

export function deployWrapper(context: vscode.ExtensionContext): DeployResult {
  const bundledPath = context.asAbsolutePath(path.join('dist', 'proxy', 'stdio-wrapper.js'));
  const stablePath = resolveStableWrapperPath();
  const stableDir = path.dirname(stablePath);

  const bundledContent = fs.readFileSync(bundledPath, 'utf8');
  const bundledVersion = readWrapperVersionFromContent(bundledContent) ?? 'unknown';

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
