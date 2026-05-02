import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { McpToolEvent } from '../types';

/**
 * Manages a WebSocket server at /events and broadcasts McpToolEvent messages
 * to all connected clients.
 */
export class EventBroadcaster {
  private readonly clients = new Set<WebSocket>();
  private readonly wss: WebSocketServer;

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: '/events' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      process.stderr.write(`myai-proxy: WebSocket client connected (${this.clients.size} total)\n`);

      ws.on('close', () => {
        this.clients.delete(ws);
        process.stderr.write(`myai-proxy: WebSocket client disconnected (${this.clients.size} remaining)\n`);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(event: McpToolEvent): void {
    const json = JSON.stringify(event);
    process.stderr.write(`myai-proxy: broadcast ${event.type} to ${this.clients.size} client(s)\n`);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(json);
        } catch {
          // Client may have disconnected between the readyState check and send
          this.clients.delete(client);
        }
      }
    }
  }
}
