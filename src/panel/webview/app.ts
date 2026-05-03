// Declare the VS Code WebView API global
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Mirror of src/types/events.ts — kept in sync manually
// (Cannot import at runtime in a bundled webview IIFE that ships without
// the extension host's module graph)
type McpEventType =
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'session_cleared';

interface McpToolEvent {
  id: string;
  type: McpEventType;
  toolName?: string;
  serverName?: string;
  timestamp: number;
  arguments?: unknown;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const vscode = acquireVsCodeApi();

let ws: WebSocket | null = null;
let proxyPort: number | null = null;
let reconnectDelay = 1_000; // ms
const MAX_RECONNECT_DELAY = 10_000;

/** Track live DOM entries by event id for in-place updates */
const entries = new Map<string, HTMLElement>();

const logContainer = document.getElementById('log') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

// ---------------------------------------------------------------------------
// Message bus — receive messages from the extension host
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { type: string; proxyPort?: number };

  if (data.type === 'init' && typeof data.proxyPort === 'number') {
    const newPort = data.proxyPort;
    if (proxyPort !== newPort) {
      // Port changed (e.g. proxy restarted) — reconnect
      proxyPort = newPort;
      ws?.close();
    } else if (!ws || ws.readyState === WebSocket.CLOSED) {
      connect();
    }
    proxyPort = newPort;
    connect();
  }
});

// Signal to the extension host that the WebView has loaded
vscode.postMessage({ type: 'ready' });

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function setStatus(text: string): void {
  statusEl.textContent = text;
}

// ---------------------------------------------------------------------------
// WebSocket connection with exponential-backoff reconnect
// ---------------------------------------------------------------------------

function connect(): void {
  if (!proxyPort) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/events`);

  ws.onopen = () => {
    reconnectDelay = 1_000;
    setStatus('');
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const mcpEvent = JSON.parse(event.data as string) as McpToolEvent;
      handleEvent(mcpEvent);
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose fires after onerror; just close cleanly
    ws?.close();
  };
}

function scheduleReconnect(): void {
  setStatus('Disconnected — reconnecting\u2026');
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  setTimeout(connect, delay);
}

// ---------------------------------------------------------------------------
// Scroll helper
// ---------------------------------------------------------------------------

function isScrolledToBottom(): boolean {
  return (
    logContainer.scrollHeight - logContainer.scrollTop <=
    logContainer.clientHeight + 10
  );
}

// ---------------------------------------------------------------------------
// Event rendering
// ---------------------------------------------------------------------------

function handleEvent(event: McpToolEvent): void {
  const wasAtBottom = isScrolledToBottom();

  switch (event.type) {
    case 'tool_call_started': {
      const entry = createStartedEntry(event);
      entries.set(event.id, entry);
      logContainer.appendChild(entry);
      break;
    }
    case 'tool_call_completed': {
      const entry = entries.get(event.id);
      if (entry) updateCompleted(entry, event);
      break;
    }
    case 'tool_call_failed': {
      const entry = entries.get(event.id);
      if (entry) updateFailed(entry, event);
      break;
    }
    case 'session_cleared':
      clearLog();
      return; // don't auto-scroll after a clear
  }

  if (wasAtBottom) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// Entry creation helpers
// ---------------------------------------------------------------------------

function createStartedEntry(event: McpToolEvent): HTMLElement {
  const div = document.createElement('div');
  div.className = 'entry in-progress';

  // Header row
  const header = document.createElement('div');
  header.className = 'entry-header';

  const statusIcon = document.createElement('span');
  statusIcon.className = 'entry-status spinner';
  statusIcon.textContent = '\u21bb'; // ↻

  const nameEl = document.createElement('span');
  nameEl.className = 'entry-name';
  nameEl.textContent = event.toolName ?? '(unknown)';

  const serverEl = document.createElement('span');
  serverEl.className = 'entry-server';
  serverEl.textContent = event.serverName ?? '';

  header.appendChild(statusIcon);
  header.appendChild(nameEl);
  header.appendChild(serverEl);

  // Expandable details
  const details = document.createElement('div');
  details.className = 'entry-details';

  if (event.arguments !== undefined) {
    details.appendChild(createDetailsSection('Arguments', event.arguments));
  }

  div.appendChild(header);
  div.appendChild(details);

  // Toggle expand on click
  div.addEventListener('click', () => {
    details.classList.toggle('expanded');
  });

  return div;
}

function updateCompleted(entry: HTMLElement, event: McpToolEvent): void {
  entry.className = 'entry completed';

  const header = entry.querySelector('.entry-header') as HTMLElement;
  const statusIcon = header.querySelector('.entry-status') as HTMLElement;
  statusIcon.className = 'entry-status';
  statusIcon.textContent = '\u2713'; // ✓

  const durationEl = document.createElement('span');
  durationEl.className = 'entry-duration';
  durationEl.textContent = `${event.durationMs ?? 0}ms`;
  header.appendChild(durationEl);

  if (event.result !== undefined) {
    const details = entry.querySelector('.entry-details') as HTMLElement;
    details.appendChild(createDetailsSection('Result', event.result));
  }
}

function updateFailed(entry: HTMLElement, event: McpToolEvent): void {
  entry.className = 'entry failed';

  const header = entry.querySelector('.entry-header') as HTMLElement;
  const statusIcon = header.querySelector('.entry-status') as HTMLElement;
  statusIcon.className = 'entry-status';
  statusIcon.textContent = '\u2717'; // ✗

  if (event.durationMs !== undefined) {
    const durationEl = document.createElement('span');
    durationEl.className = 'entry-duration';
    durationEl.textContent = `${event.durationMs}ms`;
    header.appendChild(durationEl);
  }

  if (event.error) {
    const errorInline = document.createElement('div');
    errorInline.className = 'entry-error-inline';
    errorInline.textContent = event.error; // textContent — no innerHTML
    entry.insertBefore(errorInline, entry.querySelector('.entry-details'));
  }

  if (event.error) {
    const details = entry.querySelector('.entry-details') as HTMLElement;
    details.appendChild(createDetailsSection('Error', event.error));
  }
}

/** Build a label + pre-formatted content block. Uses textContent — never innerHTML. */
function createDetailsSection(label: string, value: unknown): HTMLElement {
  const section = document.createElement('div');
  section.className = 'entry-details-section';

  const labelEl = document.createElement('div');
  labelEl.className = 'entry-details-label';
  labelEl.textContent = label;

  const contentEl = document.createElement('pre');
  contentEl.className = 'entry-details-content';
  contentEl.textContent =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);

  section.appendChild(labelEl);
  section.appendChild(contentEl);
  return section;
}

// ---------------------------------------------------------------------------
// Clear log
// ---------------------------------------------------------------------------

function clearLog(): void {
  logContainer.textContent = ''; // clears all child nodes safely
  entries.clear();
}

// ---------------------------------------------------------------------------
// Clear button
// ---------------------------------------------------------------------------

clearBtn.addEventListener('click', () => {
  clearLog();
  vscode.postMessage({ type: 'clearSession' });
});
