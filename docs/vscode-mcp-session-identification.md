# VS Code MCP Session Identification

How VS Code identifies which chat session initiated an MCP tool call, verified
against the VS Code source at
[`src/vs/workbench/contrib/mcp/common/mcpServer.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpServer.ts)
and
[`src/vs/workbench/contrib/mcp/common/mcpTypes.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpTypes.ts).

## How it works

VS Code builds a `_meta` object and includes it on every `tools/call` JSON-RPC
request sent to an MCP server. The three fields injected are:

| `_meta` field | Type | Description |
| :--- | :--- | :--- |
| `vscode.conversationId` | `string` | The chat session that triggered the call (derived from `chatSessionResource` URI via `chatSessionResourceToId`) |
| `vscode.requestId` | `string` | The individual request within that session |
| `traceparent` | `string` | W3C trace context header (MCP SEP-414) for distributed tracing correlation |

The internal interface (`IMcpToolCallContext` in `mcpTypes.ts`) that carries
this context before it is serialised to the wire:

```typescript
export interface IMcpToolCallContext {
  chatSessionResource: URI | undefined;
  chatRequestId?: string;
  traceparent?: string;
  tracestate?: string;
}
```

The injection in `mcpServer.ts` (simplified):

```typescript
const meta: Record<string, unknown> = { progressToken };

if (context?.chatSessionResource) {
  meta['vscode.conversationId'] = chatSessionResourceToId(context.chatSessionResource);
}
if (context?.chatRequestId) {
  meta['vscode.requestId'] = context.chatRequestId;
}
if (context?.traceparent) {
  meta['traceparent'] = context.traceparent;
  if (context.tracestate) {
    meta['tracestate'] = context.tracestate;
  }
}
```

## What the wrapper receives

The stdio wrapper (`src/proxy/stdio-wrapper.ts`) intercepts the raw JSON-RPC
stream. A `tools/call` message on the wire looks like:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "some_tool",
    "arguments": { ... },
    "_meta": {
      "progressToken": "...",
      "vscode.conversationId": "abc123",
      "vscode.requestId": "req-456",
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    }
  }
}
```

## How to capture session ID in the wrapper

`handleJsonRpc` currently reads `message.params.name` and
`message.params.arguments`. To attribute a tool call to a session, also read
`message.params._meta`:

```typescript
interface JsonRpcMessage {
  // existing fields ...
  params?: {
    name?: string;
    arguments?: unknown;
    _meta?: {
      'vscode.conversationId'?: string;
      'vscode.requestId'?: string;
      traceparent?: string;
    };
  };
}
```

Then pass `conversationId` and `requestId` through to the telemetry event and
on to the daemon so the monitoring panel can group and label calls by session.

## API access notes

`chatSessionResource` is an internal URI (schema `chat:/…`). The string form
returned by `chatSessionResourceToId` is what VS Code puts in
`vscode.conversationId`; use that string as the key.

The `onDidChangeActiveChatPanelSessionResource` window event and
`options.chatSessionResource` on `LanguageModelToolInvocationOptions` are both
gated behind the `chatParticipantPrivate` **proposed** API
(`enabledApiProposals` required). The `_meta` fields on the wire require no
special API access — they are always present when a call originates from a
chat session.
