export type McpEventType =
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'session_cleared';

export interface McpToolEvent {
  /** Unique identifier for correlating started/completed/failed events */
  id: string;
  type: McpEventType;
  toolName?: string;
  serverName?: string;
  timestamp: number;
  /** Arguments passed to the tool (truncated to 10KB) */
  arguments?: unknown;
  /** Result returned by the tool (truncated to 10KB) */
  result?: unknown;
  /** Error message if the call failed */
  error?: string;
  /** Duration in milliseconds (present on completed/failed events) */
  durationMs?: number;
}
