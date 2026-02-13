import { podExec } from './kubectl';
import { log } from './logger';

export async function verifyStore(storeId: string, namespace: string): Promise<boolean> {
  log.info('verify.start', 'Starting store verification', { storeId });

  try {
    const httpCode = (await podExec(storeId, namespace, [
      'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8080/',
    ])).trim();
    if (httpCode !== '200') {
      log.warn('verify.http.fail', `HTTP check returned ${httpCode}`, { storeId });
      return false;
    }
  } catch (err: any) {
    log.error('verify.http.error', `HTTP check failed: ${err.message}`, { storeId });
    return false;
  }

  try {
    const count = parseInt((await podExec(storeId, namespace, [
      'wp', 'wc', 'product', 'list', '--format=count', '--user=user', '--allow-root',
    ])).trim(), 10);
    if (isNaN(count) || count <= 0) {
      log.warn('verify.products.fail', `Product count: ${count}`, { storeId });
      return false;
    }
  } catch (err: any) {
    log.error('verify.products.error', `Product check failed: ${err.message}`, { storeId });
    return false;
  }

  log.info('verify.done', 'Store verification passed', { storeId });
  return true;
}
