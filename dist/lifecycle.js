"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lifecycle.ts
var lifecycle_exports = {};
__export(lifecycle_exports, {
  resolveAllMcpConfigPaths: () => resolveAllMcpConfigPaths
});
module.exports = __toCommonJS(lifecycle_exports);
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));

// src/types/index.ts
var MYAI_REAL_SERVER = "MYAI_REAL_SERVER";
var MYAI_REAL_URL = "MYAI_REAL_URL";

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

// src/lifecycle.ts
function resolveAllMcpConfigPaths(platform = process.platform, homeDir = os.homedir()) {
  const paths = /* @__PURE__ */ new Set();
  if (platform === "darwin") {
    paths.add(path.join(homeDir, "Library", "Application Support", "Code", "User", "mcp.json"));
  } else if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      paths.add(path.join(appData, "Code", "User", "mcp.json"));
    } else {
      paths.add(path.join(homeDir, "AppData", "Roaming", "Code", "User", "mcp.json"));
    }
  } else {
    paths.add(path.join(homeDir, ".config", "Code", "User", "mcp.json"));
  }
  if (platform === "win32") {
    paths.add(path.join(homeDir, ".cursor", "mcp.json"));
  } else {
    paths.add(path.join(homeDir, ".cursor", "mcp.json"));
  }
  return [...paths];
}
function restoreRoot(root, rootKey, filePath) {
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
    process.stdout.write(`restored ${serverName} in ${filePath} (${rootKey})
`);
  }
  return restored;
}
function processConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    process.stdout.write(`skip missing ${filePath}
`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    process.stdout.write(`skip unreadable ${filePath}
`);
    return;
  }
  const restoredCount = restoreRoot(parsed.servers, "servers", filePath) + restoreRoot(parsed.mcpServers, "mcpServers", filePath);
  if (restoredCount > 0) {
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}
`, "utf8");
  } else {
    process.stdout.write(`no wrapped entries in ${filePath}
`);
  }
}
function removeMyAiDir(homeDir = os.homedir()) {
  const myAiDir = path.join(homeDir, ".myai");
  fs.rmSync(myAiDir, { recursive: true, force: true });
  process.stdout.write(`removed ${myAiDir}
`);
}
function run() {
  for (const configPath of resolveAllMcpConfigPaths()) {
    processConfig(configPath);
  }
  removeMyAiDir();
}
if (require.main === module) {
  run();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  resolveAllMcpConfigPaths
});
//# sourceMappingURL=lifecycle.js.map
