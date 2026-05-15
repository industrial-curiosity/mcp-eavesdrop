import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unwrapEntry } from './mcp-wrap';

interface McpEntry {
  env?: Record<string, string>;
}

interface McpConfig {
  servers?: Record<string, McpEntry>;
  mcpServers?: Record<string, McpEntry>;
}

export function resolveAllMcpConfigPaths(
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
): string[] {
  const paths = new Set<string>();

  if (platform === 'darwin') {
    paths.add(path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      paths.add(path.join(appData, 'Code', 'User', 'mcp.json'));
    } else {
      paths.add(path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'));
    }
  } else {
    paths.add(path.join(homeDir, '.config', 'Code', 'User', 'mcp.json'));
  }

  if (platform === 'win32') {
    paths.add(path.join(homeDir, '.cursor', 'mcp.json'));
  } else {
    paths.add(path.join(homeDir, '.cursor', 'mcp.json'));
  }

  return [...paths];
}

function restoreRoot(root: Record<string, McpEntry> | undefined, rootKey: string, filePath: string): number {
  if (!root) {
    return 0;
  }

  let restored = 0;
  for (const [serverName, entry] of Object.entries(root)) {
    if (!entry?.env?.MYAI_IPC_SOCKET && !entry?.env?.MYAI_REAL_URL) {
      continue;
    }

    root[serverName] = unwrapEntry(entry);
    restored += 1;
    process.stdout.write(`restored ${serverName} in ${filePath} (${rootKey})\n`);
  }

  return restored;
}

function processConfig(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    process.stdout.write(`skip missing ${filePath}\n`);
    return;
  }

  let parsed: McpConfig;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as McpConfig;
  } catch {
    process.stdout.write(`skip unreadable ${filePath}\n`);
    return;
  }

  const restoredCount =
    restoreRoot(parsed.servers, 'servers', filePath) +
    restoreRoot(parsed.mcpServers, 'mcpServers', filePath);

  if (restoredCount > 0) {
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  } else {
    process.stdout.write(`no wrapped entries in ${filePath}\n`);
  }
}

function removeMyAiDir(homeDir = os.homedir()): void {
  const myAiDir = path.join(homeDir, '.myai');
  fs.rmSync(myAiDir, { recursive: true, force: true });
  process.stdout.write(`removed ${myAiDir}\n`);
}

function run(): void {
  for (const configPath of resolveAllMcpConfigPaths()) {
    processConfig(configPath);
  }
  removeMyAiDir();
}

if (require.main === module) {
  run();
}
