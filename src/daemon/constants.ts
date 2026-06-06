import * as os from 'os';
import * as path from 'path';

const MCPEAVESDROP_DIR = path.join(os.homedir(), '.mcpEavesdrop');

export const DAEMON_SOCKET_PATH =
  process.platform === 'win32'
    ? String.raw`\\.\pipe\mcpEavesdrop-extension`
    : path.join(MCPEAVESDROP_DIR, 'ipc.sock');
