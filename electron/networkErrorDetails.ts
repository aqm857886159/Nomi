import { redactDeep } from './events/redact.js';

const NETWORK_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Inspect causes, not SDK-specific error classes. Never stringify arbitrary error objects. */
export function networkFailureDetails(error: unknown): { code?: string; message: string } | undefined {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  let fallback: string | undefined;
  for (let index = 0; index < pending.length && index < 12; index += 1) {
    const current = pending[index];
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    // Diagnostics must never replace the original failure, including unusual getters.
    try {
      const value = current as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
      const message = typeof value.message === 'string' ? value.message : '';
      const code = typeof value.code === 'string' ? value.code : undefined;
      if (code && (NETWORK_CODES.has(code) || /^(ERR_TLS_|ERR_SSL_)[A-Z_]+$/.test(code))) {
        return { code, message: `${code}: ${message || 'Network request failed'}` };
      }
      if (/fetch failed|network request failed/i.test(message) || value.name === 'TimeoutError') fallback ??= message;
      if (value.cause) pending.push(value.cause);
      if (Array.isArray(value.errors)) pending.push(...value.errors.slice(0, Math.max(0, 12 - pending.length)));
    } catch { /* Keep inspecting the other bounded causes, then rethrow at the caller. */ }
  }
  return fallback ? { message: fallback } : undefined;
}

/** A diagnostic endpoint never includes URL credentials, query parameters or fragments. */
export function safeNetworkUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch { return '[network address]'; }
}

/** Strip URL credentials and known secrets BEFORE truncation, shared by Agent and vendor HTTP. */
export function redactNetworkMessage(message: string, secrets: readonly string[] = [], maximumLength = 8192): string {
  const endpointsOnly = message.replace(/\b(?:https?|socks5h?):\/\/[^\s"'<>]+/gi, safeNetworkUrl);
  return redactDeep(endpointsOnly, [...secrets].sort((left, right) => right.length - left.length)).slice(0, maximumLength);
}
