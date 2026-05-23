#!/usr/bin/env node
/**
 * Stops a running myai daemon before extension debug (F5).
 * Replaces a noisy stderr-connected daemon with a fresh quiet one on next activate.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SOCKET = path.join(os.homedir(), '.myai', 'ipc.sock');

function post(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCKET, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(SOCKET)) {
    return;
  }
  try {
    await post('/shutdown');
  } catch {
    // Daemon already gone or socket stale.
  }
}

main().catch((err) => {
  console.error('[dev-stop-daemon]', err);
  process.exit(1);
});
