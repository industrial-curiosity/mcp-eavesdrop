#!/usr/bin/env node
import assert from 'assert/strict';

const m = await import('../dist/lib/mcp-wrap.js');

const options = {
  serverName: 'filesystem',
  wrapperPath: '/Users/test/.mcpEavesdrop/stdio-wrapper.js',
  configPath: '/Users/test/.cursor/mcp.json',
  extensionDir: '/Users/test/.vscode/extensions/industrial-curiosity.mcpEavesdrop',
  wrapperVersion: '1',
  ide: 'vscode',
  workspaceSlug: 'test-ws',
};

const stdioOriginal = {
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: {
    A: '1',
    B: '2',
  },
};

const wrappedStdio = m.wrapEntry(stdioOriginal, options);
assert.equal(wrappedStdio.command, 'node');
assert.equal(wrappedStdio.args[0], options.wrapperPath);
assert.ok(wrappedStdio.env.MCPEAVESDROP_REAL_SERVER, 'expected MCPEAVESDROP_REAL_SERVER to be set');
assert.equal(wrappedStdio.env.MCPEAVESDROP_IDE, options.ide);
assert.equal(wrappedStdio.env.MCPEAVESDROP_WORKSPACE_SLUG, options.workspaceSlug);
// MCPEAVESDROP_IPC_SOCKET is no longer injected — socket path is embedded in the deployed wrapper file
assert.equal(wrappedStdio.env.MCPEAVESDROP_IPC_SOCKET, undefined);

const restoredStdio = m.unwrapEntry(wrappedStdio);
assert.equal(restoredStdio.command, stdioOriginal.command);
assert.deepEqual(restoredStdio.args, stdioOriginal.args);
assert.equal(restoredStdio.env.A, '1');
assert.equal(restoredStdio.env.B, '2');

// HTTP entries are now wrapped as stdio (routed through the daemon TCP proxy via bridge mode)
const httpOriginal = {
  type: 'http',
  url: 'http://127.0.0.1:9000/mcp',
  env: {
    EXISTING: 'yes',
  },
};

const wrappedHttp = m.wrapEntry(httpOriginal, options);
// Wrapped HTTP becomes a stdio entry pointing to the wrapper, not a URL redirect
assert.equal(wrappedHttp.command, 'node');
assert.equal(wrappedHttp.args[0], options.wrapperPath);
assert.equal(wrappedHttp.env.MCPEAVESDROP_REAL_URL, httpOriginal.url);
assert.equal(wrappedHttp.url, undefined, 'wrapped HTTP entry should not retain a url field');

const restoredHttp = m.unwrapEntry(wrappedHttp);
assert.equal(restoredHttp.url, httpOriginal.url);
assert.equal(restoredHttp.env.EXISTING, 'yes');
assert.equal(restoredHttp.env.MCPEAVESDROP_REAL_URL, undefined);

console.log('PASS test-mcp-wrap');
