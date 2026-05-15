"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/mcp-wrap.ts
var mcp_wrap_exports = {};
__export(mcp_wrap_exports, {
  isWrapped: () => isWrapped,
  unwrapEntry: () => unwrapEntry,
  wrapEntry: () => wrapEntry
});
module.exports = __toCommonJS(mcp_wrap_exports);

// src/types/index.ts
var MYAI_IPC_SOCKET = "MYAI_IPC_SOCKET";
var MYAI_REAL_SERVER = "MYAI_REAL_SERVER";
var MYAI_REAL_URL = "MYAI_REAL_URL";
var MYAI_SERVER_NAME = "MYAI_SERVER_NAME";
var MYAI_CONFIG_PATH = "MYAI_CONFIG_PATH";
var MYAI_EXT_DIR = "MYAI_EXT_DIR";
var MYAI_WRAPPER_VERSION = "MYAI_WRAPPER_VERSION";

// src/mcp-wrap.ts
function stripMyAiEnv(env) {
  const result = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!key.startsWith("MYAI_")) {
      result[key] = value;
    }
  }
  return result;
}
function isWrapped(entry) {
  return Boolean(entry?.env?.[MYAI_IPC_SOCKET] || entry?.env?.[MYAI_REAL_URL]);
}
function wrapEntry(entry, options) {
  const baseEnv = stripMyAiEnv(entry.env);
  const metadata = {
    [MYAI_SERVER_NAME]: options.serverName,
    [MYAI_CONFIG_PATH]: options.configPath,
    [MYAI_EXT_DIR]: options.extensionDir,
    [MYAI_WRAPPER_VERSION]: options.wrapperVersion
  };
  if (entry.url) {
    return {
      ...entry,
      url: `http://127.0.0.1:${options.proxyPort}/${options.serverName}`,
      env: {
        ...baseEnv,
        ...metadata,
        [MYAI_REAL_URL]: entry.url
      }
    };
  }
  const serialized = {
    command: entry.command,
    args: [...entry.args ?? []],
    env: { ...baseEnv }
  };
  return {
    command: "node",
    args: [options.wrapperPath, options.serverName],
    env: {
      ...baseEnv,
      ...metadata,
      [MYAI_IPC_SOCKET]: options.ipcSocket,
      [MYAI_REAL_SERVER]: JSON.stringify(serialized)
    }
  };
}
function unwrapEntry(entry) {
  const env = { ...entry.env ?? {} };
  if (env[MYAI_REAL_URL]) {
    const realUrl = env[MYAI_REAL_URL];
    const cleanEnv = stripMyAiEnv(env);
    const restored2 = {
      ...entry,
      url: realUrl
    };
    if (Object.keys(cleanEnv).length > 0) {
      restored2.env = cleanEnv;
    } else {
      delete restored2.env;
    }
    return restored2;
  }
  if (!env[MYAI_REAL_SERVER]) {
    return {
      ...entry,
      env: stripMyAiEnv(env)
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(env[MYAI_REAL_SERVER]);
  } catch {
    parsed = void 0;
  }
  const restoredEnv = {
    ...parsed?.env ?? {},
    ...stripMyAiEnv(env)
  };
  const restored = {
    command: parsed?.command,
    args: [...parsed?.args ?? []]
  };
  if (Object.keys(restoredEnv).length > 0) {
    restored.env = restoredEnv;
  }
  return restored;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isWrapped,
  unwrapEntry,
  wrapEntry
});
//# sourceMappingURL=mcp-wrap.js.map
