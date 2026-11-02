import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { NetworkInfo, NetworkAddress } from '@poker-table/protocol';

export function isCellularInterface(name: string): boolean {
  return /^(rmnet|ccmni|pdp|wwan|radio)/i.test(name);
}

export function isLoopbackAddress(ip?: string | null): boolean {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function isVirtualInterface(name: string): boolean {
  return /^(docker|br-|veth|virbr|vboxnet|vmnet|dummy)/i.test(name);
}

function interfacePriority(name: string): number {
  if (name.includes('selecionada') || name.includes('hotspot') || name.startsWith('hotspot') || name.startsWith('manual')) return -1; // Override manual tem prioridade máxima
  if (/^(ap|softap|swlan)/i.test(name)) return 0;                      // Hotspot SoftAP dedicado primeiro
  if (/^(wl|wifi)/i.test(name)) return 1;                              // Wi-Fi segundo
  if (/^(eth|en|rndis)/i.test(name)) return 2;                         // Ethernet / USB tethering terceiro
  if (!isVirtualInterface(name) && !isCellularInterface(name)) return 3; // Outras interfaces físicas de LAN
  return 4;                                                           // Interfaces virtuais ou dados móveis
}

let currentDynamicTarget: string | undefined = undefined;

export function setDynamicTarget(target?: string): void {
  currentDynamicTarget = target?.trim() || undefined;
}

export function getDynamicTarget(): string | undefined {
  const envTarget = (process.env.LAN_IP ?? process.env.HOST_IP ?? process.env.LAN_INTERFACE)?.trim();
  return currentDynamicTarget ?? (envTarget ? envTarget : undefined);
}

export function networkInfo(
  port: number,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
  manualTarget?: string,
): NetworkInfo {
  const seen = new Set<string>();
  const physicalAddresses: NetworkAddress[] = [];
  const virtualAddresses: NetworkAddress[] = [];

  const configuredTarget = (manualTarget ?? getDynamicTarget())?.trim();
  const isTargetIp = configuredTarget ? /^(\d{1,3}\.){3}\d{1,3}$/.test(configuredTarget) : false;

  let targetMatched = false;

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const item of entries ?? []) {
      if (item.family !== 'IPv4' || item.internal || seen.has(item.address)) continue;
      seen.add(item.address);
      const isVirtual = isVirtualInterface(name) || isCellularInterface(name);

      const isSelectedTarget = !isVirtual && Boolean(configuredTarget) && (
        (isTargetIp && item.address === configuredTarget) ||
        (!isTargetIp && name.toLowerCase() === configuredTarget?.toLowerCase())
      );

      if (isSelectedTarget) {
        targetMatched = true;
      }

      const isHotspotName = /^(ap|softap|swlan)/i.test(name) || name.toLowerCase().includes('hotspot') || (configuredTarget?.toLowerCase().includes('hotspot') === true);
      const displayName = isSelectedTarget
        ? (isHotspotName ? `${name} (hotspot)` : `${name} (selecionada)`)
        : name;

      const entry: NetworkAddress = {
        name: displayName,
        address: item.address,
        url: `http://${item.address}:${port}`,
        isVirtual,
      };

      if (isVirtual) {
        virtualAddresses.push(entry);
      } else {
        physicalAddresses.push(entry);
      }
    }
  }

  // Se um IP específico foi configurado mas não foi encontrado nas interfaces (ex.: interface oculta do Android), adiciona diretamente
  if (configuredTarget && isTargetIp && !targetMatched && !seen.has(configuredTarget)) {
    physicalAddresses.unshift({
      name: 'hotspot/manual',
      address: configuredTarget,
      url: `http://${configuredTarget}:${port}`,
      isVirtual: false,
    });
  }

  // Prioriza interfaces físicas (Wi-Fi/Hotspot/Ethernet) e exclui bridges virtuais como Docker.
  // Caso só existam interfaces virtuais (ex.: container isolado de testes), usa como fallback.
  const candidateList = physicalAddresses.length > 0 ? physicalAddresses : virtualAddresses;

  const sorted = candidateList.sort((a, b) => {
    const isTargetA = a.name.includes('(selecionada)') || a.name.includes('(hotspot)') || a.name.startsWith('hotspot') || a.name.startsWith('manual');
    const isTargetB = b.name.includes('(selecionada)') || b.name.includes('(hotspot)') || b.name.startsWith('hotspot') || b.name.startsWith('manual');
    if (isTargetA !== isTargetB) return isTargetA ? -1 : 1;

    const pA = interfacePriority(a.name);
    const pB = interfacePriority(b.name);
    if (pA !== pB) return pA - pB;
    return a.name.localeCompare(b.name);
  });

  return { port, addresses: sorted };
}

export function formatNetworkBanner(port: number, info: NetworkInfo = networkInfo(port)): string[] {
  const hostLabel = process.env.TERMUX_VERSION ? 'Celular anfitrião (local)' : 'Notebook (local)';
  const lines: string[] = [
    `${hostLabel}: http://localhost:${port}`,
  ];
  const physical = info.addresses.filter(a => !a.isVirtual);
  const virtual = info.addresses.filter(a => a.isVirtual);

  if (physical.length > 0) {
    for (const address of physical) {
      const isHotspot = address.name.includes('hotspot') || /^(ap|softap|swlan)/i.test(address.name);
      const isWifi = /^(wl|wifi)/i.test(address.name);
      const label = isHotspot
        ? 'Hotspot'
        : isWifi
          ? 'Wi-Fi'
          : 'Rede local';
      lines.push(`Celulares (${label} / ${address.name}): ${address.url}`);
    }
    if (physical.length > 1) {
      lines.push('Dica: Múltiplas redes detectadas. Para fixar a interface do hotspot:');
      lines.push('  LAN_IP=<IP_OU_INTERFACE> ./termux-start.sh');
    }
  } else {
    lines.push('Nenhuma interface Wi-Fi/Ethernet detectada para conexão de celulares.');
    if (virtual.length > 0) {
      for (const address of virtual) {
        const desc = isCellularInterface(address.name) ? 'dados móveis' : 'desenvolvimento/local';
        lines.push(`Interface virtual (${address.name} - ${desc}): ${address.url} (normalmente inacessível para celulares)`);
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
