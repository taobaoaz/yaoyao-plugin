/**
 * utils/cloud-adapter.ts — BARREL (re-exports for backward compat)
 *
 * Split into submodules:
 *   cloud-adapter/types.ts      → types
 *   cloud-adapter/webdav.ts     → WebDAV adapter
 *   cloud-adapter/s3.ts         → S3 adapter
 *   cloud-adapter/sftp.ts       → SFTP adapter
 *   cloud-adapter/samba.ts      → Samba adapter
 *   cloud-adapter/factory.ts    → createAdapters / createAdapter
 *
 * New code should import from the specific submodule.
 * This barrel preserves backward compatibility for cloud-sync/.
 */
export type {
  CloudFileEntry,
  CloudAdapter,
  AdapterStatus,
  AdapterFactoryOpts,
} from './cloud-adapter/types.ts';
export { escShellArg } from './cloud-adapter/types.ts';
export { WebDAVAdapter } from './cloud-adapter/webdav.ts';
export { S3Adapter } from './cloud-adapter/s3.ts';
export { SFTPAdapter } from './cloud-adapter/sftp.ts';
export { SambaAdapter } from './cloud-adapter/samba.ts';
export { createAdapters, createAdapter } from './cloud-adapter/factory.ts';
export type { AdapterFactoryResult } from './cloud-adapter/factory.ts';
