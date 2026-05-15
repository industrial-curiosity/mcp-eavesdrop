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

// src/mcp-config.ts
var mcp_config_exports = {};
__export(mcp_config_exports, {
  detectIde: () => detectIde,
  resolveRootKey: () => resolveRootKey,
  resolveUserMcpConfigForCurrentIde: () => resolveUserMcpConfigForCurrentIde,
  resolveUserMcpConfigPath: () => resolveUserMcpConfigPath
});
module.exports = __toCommonJS(mcp_config_exports);
var os = __toESM(require("os"));
var path = __toESM(require("path"));
function resolveRuntimeAppName() {
  try {
    const vscode = require("vscode");
    return vscode.env.appName;
  } catch {
    return "Visual Studio Code";
  }
}
function detectIde(appNameOverride) {
  const appName = appNameOverride ?? resolveRuntimeAppName();
  if (appName === "Cursor") {
    return {
      ide: "cursor",
      appName,
      rootKey: "mcpServers"
    };
  }
  return {
    ide: "vscode",
    appName,
    rootKey: "servers"
  };
}
function resolveUserMcpConfigPath(ide, platform = process.platform, homeDir = os.homedir()) {
  if (ide === "cursor") {
    if (platform === "win32") {
      return path.join(homeDir, ".cursor", "mcp.json");
    }
    return path.join(homeDir, ".cursor", "mcp.json");
  }
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, "Code", "User", "mcp.json");
    }
    return path.join(homeDir, "AppData", "Roaming", "Code", "User", "mcp.json");
  }
  return path.join(homeDir, ".config", "Code", "User", "mcp.json");
}
function resolveRootKey(ide) {
  return ide === "cursor" ? "mcpServers" : "servers";
}
function resolveUserMcpConfigForCurrentIde() {
  const ideConfig = detectIde();
  return {
    configPath: resolveUserMcpConfigPath(ideConfig.ide),
    ideConfig
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  detectIde,
  resolveRootKey,
  resolveUserMcpConfigForCurrentIde,
  resolveUserMcpConfigPath
});
//# sourceMappingURL=mcp-config.js.map
