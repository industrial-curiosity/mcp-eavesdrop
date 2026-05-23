// Declare the VS Code WebView API global
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Mirror of src/types/events.ts — kept in sync manually
type McpEventType =
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'session_cleared'
  | 'connections_changed';

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
  ide?: string;
  workspaceSlug?: string;
}

interface Connection {
  instanceId: string;
  ide: string;
  workspace: string;
  workspaceSlug: string;
  connectedAt: number;
  lastHeartbeat: number;
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const vscode = acquireVsCodeApi();



/** Track live DOM entries by event id for in-place updates */
const entries = new Map<string, HTMLElement>();

const logContainer = document.getElementById('log') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const connectionsEl = document.getElementById('connections') as HTMLElement | null;

// Active filter: key = "ide/workspaceSlug", value = true (visible) | false (hidden)
const filterState = new Map<string, boolean>();
const FILTER_STORAGE_KEY = 'myai-filters';

function loadFilters(): void {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      for (const [k, v] of Object.entries(parsed)) filterState.set(k, v);
    }
  } catch { /* ignore */ }
}

function saveFilters(): void {
  try {
    const obj: Record<string, boolean> = {};
    for (const [k, v] of filterState) obj[k] = v;
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

function isVisible(event: McpToolEvent): boolean {
  if (filterState.size === 0) return true;
  const key = `${event.ide ?? ''}/${event.workspaceSlug ?? ''}`;
  // If a filter key for this connection is present and false, hide it
  const state = filterState.get(key);
  return state !== false;
}

loadFilters();

// ---------------------------------------------------------------------------
// Message bus — receive messages from the extension host
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as {
    type: string;
    events?: McpToolEvent[];
    event?: McpToolEvent;
    connected?: boolean;
    connections?: Connection[];
  };

  if (data.type === 'history' && Array.isArray(data.events)) {
    for (const evt of data.events) {
      if (isVisible(evt)) handleEvent(evt, true);
    }
  }

  if (data.type === 'event' && data.event) {
    if (isVisible(data.event)) handleEvent(data.event, false);
  }

  if (data.type === 'status') {
    setStatus(data.connected ? '' : 'Disconnected \u2014 reconnecting\u2026');
  }

  if (data.type === 'connections' && Array.isArray(data.connections)) {
    renderConnections(data.connections);
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
// Connections sidebar
// ---------------------------------------------------------------------------

function renderConnections(connections: Connection[]): void {
  if (!connectionsEl) return;
  connectionsEl.textContent = '';

  if (connections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'conn-empty';
    empty.textContent = 'No active connections';
    connectionsEl.appendChild(empty);
    return;
  }

  for (const conn of connections) {
    const key = `${conn.ide}/${conn.workspaceSlug}`;
    if (!filterState.has(key)) filterState.set(key, true);

    const row = document.createElement('div');
    row.className = 'conn-row';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = filterState.get(key) !== false;
    toggle.addEventListener('change', () => {
      filterState.set(key, toggle.checked);
      saveFilters();
      reapplyFilters();
    });

    const label = document.createElement('label');
    label.textContent = `${conn.ide}: ${conn.workspace}`;
    label.title = `${conn.ide} / ${conn.workspaceSlug}`;

    row.appendChild(toggle);
    row.appendChild(label);
    connectionsEl.appendChild(row);
  }
}

function reapplyFilters(): void {
  for (const [id, el] of entries) {
    const ideAttr = el.dataset['ide'] ?? '';
    const slugAttr = el.dataset['workspaceSlug'] ?? '';
    const key = `${ideAttr}/${slugAttr}`;
    el.style.display = filterState.get(key) === false ? 'none' : '';
  }
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

function handleEvent(event: McpToolEvent, isHistory: boolean): void {
  if (event.type === 'connections_changed') {
    return; // handled via connections endpoint; sidebar updates come from extension
  }

  const wasAtBottom = isScrolledToBottom();

  switch (event.type) {
    case 'tool_call_started': {
      const entry = createStartedEntry(event);
      entry.dataset['ide'] = event.ide ?? '';
      entry.dataset['workspaceSlug'] = event.workspaceSlug ?? '';
      if (!isVisible(event)) entry.style.display = 'none';
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
      if (!isHistory) clearLog();
      return;
  }

  if (!isHistory && wasAtBottom) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// Entry creation helpers
// ---------------------------------------------------------------------------

function createStartedEntry(event: McpToolEvent): HTMLElement {
  const div = document.createElement('div');
  div.className = 'entry in-progress';

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

  if (event.workspaceSlug) {
    const sourceEl = document.createElement('span');
    sourceEl.className = 'entry-source';
    sourceEl.textContent = `${event.ide ?? ''}:${event.workspaceSlug}`;
    header.appendChild(sourceEl);
  }

  header.appendChild(statusIcon);
  header.appendChild(nameEl);
  header.appendChild(serverEl);

  const details = document.createElement('div');
  details.className = 'entry-details';

  if (event.arguments !== undefined) {
    details.appendChild(createDetailsSection('Arguments', event.arguments));
  }

  div.appendChild(header);
  div.appendChild(details);

  div.addEventListener('click', () => details.classList.toggle('expanded'));

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
    errorInline.textContent = event.error;
    entry.insertBefore(errorInline, entry.querySelector('.entry-details'));

    const details = entry.querySelector('.entry-details') as HTMLElement;
    details.appendChild(createDetailsSection('Error', event.error));
  }
}

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
  logContainer.textContent = '';
  entries.clear();
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

clearBtn.addEventListener('click', () => {
  clearLog();
  vscode.postMessage({ type: 'clearSession' });
});

// Suppress unused warning for renderConnections — exported for potential future use
