"use strict";
(() => {
  // src/panel/webview/app.ts
  var vscode = acquireVsCodeApi();
  var ws = null;
  var proxyPort = null;
  var reconnectDelay = 1e3;
  var MAX_RECONNECT_DELAY = 1e4;
  var entries = /* @__PURE__ */ new Map();
  var logContainer = document.getElementById("log");
  var statusEl = document.getElementById("status");
  var clearBtn = document.getElementById("clearBtn");
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data.type === "init" && typeof data.proxyPort === "number") {
      const newPort = data.proxyPort;
      if (proxyPort !== newPort) {
        proxyPort = newPort;
        ws?.close();
      } else if (!ws || ws.readyState === WebSocket.CLOSED) {
        connect();
      }
      proxyPort = newPort;
      connect();
    }
  });
  vscode.postMessage({ type: "ready" });
  function setStatus(text) {
    statusEl.textContent = text;
  }
  function connect() {
    if (!proxyPort)
      return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
      return;
    ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/events`);
    ws.onopen = () => {
      reconnectDelay = 1e3;
      setStatus("");
    };
    ws.onmessage = (event) => {
      try {
        const mcpEvent = JSON.parse(event.data);
        handleEvent(mcpEvent);
      } catch {
      }
    };
    ws.onclose = () => {
      scheduleReconnect();
    };
    ws.onerror = () => {
      ws?.close();
    };
  }
  function scheduleReconnect() {
    setStatus("Disconnected \u2014 reconnecting\u2026");
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    setTimeout(connect, delay);
  }
  function isScrolledToBottom() {
    return logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 10;
  }
  function handleEvent(event) {
    const wasAtBottom = isScrolledToBottom();
    switch (event.type) {
      case "tool_call_started": {
        const entry = createStartedEntry(event);
        entries.set(event.id, entry);
        logContainer.appendChild(entry);
        break;
      }
      case "tool_call_completed": {
        const entry = entries.get(event.id);
        if (entry)
          updateCompleted(entry, event);
        break;
      }
      case "tool_call_failed": {
        const entry = entries.get(event.id);
        if (entry)
          updateFailed(entry, event);
        break;
      }
      case "session_cleared":
        clearLog();
        return;
    }
    if (wasAtBottom) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }
  function createStartedEntry(event) {
    const div = document.createElement("div");
    div.className = "entry in-progress";
    const header = document.createElement("div");
    header.className = "entry-header";
    const statusIcon = document.createElement("span");
    statusIcon.className = "entry-status spinner";
    statusIcon.textContent = "\u21BB";
    const nameEl = document.createElement("span");
    nameEl.className = "entry-name";
    nameEl.textContent = event.toolName ?? "(unknown)";
    const serverEl = document.createElement("span");
    serverEl.className = "entry-server";
    serverEl.textContent = event.serverName ?? "";
    header.appendChild(statusIcon);
    header.appendChild(nameEl);
    header.appendChild(serverEl);
    const details = document.createElement("div");
    details.className = "entry-details";
    if (event.arguments !== void 0) {
      details.appendChild(createDetailsSection("Arguments", event.arguments));
    }
    div.appendChild(header);
    div.appendChild(details);
    div.addEventListener("click", () => {
      details.classList.toggle("expanded");
    });
    return div;
  }
  function updateCompleted(entry, event) {
    entry.className = "entry completed";
    const header = entry.querySelector(".entry-header");
    const statusIcon = header.querySelector(".entry-status");
    statusIcon.className = "entry-status";
    statusIcon.textContent = "\u2713";
    const durationEl = document.createElement("span");
    durationEl.className = "entry-duration";
    durationEl.textContent = `${event.durationMs ?? 0}ms`;
    header.appendChild(durationEl);
    if (event.result !== void 0) {
      const details = entry.querySelector(".entry-details");
      details.appendChild(createDetailsSection("Result", event.result));
    }
  }
  function updateFailed(entry, event) {
    entry.className = "entry failed";
    const header = entry.querySelector(".entry-header");
    const statusIcon = header.querySelector(".entry-status");
    statusIcon.className = "entry-status";
    statusIcon.textContent = "\u2717";
    if (event.durationMs !== void 0) {
      const durationEl = document.createElement("span");
      durationEl.className = "entry-duration";
      durationEl.textContent = `${event.durationMs}ms`;
      header.appendChild(durationEl);
    }
    if (event.error) {
      const errorInline = document.createElement("div");
      errorInline.className = "entry-error-inline";
      errorInline.textContent = event.error;
      entry.insertBefore(errorInline, entry.querySelector(".entry-details"));
    }
    if (event.error) {
      const details = entry.querySelector(".entry-details");
      details.appendChild(createDetailsSection("Error", event.error));
    }
  }
  function createDetailsSection(label, value) {
    const section = document.createElement("div");
    section.className = "entry-details-section";
    const labelEl = document.createElement("div");
    labelEl.className = "entry-details-label";
    labelEl.textContent = label;
    const contentEl = document.createElement("pre");
    contentEl.className = "entry-details-content";
    contentEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    section.appendChild(labelEl);
    section.appendChild(contentEl);
    return section;
  }
  function clearLog() {
    logContainer.textContent = "";
    entries.clear();
  }
  clearBtn.addEventListener("click", () => {
    clearLog();
    vscode.postMessage({ type: "clearSession" });
  });
})();
//# sourceMappingURL=app.js.map
