import * as fs from 'fs';

interface McpServerEntry {
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  servers?: Record<string, McpServerEntry>;
  mcpServers?: Record<string, McpServerEntry>;
}

export interface StaleWrapperWarning {
  serverName: string;
  wrapperPath: string;
}

export function checkForStaleWrappers(
  configPath: string,
  rootKey: 'servers' | 'mcpServers',
): StaleWrapperWarning[] {
  if (!fs.existsSync(configPath)) {
    return [];
  }

  let parsed: McpConfig;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as McpConfig;
  } catch {
    return [];
  }

  const root = parsed[rootKey] ?? {};
  const stale: StaleWrapperWarning[] = [];

  for (const [serverName, entry] of Object.entries(root)) {
    if (!entry?.env?.MYAI_IPC_SOCKET) {
      continue;
    }
    const wrapperPath = entry.args?.[0];
    if (!wrapperPath) {
      continue;
    }
    if (!fs.existsSync(wrapperPath)) {
      stale.push({ serverName, wrapperPath });
    }
  }

  return stale;
}
