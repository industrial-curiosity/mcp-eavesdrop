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
  /** VS Code chat session ID — present when call originated from a chat session */
  conversationId?: string;
  /** VS Code chat request ID — future-proofed, captured but not displayed */
  requestId?: string;
  /** Full _meta object from the JSON-RPC request — preserved for observability */
  meta?: Record<string, unknown>;
}

interface Connection {
  instanceId: string;
  ide: string;
  workspace: string;
  workspaceSlug: string;
  connectedAt: number;
  lastHeartbeat: number;
}

interface SourceIdentity {
  ide: string;
  workspaceSlug: string;
  key: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const vscode = acquireVsCodeApi();



/** Track live DOM entries by event id for in-place updates */
const entries = new Map<string, HTMLElement>();

const logContainer = document.getElementById('log') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const connectionsEl = document.getElementById('connections');
const filterToolEl = document.getElementById('filterTool') as HTMLInputElement;
const filterServerEl = document.getElementById('filterServer') as HTMLSelectElement;
const filterStatusEl = document.getElementById('filterStatus') as HTMLSelectElement;
const filterTimeEl = document.getElementById('filterTime') as HTMLSelectElement;
const sortToggleEl = document.getElementById('sortToggle') as HTMLButtonElement;

type SortOrder = 'desc' | 'asc';
let sortOrder: SortOrder = 'desc';

// Active filter: key = "ide/workspaceSlug", value = true (visible) | false (hidden)
const filterState = new Map<string, boolean>();
const sourceIdentityByKey = new Map<string, SourceIdentity>();
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

function isTimeVisible(timestamp: number, timeFilter: string): boolean {
  if (!timeFilter) return true;
  if (!timestamp) return false;
  const now = Date.now();
  if (timeFilter === 'hour') return timestamp >= now - 60 * 60 * 1000;
  if (timeFilter === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return timestamp >= start.getTime();
  }
  return true;
}

function isVisible(event: McpToolEvent, entryEl?: HTMLElement): boolean {
  const source = normalizeSourceIdentity(event.ide, event.workspaceSlug);

  // IDE/workspace filter
  const key = source.key;
  if (filterState.get(key) === false) return false;

  // Tool name filter
  const toolFilter = filterToolEl.value.trim().toLowerCase();
  if (toolFilter && !(event.toolName ?? '').toLowerCase().includes(toolFilter)) return false;

  // Server name filter
  const serverFilter = filterServerEl.value;
  if (serverFilter && event.serverName !== serverFilter) return false;

  // Status filter (checked against entry DOM class when available, else new entries are in-progress)
  const statusFilter = filterStatusEl.value;
  if (statusFilter) {
    if (entryEl) {
      if (!entryEl.classList.contains(statusFilter)) return false;
    } else if (statusFilter !== 'in-progress') {
      return false;
    }
  }

  // Time range filter
  if (!isTimeVisible(event.timestamp, filterTimeEl.value)) return false;

  return true;
}

loadFilters();

// ---------------------------------------------------------------------------
// Message bus — receive messages from the extension host
// ---------------------------------------------------------------------------

type WebviewHostMessage = {
  type: string;
  events?: McpToolEvent[];
  event?: McpToolEvent;
  connected?: boolean;
  connections?: Connection[];
};

function handleHistoryMessage(events: McpToolEvent[]): void {
  for (const evt of events) {
    if (evt?.type === 'tool_call_started' && entries.has(evt.id)) continue;
    handleEvent(evt, true);
  }
  reapplyFilters();
}

function handleEventMessage(evt: McpToolEvent): void {
  handleEvent(evt, false);
  reapplyFilters();
}

function handleHostMessage(data: WebviewHostMessage): void {
  if (data.type === 'history' && Array.isArray(data.events)) {
    handleHistoryMessage(data.events);
    return;
  }

  if (data.type === 'event' && data.event) {
    handleEventMessage(data.event);
    return;
  }

  if (data.type === 'status') {
    setStatus(data.connected ? '' : 'Disconnected \u2014 reconnecting\u2026');
    return;
  }

  if (data.type === 'connections' && Array.isArray(data.connections)) {
    renderConnections(data.connections);
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (typeof event.origin === 'string' && !event.origin.startsWith('vscode-webview://')) {
    return;
  }

  handleHostMessage(event.data as WebviewHostMessage);
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
  for (const conn of connections) {
    registerSourceIdentity({
      ide: conn.ide,
      workspaceSlug: conn.workspaceSlug,
      label: `${conn.ide}: ${conn.workspace}`,
    });
  }

  renderSourceFilters();
}

function normalizeSourceIdentity(ide?: string, workspaceSlug?: string): SourceIdentity {
  const rawIde = (ide ?? '').trim();
  const rawWorkspace = (workspaceSlug ?? '').trim();
  const unknownSource =
    (!rawIde && !rawWorkspace) ||
    (rawIde.toLowerCase() === 'unknown' && rawWorkspace.toLowerCase() === 'unknown');

  if (unknownSource) {
    return {
      ide: 'test',
      workspaceSlug: 'mock',
      key: 'test/mock',
      label: 'test:mock',
    };
  }

  const normalizedIde = rawIde || 'unknown';
  const normalizedWorkspace = rawWorkspace || 'unknown';
  return {
    ide: normalizedIde,
    workspaceSlug: normalizedWorkspace,
    key: `${normalizedIde}/${normalizedWorkspace}`,
    label: `${normalizedIde}:${normalizedWorkspace}`,
  };
}

function registerSourceIdentity(source: { ide?: string; workspaceSlug?: string; label?: string }): SourceIdentity {
  const normalized = normalizeSourceIdentity(source.ide, source.workspaceSlug);
  if (!sourceIdentityByKey.has(normalized.key)) {
    sourceIdentityByKey.set(normalized.key, {
      ...normalized,
      label: source.label?.trim() || normalized.label,
    });
  }
  if (!filterState.has(normalized.key)) {
    filterState.set(normalized.key, true);
  }
  return sourceIdentityByKey.get(normalized.key) ?? normalized;
}

function renderSourceFilters(): void {
  if (!connectionsEl) return;
  connectionsEl.textContent = '';

  const sources = Array.from(sourceIdentityByKey.values())
    .sort((a, b) => a.label.localeCompare(b.label));

  if (sources.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'conn-empty';
    empty.textContent = 'No active connections';
    connectionsEl.appendChild(empty);
    return;
  }

  for (const source of sources) {
    const row = document.createElement('div');
    row.className = 'conn-row';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = filterState.get(source.key) !== false;
    toggle.addEventListener('change', () => {
      filterState.set(source.key, toggle.checked);
      saveFilters();
      reapplyFilters();
    });

    const label = document.createElement('label');
    label.textContent = source.label;
    label.title = `${source.ide} / ${source.workspaceSlug}`;

    row.appendChild(toggle);
    row.appendChild(label);
    connectionsEl.appendChild(row);
  }
}

function addServerOption(serverName: string): void {
  if (!serverName) return;
  for (const option of filterServerEl.options) {
    if (option.value === serverName) return;
  }
  const opt = document.createElement('option');
  opt.value = serverName;
  opt.textContent = serverName;
  filterServerEl.appendChild(opt);
}

function reapplyFilters(): void {
  const toolFilter = filterToolEl.value.trim().toLowerCase();
  const serverFilter = filterServerEl.value;
  const statusFilter = filterStatusEl.value;
  const timeFilter = filterTimeEl.value;

  for (const [, el] of entries) {
    const key = `${el.dataset['ide'] ?? ''}/${el.dataset['workspaceSlug'] ?? ''}`;
    const ideVisible = filterState.get(key) !== false;
    const toolName = (el.dataset['toolName'] ?? '').toLowerCase();
    const toolVisible = !toolFilter || toolName.includes(toolFilter);
    const serverName = el.dataset['serverName'] ?? '';
    const serverVisible = !serverFilter || serverName === serverFilter;
    const statusVisible = !statusFilter || el.classList.contains(statusFilter);
    const timestamp = Number(el.dataset['timestamp'] ?? '0');
    const timeVisible = isTimeVisible(timestamp, timeFilter);
    el.style.display = (ideVisible && toolVisible && serverVisible && statusVisible && timeVisible) ? '' : 'none';
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

function insertEntry(entry: HTMLElement): void {
  if (sortOrder === 'desc') {
    logContainer.prepend(entry);
    return;
  }
  logContainer.appendChild(entry);
}

function updateSortToggleLabel(): void {
  sortToggleEl.textContent = sortOrder === 'desc' ? '\u2193 Newest first' : '\u2191 Oldest first';
}

function reorderEntriesInDom(): void {
  const sortedEntries = Array.from(entries.values()).sort((a, b) => {
    const ta = Number(a.dataset['timestamp'] ?? '0');
    const tb = Number(b.dataset['timestamp'] ?? '0');
    return sortOrder === 'desc' ? tb - ta : ta - tb;
  });

  const previousScrollTop = logContainer.scrollTop;
  for (const entry of sortedEntries) {
    logContainer.appendChild(entry);
  }
  logContainer.scrollTop = previousScrollTop;
}

// ---------------------------------------------------------------------------
// Event rendering
// ---------------------------------------------------------------------------

function handleEvent(event: McpToolEvent, isHistory: boolean): void {
  if (event.type === 'connections_changed') {
    return; // handled via connections endpoint; sidebar updates come from extension
  }

  registerSourceIdentity({ ide: event.ide, workspaceSlug: event.workspaceSlug });
  renderSourceFilters();

  const wasAtBottom = isScrolledToBottom();

  switch (event.type) {
    case 'tool_call_started': {
      if (entries.has(event.id)) {
        break;
      }
      const source = normalizeSourceIdentity(event.ide, event.workspaceSlug);
      const entry = createStartedEntry(event);
      entry.dataset['ide'] = source.ide;
      entry.dataset['workspaceSlug'] = source.workspaceSlug;
      entry.dataset['toolName'] = event.toolName ?? '';
      entry.dataset['serverName'] = event.serverName ?? '';
      entry.dataset['timestamp'] = String(event.timestamp);
      if (event.serverName) addServerOption(event.serverName);
      if (!isVisible(event)) entry.style.display = 'none';
      entries.set(event.id, entry);
      insertEntry(entry);
      break;
    }
    case 'tool_call_completed':
    case 'tool_call_failed': {
      const entry = entries.get(event.id) ?? createSyntheticEntryForTerminalEvent(event);
      if (event.type === 'tool_call_completed') {
        updateCompleted(entry, event);
      } else {
        updateFailed(entry, event);
      }
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
  const source = registerSourceIdentity({ ide: event.ide, workspaceSlug: event.workspaceSlug });

  const div = document.createElement('div');
  div.className = 'entry in-progress';

  const header = document.createElement('div');
  header.className = 'entry-header';

  const statusIcon = document.createElement('span');
  statusIcon.className = 'entry-status spinner';
  statusIcon.textContent = '\u21bb'; // ↻

  const timestampEl = document.createElement('span');
  timestampEl.className = 'entry-timestamp';
  timestampEl.textContent = formatTimestamp(event.timestamp);

  const nameEl = document.createElement('span');
  nameEl.className = 'entry-name';
  nameEl.textContent = event.toolName ?? '(unknown)';

  const serverEl = document.createElement('span');
  serverEl.className = 'entry-server';
  serverEl.textContent = event.serverName ?? '';

  header.appendChild(timestampEl);
  header.appendChild(statusIcon);
  header.appendChild(nameEl);
  header.appendChild(serverEl);

  const sourceEl = document.createElement('span');
  sourceEl.className = 'entry-source';
  sourceEl.textContent = source.label;
  header.appendChild(sourceEl);

  const details = document.createElement('div');
  details.className = 'entry-details';

  if (event.arguments !== undefined) {
    details.appendChild(createDetailsSection('Arguments', event.arguments));
  }

  if (event.meta && Object.keys(event.meta).length > 0) {
    details.appendChild(createDetailsSection('Meta', event.meta));
  }

  div.appendChild(header);
  div.appendChild(details);

  div.addEventListener('click', () => details.classList.toggle('expanded'));

  return div;
}

function createSyntheticEntryForTerminalEvent(event: McpToolEvent): HTMLElement {
  const source = normalizeSourceIdentity(event.ide, event.workspaceSlug);
  const syntheticStart: McpToolEvent = {
    id: event.id,
    type: 'tool_call_started',
    timestamp: event.timestamp,
    toolName: event.toolName,
    serverName: event.serverName,
    ide: source.ide,
    workspaceSlug: source.workspaceSlug,
  };
  const entry = createStartedEntry(syntheticStart);
  entry.dataset['ide'] = source.ide;
  entry.dataset['workspaceSlug'] = source.workspaceSlug;
  entry.dataset['toolName'] = event.toolName ?? '';
  entry.dataset['serverName'] = event.serverName ?? '';
  entry.dataset['timestamp'] = String(event.timestamp);
  if (event.serverName) addServerOption(event.serverName);
  entries.set(event.id, entry);
  insertEntry(entry);
  return entry;
}

function updateCompleted(entry: HTMLElement, event: McpToolEvent): void {
  entry.className = 'entry completed';

  const header = entry.querySelector('.entry-header') as HTMLElement;
  const statusIcon = header.querySelector('.entry-status') as HTMLElement;
  statusIcon.className = 'entry-status';
  statusIcon.textContent = '\u2713'; // ✓

  const existingDuration = header.querySelector('.entry-duration');
  if (existingDuration) existingDuration.remove();

  const durationEl = document.createElement('span');
  durationEl.className = 'entry-duration';
  durationEl.textContent = `${event.durationMs ?? 0}ms`;
  header.appendChild(durationEl);

  const details = entry.querySelector('.entry-details') as HTMLElement;

  if (event.result !== undefined) {
    upsertDetailsSection(details, 'Result', event.result);
  }
  if (event.meta && Object.keys(event.meta).length > 0) {
    upsertDetailsSection(details, 'Meta', event.meta);
  }
  reapplyFilters();
}

function updateFailed(entry: HTMLElement, event: McpToolEvent): void {
  entry.className = 'entry failed';

  const header = entry.querySelector('.entry-header') as HTMLElement;
  const statusIcon = header.querySelector('.entry-status') as HTMLElement;
  statusIcon.className = 'entry-status';
  statusIcon.textContent = '\u2717'; // ✗

  if (event.durationMs !== undefined) {
    const existingDuration = header.querySelector('.entry-duration');
    if (existingDuration) existingDuration.remove();

    const durationEl = document.createElement('span');
    durationEl.className = 'entry-duration';
    durationEl.textContent = `${event.durationMs}ms`;
    header.appendChild(durationEl);
  }

  const details = entry.querySelector('.entry-details') as HTMLElement;

  if (event.error) {
    const existingInlineError = entry.querySelector('.entry-error-inline');
    if (existingInlineError) existingInlineError.remove();

    const errorInline = document.createElement('div');
    errorInline.className = 'entry-error-inline';
    errorInline.textContent = event.error;
    entry.insertBefore(errorInline, entry.querySelector('.entry-details'));

    upsertDetailsSection(details, 'Error', event.error);
  }

  if (event.meta && Object.keys(event.meta).length > 0) {
    upsertDetailsSection(details, 'Meta', event.meta);
  }
  reapplyFilters();
}

function createDetailsSection(label: string, value: unknown): HTMLElement {
  const section = document.createElement('div');
  section.className = 'entry-details-section';
  section.dataset['sectionLabel'] = label.toLowerCase();

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

function upsertDetailsSection(details: HTMLElement, label: string, value: unknown): void {
  const key = label.toLowerCase();
  const existing = details.querySelector(`.entry-details-section[data-section-label="${key}"]`);
  const replacement = createDetailsSection(label, value);
  if (existing) {
    existing.replaceWith(replacement);
    return;
  }
  details.appendChild(replacement);
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '----/--/-- --:--:--';
  const date = new Date(timestamp);
  const yyyy = String(date.getFullYear());
  const mmDate = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mmTime = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mmDate}/${dd} ${hh}:${mmTime}:${ss}`;
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

refreshBtn.addEventListener('click', () => {
  clearLog();
  sourceIdentityByKey.clear();
  renderSourceFilters();
  vscode.postMessage({ type: 'requestInitialData' });
});

let reloadDebounceTimer: ReturnType<typeof setTimeout> | undefined;
function postRequestHistory(): void {
  vscode.postMessage({ type: 'requestHistory' });
}

filterToolEl.addEventListener('input', () => {
  reapplyFilters();
  clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(postRequestHistory, 300);
});
filterServerEl.addEventListener('change', () => { reapplyFilters(); postRequestHistory(); });
filterStatusEl.addEventListener('change', () => { reapplyFilters(); postRequestHistory(); });
filterTimeEl.addEventListener('change', () => { reapplyFilters(); postRequestHistory(); });
sortToggleEl.addEventListener('click', () => {
  sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
  updateSortToggleLabel();
  reorderEntriesInDom();
});

updateSortToggleLabel();

// Suppress unused warning for renderConnections — exported for potential future use
