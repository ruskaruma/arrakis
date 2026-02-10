import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from './logger';

const execFileAsync = promisify(execFile);

const CMD_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per command

async function kubectlExec(storeId: string, namespace: string, command: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync('kubectl', [
    'exec', `deploy/${storeId}-wordpress`,
    '-n', namespace,
    '--',
    ...command,
  ], { timeout: CMD_TIMEOUT_MS });
  if (stderr.trim()) {
    log.warn('kubectlExec.stderr', stderr.trim(), { storeId, command: command.join(' ') });
  }
  return stdout;
}

export async function verifyStore(storeId: string, namespace: string): Promise<boolean> {
  log.info('verify.start', 'Starting store verification', { storeId, namespace });

  // 1. HTTP health check
  try {
    const httpCode = await kubectlExec(storeId, namespace, [
      'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8080/',
    ]);
    if (httpCode.trim() !== '200') {
      log.warn('verify.http.fail', `HTTP check returned ${httpCode.trim()}`, { storeId });
      return false;
    }
    log.info('verify.http.ok', 'HTTP check passed', { storeId });
  } catch (err: any) {
    log.error('verify.http.error', `HTTP check failed: ${err.message}`, { storeId });
    return false;
  }

  // 2. Product count check
  try {
    const countStr = await kubectlExec(storeId, namespace, [
      'wp', 'wc', 'product', 'list', '--format=count', '--user=user', '--allow-root',
    ]);
    const count = parseInt(countStr.trim(), 10);
    if (isNaN(count) || count <= 0) {
      log.warn('verify.products.fail', `Product count: ${countStr.trim()}`, { storeId });
      return false;
    }
    log.info('verify.products.ok', `Product count: ${count}`, { storeId });
  } catch (err: any) {
    log.error('verify.products.error', `Product check failed: ${err.message}`, { storeId });
    return false;
  }

  log.info('verify.done', 'Store verification passed', { storeId });
  return true;
}
