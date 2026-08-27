import net from 'node:net';

/** Shared private/loopback classification for proxy bypass and hardened URL checks. */
export function isPrivateHost(hostname: string): boolean {
  // Existing lab-only escape hatch for local HTTP fixtures. Never set in production.
  if (process.env.LAB_ALLOW_LOCALHOST === '1') return false;
  const host = hostname.toLowerCase().trim();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '[::]' || host === '::') return true;
  const ipv6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIPv6(ipv6)) {
    const lower = ipv6.toLowerCase();
    return lower === '::1' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  // DNS rebinding protection is outside this existing literal-host policy.
  if (!net.isIPv4(host)) return false;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
