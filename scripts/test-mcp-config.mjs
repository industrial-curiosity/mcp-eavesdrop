#!/usr/bin/env node
import assert from 'assert/strict';
import os from 'os';
import path from 'path';

const m = await import('../dist/lib/mcp-config.js');

const home = '/tmp/myai-home';

assert.equal(
  m.resolveUserMcpConfigPath('vscode', 'darwin', home),
  path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
);
assert.equal(
  m.resolveUserMcpConfigPath('vscode', 'linux', home),
  path.join(home, '.config', 'Code', 'User', 'mcp.json'),
);
assert.equal(
  m.resolveUserMcpConfigPath('vscode', 'win32', home),
  path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'),
);
assert.equal(
  m.resolveUserMcpConfigPath('cursor', 'darwin', home),
  path.join(home, '.cursor', 'mcp.json'),
);
assert.equal(
  m.resolveUserMcpConfigPath('cursor', 'linux', home),
  path.join(home, '.cursor', 'mcp.json'),
);
assert.equal(
  m.resolveUserMcpConfigPath('cursor', 'win32', home),
  path.join(home, '.cursor', 'mcp.json'),
);

assert.equal(m.detectIde('Visual Studio Code').rootKey, 'servers');
assert.equal(m.detectIde('Cursor').rootKey, 'mcpServers');
assert.equal(m.detectIde('Unknown IDE').rootKey, 'servers');

const ws = '/tmp/myai-ws';
assert.deepEqual(m.resolveWorkspaceMcpConfigCandidates('cursor', ws), [
  path.join(ws, '.cursor', 'mcp.json'),
  path.join(ws, '.vscode', 'mcp.json'),
]);
assert.deepEqual(m.resolveWorkspaceMcpConfigCandidates('vscode', ws), [
  path.join(ws, '.vscode', 'mcp.json'),
  path.join(ws, '.cursor', 'mcp.json'),
]);
assert.deepEqual(m.listMcpConfigPaths('cursor', ws), [
  path.join(home, '.cursor', 'mcp.json'),
  path.join(ws, '.cursor', 'mcp.json'),
  path.join(ws, '.vscode', 'mcp.json'),
]);

console.log('PASS test-mcp-config');
