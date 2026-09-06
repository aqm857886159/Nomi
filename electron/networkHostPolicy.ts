import net from 'node:net';

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['3fff::', 20],
] as const) blocked.addSubnet(address, prefix, 'ipv6');

/**
 * Shared private/loopback classification for proxy bypass and hardened URL checks.
 *
 * Deliberately has NO escape hatch. The former `LAB_ALLOW_LOCALHOST=1` switch turned the whole
 * classifier off - loopback, RFC 1918 and the 169.254 cloud-metadata range together - from an
 * environment variable that shipped in production builds. Lab fixtures now name the exact origin
 * they need through `setLabTrustedPrivateOrigins`, which `main.ts` only ever calls on an
 * unpackaged build; see networkOutboundPolicy.ts.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '[::]' || host === '::') return true;
  const ipv6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIPv6(ipv6)) {
    return blocked.check(ipv6, 'ipv6');
  }
  if (!net.isIPv4(host)) return false;
  return blocked.check(host, 'ipv4');
}
