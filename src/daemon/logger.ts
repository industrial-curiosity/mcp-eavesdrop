import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class EventLogger {
  private readonly logsDir: string;

  constructor(logsDir = path.join(os.homedir(), '.myai', 'logs')) {
    this.logsDir = logsDir;
  }

  append(event: Record<string, unknown>, ide: string, workspaceSlug: string): void {
    const ideDir = path.join(this.logsDir, ide);
    try {
      fs.mkdirSync(ideDir, { recursive: true });
      const logPath = path.join(ideDir, `${workspaceSlug}.jsonl`);
      fs.appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      process.stderr.write(`myai-daemon: logger write failed: ${String(err)}\n`);
    }
  }
}
