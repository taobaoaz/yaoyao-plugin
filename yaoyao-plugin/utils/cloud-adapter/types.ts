/**
 * utils/cloud-adapter/types.ts — Cloud adapter types.
 */
export interface CloudFileEntry {
  name: string;
  size: number;
  modified: number; // ms epoch
}

export interface CloudAdapter {
  readonly provider: string;
  upload(localPath: string, remotePath: string): Promise<boolean>;
  download(remotePath: string, localPath: string): Promise<boolean>;
  list(remotePath?: string): Promise<CloudFileEntry[]>;
  delete(remotePath: string): Promise<boolean>;
  exists(remotePath: string): Promise<boolean>;
}

export interface AdapterStatus {
  provider: string;
  configured: boolean;
  message: string;
}

export interface AdapterFactoryOpts {
  timeoutMs?: number;
  smbTimeoutMs?: number;
  mountCheckTimeoutMs?: number;
  mountTimeoutMs?: number;
}

/** Samba / Windows CMD argument sanitizer — strips shell metacharacters */
export function escShellArg(s: string): string {
  return s.replace(/[&|^$%`;]/g, '').replace(/"/g, '""');
}
