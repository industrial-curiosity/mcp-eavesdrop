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

// src/wrapper-deploy.ts
var wrapper_deploy_exports = {};
__export(wrapper_deploy_exports, {
  deployWrapper: () => deployWrapper,
  readWrapperVersionFromContent: () => readWrapperVersionFromContent,
  resolveStableWrapperPath: () => resolveStableWrapperPath
});
module.exports = __toCommonJS(wrapper_deploy_exports);
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var VERSION_PATTERN = /^\/\/\s*MYAI_WRAPPER_VERSION=(.+)$/m;
function resolveStableWrapperPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".myai", "stdio-wrapper.js");
}
function readWrapperVersionFromContent(content) {
  const match = content.match(VERSION_PATTERN);
  return match?.[1]?.trim();
}
function deployWrapper(context) {
  const bundledPath = context.asAbsolutePath(path.join("dist", "proxy", "stdio-wrapper.js"));
  const stablePath = resolveStableWrapperPath();
  const stableDir = path.dirname(stablePath);
  const bundledContent = fs.readFileSync(bundledPath, "utf8");
  const bundledVersion = readWrapperVersionFromContent(bundledContent) ?? "unknown";
  fs.mkdirSync(stableDir, { recursive: true });
  let shouldCopy = true;
  if (fs.existsSync(stablePath)) {
    const existingContent = fs.readFileSync(stablePath, "utf8");
    const existingVersion = readWrapperVersionFromContent(existingContent);
    shouldCopy = existingVersion !== bundledVersion;
  }
  if (shouldCopy) {
    fs.writeFileSync(stablePath, bundledContent, "utf8");
  }
  return {
    deployedPath: stablePath,
    deployed: shouldCopy,
    version: bundledVersion
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deployWrapper,
  readWrapperVersionFromContent,
  resolveStableWrapperPath
});
//# sourceMappingURL=wrapper-deploy.js.map
