import * as os from 'os';
import * as path from 'path';

const MYAI_DIR = path.join(os.homedir(), '.myai');

export const DAEMON_SOCKET_PATH =
  process.platform === 'win32'
    ? String.raw`\\.\pipe\myai-extension`
    : path.join(MYAI_DIR, 'ipc.sock');
