import * as fs from 'fs';
import type { McpRootKey } from './mcp-config';

export interface McpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
}

export interface McpConfig {
  servers?: Record<string, McpEntry>;
  mcpServers?: Record<string, McpEntry>;
}

export function readMcpConfig(configPath: string): McpConfig | undefined {
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as McpConfig;
  } catch {
    return undefined;
  }
}

export function writeMcpConfig(configPath: string, data: McpConfig): void {
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Prefer whichever root key already has entries; otherwise use the IDE default. */
export function resolveConfigRoot(
  config: McpConfig,
  preferredKey: McpRootKey,
): { root: Record<string, McpEntry>; rootKey: McpRootKey } {
  const mcpCount = Object.keys(config.mcpServers ?? {}).length;
  const serversCount = Object.keys(config.servers ?? {}).length;
  const rootKey: McpRootKey =
    mcpCount > 0 ? 'mcpServers' : serversCount > 0 ? 'servers' : preferredKey;
  if (!config[rootKey]) {
    config[rootKey] = {};
  }
  return { root: config[rootKey] ?? {}, rootKey };
}

export function countServers(config: McpConfig | undefined): number {
  if (!config) return 0;
  return Object.keys(config.mcpServers ?? {}).length + Object.keys(config.servers ?? {}).length;
}
