#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpEavesdrop-lifecycle-test-'));
const fakeHome = path.join(tmp, 'home');
fs.mkdirSync(fakeHome, { recursive: true });

function vscodePath(homeDir) {
  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  }
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json');
  }
  return path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
}

const vscodeConfigPath = vscodePath(fakeHome);
const cursorConfigPath = path.join(fakeHome, '.cursor', 'mcp.json');

const wrappedEntry = {
  command: 'node',
  args: ['/tmp/wrapper.js', 'mock'],
  env: {
    MCPEAVESDROP_IPC_SOCKET: '/tmp/mcpEavesdrop.sock',
    MCPEAVESDROP_REAL_SERVER: JSON.stringify({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { KEEP: '1' },
    }),
    KEEP: '1',
  },
};

for (const filePath of [vscodeConfigPath, cursorConfigPath]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ servers: { mock: wrappedEntry }, mcpServers: { mock: wrappedEntry } }, null, 2),
    'utf8',
  );
}

const mcpEavesdropDir = path.join(fakeHome, '.mcpEavesdrop');
fs.mkdirSync(mcpEavesdropDir, { recursive: true });
fs.writeFileSync(path.join(mcpEavesdropDir, 'stdio-wrapper.js'), '// wrapper', 'utf8');

const result = spawnSync('node', ['dist/lifecycle.js'], {
  cwd: path.join(process.cwd()),
  env: {
    ...process.env,
    HOME: fakeHome,
  },
  encoding: 'utf8',
});

assert.equal(result.status, 0, `lifecycle failed: ${result.stderr}`);

const restoredVsCode = JSON.parse(fs.readFileSync(vscodeConfigPath, 'utf8'));
const restoredCursor = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf8'));

assert.equal(restoredVsCode.servers.mock.command, 'npx');
assert.equal(restoredCursor.servers.mock.command, 'npx');
assert.equal(fs.existsSync(mcpEavesdropDir), false);

console.log('PASS test-lifecycle');
