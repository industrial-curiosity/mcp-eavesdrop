"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/proxy/stdio-wrapper.ts
var fs = __toESM(require("fs"));
var http = __toESM(require("http"));
var net = __toESM(require("net"));
var import_child_process = require("child_process");
var crypto = __toESM(require("crypto"));

// src/types/index.ts
var MYAI_IPC_SOCKET = "MYAI_IPC_SOCKET";
var MYAI_REAL_SERVER = "MYAI_REAL_SERVER";
var MYAI_REAL_URL = "MYAI_REAL_URL";
var MYAI_SERVER_NAME = "MYAI_SERVER_NAME";
var MYAI_CONFIG_PATH = "MYAI_CONFIG_PATH";
var MYAI_EXT_DIR = "MYAI_EXT_DIR";

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

// src/proxy/stdio-wrapper.ts
function getEnv(name) {
  return process.env[name];
}
function parseRealServer() {
  const raw = getEnv(MYAI_REAL_SERVER);
  if (!raw) {
    throw new Error(`${MYAI_REAL_SERVER} is missing`);
  }
  const parsed = JSON.parse(raw);
  if (!parsed.command) {
    throw new Error(`Missing real server command in ${MYAI_REAL_SERVER}`);
  }
  return {
    command: parsed.command,
    args: [...parsed.args ?? []],
    env: { ...parsed.env ?? {} }
  };
}
function toTelemetryPath(socketPath) {
  if (socketPath.startsWith("\\\\.\\pipe\\")) {
    return {
      socketPath,
      path: "/internal/telemetry",
      method: "POST",
      timeout: 500,
      headers: {
        "content-type": "application/json"
      }
    };
  }
  return {
    socketPath,
    path: "/internal/telemetry",
    method: "POST",
    timeout: 500,
    headers: {
      "content-type": "application/json"
    }
  };
}
function postTelemetry(socketPath, event) {
  try {
    const payload = JSON.stringify(event);
    const options = toTelemetryPath(socketPath);
    const request2 = http.request(options, (response) => {
      response.resume();
    });
    request2.on("error", (error) => {
      process.stderr.write(`myai-wrapper: telemetry failed: ${error.message}
`);
    });
    request2.setTimeout(500, () => {
      request2.destroy(new Error("telemetry timeout"));
    });
    request2.write(payload);
    request2.end();
  } catch (error) {
    process.stderr.write(`myai-wrapper: telemetry threw: ${String(error)}
`);
  }
}
function checkIpcReachable(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(400);
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
}
function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function selfHealConfig() {
  const configPath = getEnv(MYAI_CONFIG_PATH);
  const serverName = getEnv(MYAI_SERVER_NAME);
  if (!configPath || !serverName) {
    return;
  }
  const config = readJsonFile(configPath);
  if (!config) {
    return;
  }
  const possibleRoots = ["servers", "mcpServers"];
  for (const rootKey of possibleRoots) {
    const root = config[rootKey];
    if (!root || typeof root !== "object") {
      continue;
    }
    const entry = root[serverName];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    root[serverName] = unwrapEntry(entry);
    try {
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
    } catch (error) {
      process.stderr.write(`myai-wrapper: self-heal write failed: ${String(error)}
`);
    }
    return;
  }
}
function spawnRealWithInheritedStdio() {
  let real;
  try {
    real = parseRealServer();
  } catch (error) {
    process.stderr.write(`myai-wrapper: ${String(error)}
`);
    process.exit(1);
    return;
  }
  const child = (0, import_child_process.spawn)(real.command, real.args, {
    env: {
      ...process.env,
      ...real.env
    },
    stdio: "inherit"
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    process.stderr.write(`myai-wrapper: failed to spawn real server: ${error.message}
`);
    process.exit(1);
  });
}
function parseLengthPrefixedFrames(buffer) {
  const messages = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const separator = buffer.indexOf("\r\n\r\n", cursor, "utf8");
    if (separator === -1) {
      break;
    }
    const header = buffer.slice(cursor, separator).toString("utf8");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      break;
    }
    const contentLength = Number.parseInt(match[1], 10);
    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      break;
    }
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    try {
      messages.push(JSON.parse(body));
    } catch {
    }
    cursor = bodyEnd;
  }
  return {
    messages,
    rest: buffer.slice(cursor)
  };
}
function parseNewlineDelimited(buffer) {
  const messages = [];
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return { messages, rest };
}
async function main() {
  const extensionDir = getEnv(MYAI_EXT_DIR);
  if (extensionDir && !fs.existsSync(extensionDir)) {
    selfHealConfig();
    spawnRealWithInheritedStdio();
    return;
  }
  let real;
  try {
    real = parseRealServer();
  } catch (error) {
    process.stderr.write(`myai-wrapper: ${String(error)}
`);
    process.exit(1);
    return;
  }
  const socketPath = getEnv(MYAI_IPC_SOCKET);
  let telemetryEnabled = false;
  if (socketPath) {
    telemetryEnabled = await checkIpcReachable(socketPath);
    if (!telemetryEnabled) {
      process.stderr.write("myai-wrapper: proxy IPC unavailable, running passthrough mode\n");
    }
  }
  const child = (0, import_child_process.spawn)(real.command, real.args, {
    env: {
      ...process.env,
      ...real.env
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const trackedCalls = /* @__PURE__ */ new Map();
  const serverName = getEnv(MYAI_SERVER_NAME);
  let framedRemainder = Buffer.alloc(0);
  let ndjsonRemainder = "";
  let requestFramedRemainder = Buffer.alloc(0);
  let requestNdjsonRemainder = "";
  process.stdin.on("data", (chunk) => {
    child.stdin.write(chunk);
    if (!telemetryEnabled || !socketPath) {
      return;
    }
    const framedRequest = parseLengthPrefixedFrames(Buffer.concat([requestFramedRemainder, chunk]));
    requestFramedRemainder = framedRequest.rest;
    for (const message of framedRequest.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName);
    }
    const ndjsonRequest = parseNewlineDelimited(requestNdjsonRemainder + chunk.toString("utf8"));
    requestNdjsonRemainder = ndjsonRequest.rest;
    for (const message of ndjsonRequest.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName);
    }
  });
  child.stdout.on("data", (chunk) => {
    if (!telemetryEnabled || !socketPath) {
      return;
    }
    const framedBuffer = Buffer.concat([framedRemainder, chunk]);
    const framed = parseLengthPrefixedFrames(framedBuffer);
    framedRemainder = framed.rest;
    for (const message of framed.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName);
    }
    const ndjson = parseNewlineDelimited(ndjsonRemainder + chunk.toString("utf8"));
    ndjsonRemainder = ndjson.rest;
    for (const message of ndjson.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName);
    }
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
  process.stdin.on("end", () => {
    child.stdin.end();
    child.kill("SIGTERM");
    process.exit(0);
  });
  child.on("error", (error) => {
    process.stderr.write(`myai-wrapper: child process error: ${error.message}
`);
    process.exit(1);
  });
}
function handleJsonRpc(message, trackedCalls, socketPath, serverName) {
  const now = Date.now();
  if (message.method === "tools/call") {
    const requestId = message.id;
    const eventId = crypto.randomUUID();
    postTelemetry(socketPath, {
      id: eventId,
      type: "tool_call_started",
      timestamp: now,
      toolName: message.params?.name,
      serverName,
      arguments: message.params?.arguments
    });
    if (requestId !== void 0 && requestId !== null) {
      trackedCalls.set(String(requestId), {
        eventId,
        toolName: message.params?.name,
        startedAt: now
      });
    }
    return;
  }
  if (message.id === void 0 || message.id === null) {
    return;
  }
  const tracked = trackedCalls.get(String(message.id));
  if (!tracked) {
    return;
  }
  trackedCalls.delete(String(message.id));
  if (message.error !== void 0) {
    postTelemetry(socketPath, {
      id: tracked.eventId,
      type: "tool_call_failed",
      timestamp: now,
      toolName: tracked.toolName,
      serverName,
      error: JSON.stringify(message.error),
      durationMs: now - tracked.startedAt
    });
    return;
  }
  postTelemetry(socketPath, {
    id: tracked.eventId,
    type: "tool_call_completed",
    timestamp: now,
    toolName: tracked.toolName,
    serverName,
    result: message.result,
    durationMs: now - tracked.startedAt
  });
}
main().catch((error) => {
  process.stderr.write(`myai-wrapper: fatal error: ${String(error)}
`);
  process.exit(1);
});
//# sourceMappingURL=stdio-wrapper.js.map
