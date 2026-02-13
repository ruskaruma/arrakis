import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from './logger';

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 120_000;

export async function podExec(storeId: string, namespace: string, command: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('kubectl', [
    'exec', `deploy/${storeId}-wordpress`, '-n', namespace, '--', ...command,
  ], { timeout: EXEC_TIMEOUT_MS });
  if (stderr.trim()) {
    log.warn('kubectl.stderr', stderr.trim(), { storeId, command: command.join(' ') });
  }
  return stdout;
}
