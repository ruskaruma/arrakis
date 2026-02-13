import { spawn, ChildProcess } from 'child_process';
import { log } from './logger';

export interface HelmRevision {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export class HelmManager {
  constructor(private chartPath: string, private valuesFile: string) {}

  async install(releaseName: string, namespace: string, sets: Record<string, string> = {}): Promise<void> {
    return this.upgrade(releaseName, namespace, sets, true);
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

  async upgrade(releaseName: string, namespace: string, sets: Record<string, string> = {}, install = false): Promise<void> {
    const args = [
      'upgrade', releaseName,
      this.chartPath,
      ...(install ? ['--install'] : []),
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

  async history(releaseName: string, namespace: string): Promise<HelmRevision[]> {
    return new Promise((resolve) => {
      const proc = this.spawnHelm(['history', releaseName, '--namespace', namespace, '-o', 'json', '--max', '20']);
      let stdout = '';
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.resume();
      proc.on('error', () => resolve([]));
      proc.on('close', (code: number | null) => {
        if (code !== 0) { resolve([]); return; }
        try {
          const parsed: HelmRevision[] = JSON.parse(stdout);
          resolve(parsed.map((r) => ({
            revision: r.revision,
            updated: r.updated,
            status: r.status,
            chart: r.chart,
            app_version: r.app_version,
            description: r.description,
          })));
        } catch {
          resolve([]);
        }
      });
    });
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

  async releaseStatus(releaseName: string, namespace: string): Promise<{ status: string; revision: number } | null> {
    return new Promise(resolve => {
      const proc = this.spawnHelm(['status', releaseName, '--namespace', namespace, '-o', 'json']);
      let stdout = '';
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.resume();
      proc.on('error', () => resolve(null));
      proc.on('close', (code: number | null) => {
        if (code !== 0) { resolve(null); return; }
        try {
          const parsed = JSON.parse(stdout);
          resolve({
            status: parsed.info?.status || 'unknown',
            revision: parsed.version || 1,
          });
        } catch {
          resolve(null);
        }
      });
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
