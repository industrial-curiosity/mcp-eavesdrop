export interface Connection {
  instanceId: string;
  ide: string;
  workspace: string;
  workspaceSlug: string;
  connectedAt: number;
  lastHeartbeat: number;
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, Connection>();

  register(data: Omit<Connection, 'connectedAt' | 'lastHeartbeat'>): void {
    const existing = this.connections.get(data.instanceId);
    if (existing) {
      existing.lastHeartbeat = Date.now();
    } else {
      this.connections.set(data.instanceId, {
        ...data,
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
      });
    }
  }

  deregister(instanceId: string): boolean {
    return this.connections.delete(instanceId);
  }

  heartbeat(instanceId: string): boolean {
    const conn = this.connections.get(instanceId);
    if (!conn) return false;
    conn.lastHeartbeat = Date.now();
    return true;
  }

  getAll(): Connection[] {
    return [...this.connections.values()];
  }

  has(instanceId: string): boolean {
    return this.connections.has(instanceId);
  }

  size(): number {
    return this.connections.size;
  }

  /** Removes connections whose lastHeartbeat is older than maxAgeMs. Returns evicted instanceIds. */
  evictStale(maxAgeMs = 90_000): string[] {
    const cutoff = Date.now() - maxAgeMs;
    const evicted: string[] = [];
    for (const [id, conn] of this.connections) {
      if (conn.lastHeartbeat < cutoff) {
        this.connections.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }
}
