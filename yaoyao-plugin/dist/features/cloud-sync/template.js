/**
 * features/cloud-sync/template.ts — Cloud credentials template.
 */
export const TEMPLATE = `# 云备份凭证配置
# 取消注释并填写你要使用的服务

# --- WebDAV (坚果云/Nextcloud/ownCloud) ---
# WEBDAV_URL=https://dav.jianguoyun.com/dav/
# WEBDAV_USERNAME=email@example.com
# WEBDAV_PASSWORD=***

# --- S3/OSS ---
# S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
# S3_ACCESS_KEY=***
# S3_SECRET_KEY=***
# S3_BUCKET=bucket-name
# S3_REGION=auto

# --- SFTP ---
# SFTP_HOST=192.168.1.100
# SFTP_PORT=22
# SFTP_USERNAME=user
# SFTP_PASSWORD=***

# --- Samba/NAS ---
# SAMBA_HOST=192.168.10.216
# SAMBA_USER=user
# SAMBA_PASSWORD=***
# SAMBA_SHARE=共享名
# SAMBA_PORT=445
# SAMBA_REMOTE_PATH=/`;
