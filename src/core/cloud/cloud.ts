/**
 * core/cloud/cloud.ts — Pure cloud sync formatting + state logic, zero platform awareness.
 */

export interface SyncResult {
  provider: string;
  action: string;
  uploaded: string[];
  downloaded: string[];
  skipped: string[];
  errors: string[];
}

export interface AdapterStatus {
  provider: string;
  configured: boolean;
  message: string;
}

export interface SyncState {
  lastSync: number;
  uploaded: string[];
  downloaded: string[];
}

export function formatSyncResult(r: SyncResult): string {
  if (!r || typeof r !== "object") throw new TypeError("formatSyncResult: r must be an object");
  const lines: string[] = [
    `☁️ 云同步结果 [${r.provider}] [${r.action}]`,
    "",
  ];
  if (r.uploaded.length) lines.push(`📤 上传: ${r.uploaded.join(", ")}`);
  if (r.downloaded.length) lines.push(`📥 下载: ${r.downloaded.join(", ")}`);
  if (r.skipped.length) lines.push(`⏭️ 跳过: ${r.skipped.join(", ")}`);
  if (r.errors.length) lines.push(`❌ 失败: ${r.errors.join(", ")}`);
  const total = r.uploaded.length + r.downloaded.length;
  lines.push("", `共处理 ${total} 个文件`);
  return lines.join("\n");
}

export function formatStatus(statuses: AdapterStatus[]): string {
  if (!Array.isArray(statuses)) throw new TypeError("formatStatus: statuses must be an array");
  const lines: string[] = ["☁️ 云备份服务状态\n"];
  const configured = statuses.filter(s => s.configured);
  const notConfigured = statuses.filter(s => !s.configured);

  if (configured.length === 0) {
    lines.push("⚠️ 未检测到任何云服务配置");
    lines.push("");
    lines.push("配置方法：编辑 ~/.openclaw/credentials/secrets.env");
    lines.push("然后使用 configure 操作进行设置");
  } else {
    lines.push("✅ 已配置的服务：\n");
    for (const s of configured) {
      lines.push(`  ${s.message} ${s.provider.toUpperCase()}`);
    }
  }

  if (notConfigured.length > 0) {
    lines.push("\n📋 未配置的服务：\n");
    for (const s of notConfigured) {
      lines.push(`  ${s.message} ${s.provider.toUpperCase()}`);
    }
  }

  return lines.join("\n");
}
