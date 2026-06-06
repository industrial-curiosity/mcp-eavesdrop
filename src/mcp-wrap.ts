import {
  MCPEAVESDROP_CONFIG_PATH,
  MCPEAVESDROP_EXT_DIR,
  MCPEAVESDROP_IDE,
  MCPEAVESDROP_IPC_SOCKET,
  MCPEAVESDROP_REAL_SERVER,
  MCPEAVESDROP_REAL_URL,
  MCPEAVESDROP_SERVER_NAME,
  MCPEAVESDROP_WRAPPER_VERSION,
  MCPEAVESDROP_WORKSPACE_SLUG,
} from './types';

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  type?: string;
}

export interface WrapOptions {
  serverName: string;
  wrapperPath: string;
  configPath: string;
  extensionDir: string;
  wrapperVersion: string;
  ide: string;
  workspaceSlug: string;
}

interface SerializedRealServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

function stripMcpEavesdropEnv(env: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!key.startsWith('MCPEAVESDROP_')) {
      result[key] = value;
    }
  }
  return result;
}

export function isWrapped(entry: McpServerEntry): boolean {
  // Check MCPEAVESDROP_IPC_SOCKET for backward compat with entries wrapped by older extension versions
  return Boolean(
    entry?.env?.[MCPEAVESDROP_IPC_SOCKET] ||
    entry?.env?.[MCPEAVESDROP_REAL_SERVER] ||
    entry?.env?.[MCPEAVESDROP_REAL_URL],
  );
}

export function wrapEntry(entry: McpServerEntry, options: WrapOptions): McpServerEntry {
  const baseEnv = stripMcpEavesdropEnv(entry.env);
  const metadata: Record<string, string> = {
    [MCPEAVESDROP_SERVER_NAME]: options.serverName,
    [MCPEAVESDROP_CONFIG_PATH]: options.configPath,
    [MCPEAVESDROP_EXT_DIR]: options.extensionDir,
    [MCPEAVESDROP_WRAPPER_VERSION]: options.wrapperVersion,
    [MCPEAVESDROP_IDE]: options.ide,
    [MCPEAVESDROP_WORKSPACE_SLUG]: options.workspaceSlug,
  };

  if (entry.url) {
    // HTTP server → converted to stdio so it routes through the daemon TCP proxy (bridge mode)
    return {
      command: 'node',
      args: [options.wrapperPath],
      env: {
        ...baseEnv,
        ...metadata,
        [MCPEAVESDROP_REAL_URL]: entry.url,
      },
    };
  }

  const serialized: SerializedRealServer = {
    command: entry.command,
    args: [...(entry.args ?? [])],
    env: { ...baseEnv },
  };

  return {
    command: 'node',
    args: [options.wrapperPath],
    env: {
      ...baseEnv,
      ...metadata,
      [MCPEAVESDROP_REAL_SERVER]: JSON.stringify(serialized),
    },
  };
}

export function unwrapEntry(entry: McpServerEntry): McpServerEntry {
  const env = { ...(entry.env ?? {}) };

  if (env[MCPEAVESDROP_REAL_URL]) {
    const realUrl = env[MCPEAVESDROP_REAL_URL];
    const cleanEnv = stripMcpEavesdropEnv(env);
    // Restore as a clean HTTP entry regardless of whether it was originally stdio or http
    const restored: McpServerEntry = { url: realUrl };
    if (entry.type) restored.type = entry.type;
    if (Object.keys(cleanEnv).length > 0) {
      restored.env = cleanEnv;
    }
    return restored;
  }

  if (!env[MCPEAVESDROP_REAL_SERVER]) {
    return {
      ...entry,
      env: stripMcpEavesdropEnv(env),
    };
  }

  let parsed: SerializedRealServer | undefined;
  try {
    parsed = JSON.parse(env[MCPEAVESDROP_REAL_SERVER]) as SerializedRealServer;
  } catch {
    parsed = undefined;
  }

  const restoredEnv = {
    ...(parsed?.env ?? {}),
    ...stripMcpEavesdropEnv(env),
  };

  const restored: McpServerEntry = {
    command: parsed?.command,
    args: [...(parsed?.args ?? [])],
  };

  if (Object.keys(restoredEnv).length > 0) {
    restored.env = restoredEnv;
  }

  return restored;
}
