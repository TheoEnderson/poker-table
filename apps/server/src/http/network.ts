import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { NetworkInfo, NetworkAddress } from '@poker-table/protocol';

export function isVirtualInterface(name: string): boolean {
  return /^(docker|br-|veth|virbr|vboxnet|vmnet)/i.test(name);
}

function interfacePriority(name: string): number {
  if (/^(wl|wifi)/i.test(name)) return 0; // Wi-Fi first
  if (/^(eth|en)/i.test(name)) return 1;  // Ethernet second
  if (!isVirtualInterface(name)) return 2; // Other physical interfaces
  return 3;                              // Virtual interfaces
}

export function networkInfo(port: number, interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces()): NetworkInfo {
  const seen = new Set<string>();
  const physicalAddresses: NetworkAddress[] = [];
  const virtualAddresses: NetworkAddress[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const item of entries ?? []) {
      if (item.family !== 'IPv4' || item.internal || seen.has(item.address)) continue;
      seen.add(item.address);
      const isVirtual = isVirtualInterface(name);
      const entry: NetworkAddress = { name, address: item.address, url: `http://${item.address}:${port}`, isVirtual };
      if (isVirtual) {
        virtualAddresses.push(entry);
      } else {
        physicalAddresses.push(entry);
      }
    }
  }

  // Prioriza interfaces físicas (Wi-Fi/Ethernet) e exclui bridges virtuais como Docker.
  // Caso só existam interfaces virtuais (ex.: container isolado de testes), usa como fallback.
  const candidateList = physicalAddresses.length > 0 ? physicalAddresses : virtualAddresses;

  const sorted = candidateList.sort((a, b) => {
    const pA = interfacePriority(a.name);
    const pB = interfacePriority(b.name);
    if (pA !== pB) return pA - pB;
    return a.name.localeCompare(b.name);
  });

  return { port, addresses: sorted };
}

export function formatNetworkBanner(port: number, info: NetworkInfo = networkInfo(port)): string[] {
  const lines: string[] = [
    `Notebook (local): http://localhost:${port}`,
  ];
  const physical = info.addresses.filter(a => !a.isVirtual);
  const virtual = info.addresses.filter(a => a.isVirtual);

  if (physical.length > 0) {
    for (const address of physical) {
      const label = /^(wl|wifi)/i.test(address.name) ? 'Wi-Fi' : 'Rede local';
      lines.push(`Celulares (${label} / ${address.name}): ${address.url}`);
    }
  } else {
    lines.push('Nenhuma interface Wi-Fi/Ethernet detectada para conexão de celulares.');
    if (virtual.length > 0) {
      for (const address of virtual) {
        lines.push(`Interface virtual (${address.name} - desenvolvimento/local): ${address.url} (normalmente inacessível para celulares)`);
      }
    }
    lines.push('Conecte o notebook à rede Wi-Fi da partida para que os celulares possam entrar.');
  }

  return lines;
}

export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // Native/test clients still need session credentials.
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}
