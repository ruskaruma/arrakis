import { spawn, ChildProcess } from 'child_process';
import { log } from './logger';

export class HelmManager {
  constructor(private chartPath: string, private valuesFile: string) {}

  async install(releaseName: string, namespace: string, sets: Record<string, string> = {}): Promise<void> {
    const args = [
      'upgrade', releaseName,
      this.chartPath,
      '--install',
      '--namespace', namespace,
      '--values', this.valuesFile,
      '--timeout', '10m',
      '--wait',
    ];

    for (const [key, value] of Object.entries(sets)) {
      args.push('--set', `${key}=${value}`);
    }

    return this.run('upgrade', args, releaseName);
  }

  async rollback(releaseName: string, namespace: string, revision?: number): Promise<void> {
    const args = [
      'rollback', releaseName,
      ...(revision !== undefined ? [String(revision)] : []),
      '--namespace', namespace,
      '--timeout', '5m',
    ];

    return this.run('rollback', args, releaseName);
  }

  async uninstall(releaseName: string, namespace: string): Promise<void> {
    return new Promise(resolve => {
      const proc = this.spawnHelm(['uninstall', releaseName, '--namespace', namespace]);
      let stderr = '';

      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('error', (err: Error) => {
        log.warn('helm.uninstall.spawn', `Spawn failed: ${err.message}`, { storeId: releaseName });
        resolve();
      });

      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          log.warn('helm.uninstall.warn', `Exit ${code}: ${stderr.trim()}`, { storeId: releaseName });
        }
        resolve();
      });
    });
  }

  async releaseExists(releaseName: string, namespace: string): Promise<boolean> {
    return new Promise(resolve => {
      const proc = this.spawnHelm(['status', releaseName, '--namespace', namespace]);
      proc.stdout?.resume();
      proc.stderr?.resume();
      proc.on('error', () => resolve(false));
      proc.on('close', (code: number | null) => resolve(code === 0));
    });
  }

  private spawnHelm(args: string[]): ChildProcess {
    return spawn('helm', args);
  }

  private run(op: string, args: string[], storeId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = this.spawnHelm(args);
      let stderr = '';

      proc.stdout?.on('data', (d: Buffer) => {
        log.info(`helm.${op}.out`, d.toString().trim(), { storeId });
      });

      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn helm: ${err.message}`));
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`helm ${op} failed (exit ${code}): ${stderr.trim()}`));
        }
      });
    });
  }
}
