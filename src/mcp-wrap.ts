import {
  MYAI_CONFIG_PATH,
  MYAI_EXT_DIR,
  MYAI_IPC_SOCKET,
  MYAI_REAL_SERVER,
  MYAI_REAL_URL,
  MYAI_SERVER_NAME,
  MYAI_WRAPPER_VERSION,
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
  ipcSocket: string;
  proxyPort: number;
}

interface SerializedRealServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

function stripMyAiEnv(env: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!key.startsWith('MYAI_')) {
      result[key] = value;
    }
  }
  return result;
}

export function isWrapped(entry: McpServerEntry): boolean {
  return Boolean(entry?.env?.[MYAI_IPC_SOCKET] || entry?.env?.[MYAI_REAL_URL]);
}

export function wrapEntry(entry: McpServerEntry, options: WrapOptions): McpServerEntry {
  const baseEnv = stripMyAiEnv(entry.env);
  const metadata: Record<string, string> = {
    [MYAI_SERVER_NAME]: options.serverName,
    [MYAI_CONFIG_PATH]: options.configPath,
    [MYAI_EXT_DIR]: options.extensionDir,
    [MYAI_WRAPPER_VERSION]: options.wrapperVersion,
  };

  if (entry.url) {
    return {
      ...entry,
      url: `http://127.0.0.1:${options.proxyPort}/${options.serverName}`,
      env: {
        ...baseEnv,
        ...metadata,
        [MYAI_REAL_URL]: entry.url,
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
    args: [options.wrapperPath, options.serverName],
    env: {
      ...baseEnv,
      ...metadata,
      [MYAI_IPC_SOCKET]: options.ipcSocket,
      [MYAI_REAL_SERVER]: JSON.stringify(serialized),
    },
  };
}

export function unwrapEntry(entry: McpServerEntry): McpServerEntry {
  const env = { ...(entry.env ?? {}) };

  if (env[MYAI_REAL_URL]) {
    const realUrl = env[MYAI_REAL_URL];
    const cleanEnv = stripMyAiEnv(env);
    const restored: McpServerEntry = {
      ...entry,
      url: realUrl,
    };

    if (Object.keys(cleanEnv).length > 0) {
      restored.env = cleanEnv;
    } else {
      delete restored.env;
    }

    return restored;
  }

  if (!env[MYAI_REAL_SERVER]) {
    return {
      ...entry,
      env: stripMyAiEnv(env),
    };
  }

  let parsed: SerializedRealServer | undefined;
  try {
    parsed = JSON.parse(env[MYAI_REAL_SERVER]) as SerializedRealServer;
  } catch {
    parsed = undefined;
  }

  const restoredEnv = {
    ...(parsed?.env ?? {}),
    ...stripMyAiEnv(env),
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
