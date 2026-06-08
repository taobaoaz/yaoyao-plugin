/**
 * Security utilities — mask sensitive fields from logged objects.
 * Prevents API keys, passwords, and tokens from leaking into log files.
 */
const SENSITIVE_KEYS = new Set([
    'apiKey',
    'api_key',
    'apikey',
    'api-secret',
    'secret',
    'password',
    'passwd',
    'pass',
    'token',
    'auth_token',
    'accessKey',
    'secretKey',
    'privateKey',
    'key',
    'SSHPASS',
    'bearer',
]);
function isSensitiveKey(key) {
    const lower = key.toLowerCase();
    for (const sk of SENSITIVE_KEYS) {
        if (lower.includes(sk.toLowerCase()))
            return true;
    }
    return false;
}
/** Deep-clone an object while masking sensitive string values */
export function maskSensitive(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj === 'string') {
        // If the string itself looks like a key (long hex/base64), mask it
        if (obj.length > 24 && /^[A-Za-z0-9+/=_-]+$/.test(obj)) {
            return (obj.slice(0, 4) + '***' + obj.slice(-4));
        }
        return obj;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean')
        return obj;
    if (Array.isArray(obj)) {
        return obj.map(maskSensitive);
    }
    if (typeof obj === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            if (isSensitiveKey(k) && typeof v === 'string') {
                result[k] = v.length > 8 ? `${v.slice(0, 3)}***${v.slice(-3)}` : '***';
            }
            else {
                result[k] = maskSensitive(v);
            }
        }
        return result;
    }
    return obj;
}
/** Mask an Authorization header value */
export function maskAuthHeader(header) {
    if (!header)
        return header;
    if (header.toLowerCase().startsWith('bearer ')) {
        const token = header.slice(7);
        return `Bearer ${token.length > 8 ? token.slice(0, 3) + '***' + token.slice(-3) : '***'}`;
    }
    return '***';
}
