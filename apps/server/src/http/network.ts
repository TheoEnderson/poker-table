import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { NetworkInfo } from '@poker-table/protocol';

export function networkInfo(port: number, interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces()): NetworkInfo {
  const seen = new Set<string>();
  const addresses: NetworkInfo['addresses'] = [];
  for (const [name, entries] of Object.entries(interfaces)) for (const item of entries ?? []) {
    if (item.family !== 'IPv4' || item.internal || seen.has(item.address)) continue;
    seen.add(item.address);
    addresses.push({ name, address: item.address, url: `http://${item.address}:${port}` });
  }
  return { port, addresses: addresses.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // Native/test clients still need session credentials.
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.host === host; }
  catch { return false; }
}
