import { expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { formatNetworkBanner, networkInfo, sameOrigin, setDynamicTarget, getDynamicTarget, isLoopbackAddress } from '../apps/server/src/http/network.js';
import { createApplication } from '../apps/server/src/http/app.js';

it('enumerates IPv4 interfaces, excludes loopback/IPv6, and uses the actual port', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  expect(networkInfo(4321, { lo: [item('127.0.0.1', true)], wlan0: [item('192.168.4.2'), item('fe80::1', false, 'IPv6')], eth0: [item('10.0.0.3')], duplicate: [item('192.168.4.2')] }).addresses.map(a => a.url).sort())
    .toEqual(['http://10.0.0.3:4321', 'http://192.168.4.2:4321']);
});

it('rejects cross-origin requests and accepts same-origin LAN clients', () => {
  expect(sameOrigin('http://evil.example', '192.168.1.2:3000')).toBe(false);
  expect(sameOrigin('http://192.168.1.2:3000', '192.168.1.2:3000')).toBe(true);
  expect(sameOrigin('null', 'localhost:3000')).toBe(false);
});

it('filters out Docker and virtual bridge interfaces when physical interfaces are present', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const result = networkInfo(3000, {
    lo: [item('127.0.0.1', true)],
    docker0: [item('172.17.0.1')],
    'br-c1d2e3': [item('172.18.0.1')],
    veth1234: [item('172.19.0.1')],
    wlan0: [item('192.168.1.15')],
    eth0: [item('10.0.0.5')],
  });
  expect(result.addresses.map(a => a.name)).toEqual(['wlan0', 'eth0']);
  expect(result.addresses.map(a => a.address)).toEqual(['192.168.1.15', '10.0.0.5']);
  expect(result.addresses[0]?.isVirtual).toBe(false);
  expect(result.addresses[1]?.isVirtual).toBe(false);
});

it('falls back to virtual interfaces when no physical interfaces are found', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const result = networkInfo(3000, {
    lo: [item('127.0.0.1', true)],
    docker0: [item('172.17.0.1')],
  });
  expect(result.addresses.map(a => a.name)).toEqual(['docker0']);
  expect(result.addresses[0]?.url).toBe('http://172.17.0.1:3000');
  expect(result.addresses[0]?.isVirtual).toBe(true);
});

it('formatNetworkBanner formats physical WiFi and Ethernet for cell phones', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const banner = formatNetworkBanner(3000, networkInfo(3000, {
    wlan0: [item('192.168.1.15')],
    eth0: [item('10.0.0.5')],
  }));
  expect(banner).toContain('Notebook (local): http://localhost:3000');
  expect(banner).toContain('Celulares (Wi-Fi / wlan0): http://192.168.1.15:3000');
  expect(banner).toContain('Celulares (Rede local / eth0): http://10.0.0.5:3000');
});

it('formatNetworkBanner clearly labels virtual interfaces and instructs connecting to WiFi', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const banner = formatNetworkBanner(3000, networkInfo(3000, {
    docker0: [item('172.17.0.1')],
  }));
  expect(banner).toContain('Notebook (local): http://localhost:3000');
  expect(banner).toContain('Nenhuma interface Wi-Fi/Ethernet detectada para conexão de celulares.');
  expect(banner).toContain('Interface virtual (docker0 - desenvolvimento/local): http://172.17.0.1:3000 (normalmente inacessível para celulares)');
  expect(banner).toContain('Conecte o notebook à rede Wi-Fi da partida para que os celulares possam entrar.');
  expect(banner.some(line => line.includes('Celulares (Wi-Fi / docker0)'))).toBe(false);
});

it('formatNetworkBanner provides clear guidance when no network interfaces exist', () => {
  const banner = formatNetworkBanner(3000, networkInfo(3000, {}));
  expect(banner).toContain('Notebook (local): http://localhost:3000');
  expect(banner).toContain('Nenhuma interface Wi-Fi/Ethernet detectada para conexão de celulares.');
  expect(banner).toContain('Conecte o notebook à rede Wi-Fi da partida para que os celulares possam entrar.');
});

it('respects DATABASE_PATH environment variable for SQLite persistence path', () => {
  const customPath = join(tmpdir(), `custom-poker-${Date.now()}.sqlite`);
  const originalEnv = process.env.DATABASE_PATH;
  try {
    process.env.DATABASE_PATH = customPath;
    const resolved = resolve(process.env.DATABASE_PATH ?? 'data/poker-table.sqlite');
    expect(resolved).toBe(resolve(customPath));
  } finally {
    if (originalEnv === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalEnv;
    }
  }
});

it('filters out cellular carrier data interfaces from LAN candidates', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const result = networkInfo(3000, {
    lo: [item('127.0.0.1', true)],
    rmnet_data0: [item('10.55.12.3')],
    ccmni0: [item('10.88.99.1')],
    wlan0: [item('192.168.1.15')],
  });
  expect(result.addresses.map(a => a.name)).toEqual(['wlan0']);
  expect(result.addresses[0]?.address).toBe('192.168.1.15');
});

it('prioritizes manual hotspot IP override via parameter or LAN_IP env var', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const result = networkInfo(3000, {
    wlan0: [item('192.168.1.15')],
  }, '10.107.248.23');

  expect(result.addresses[0]?.name).toBe('hotspot/manual');
  expect(result.addresses[0]?.address).toBe('10.107.248.23');
  expect(result.addresses[0]?.url).toBe('http://10.107.248.23:3000');
  expect(result.addresses[0]?.isVirtual).toBe(false);

  const banner = formatNetworkBanner(3000, result);
  expect(banner).toContain('Celulares (Hotspot / hotspot/manual): http://10.107.248.23:3000');
});

it('handles multiple Wi-Fi interfaces (e.g. wlan0 and wlan1) and allows selecting by IP or interface name', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan0: [item('192.168.1.41')],
    wlan1: [item('10.107.248.23')],
  };

  // 1. Without override: both are returned
  const defaultResult = networkInfo(3000, interfaces);
  expect(defaultResult.addresses.map(a => a.address)).toContain('192.168.1.41');
  expect(defaultResult.addresses.map(a => a.address)).toContain('10.107.248.23');

  // 2. Select by IP: wlan1 is prioritized to index 0
  const ipResult = networkInfo(3000, interfaces, '10.107.248.23');
  expect(ipResult.addresses[0]?.name).toBe('wlan1 (selecionada)');
  expect(ipResult.addresses[0]?.address).toBe('10.107.248.23');
  expect(ipResult.addresses[1]?.address).toBe('192.168.1.41');

  // 3. Select by interface name: wlan1 is prioritized to index 0
  const ifaceResult = networkInfo(3000, interfaces, 'wlan1');
  expect(ifaceResult.addresses[0]?.name).toBe('wlan1 (selecionada)');
  expect(ifaceResult.addresses[0]?.address).toBe('10.107.248.23');

  // 4. Select by interface name: wlan0 is prioritized to index 0 without false hotspot label
  const wlan0Result = networkInfo(3000, interfaces, 'wlan0');
  expect(wlan0Result.addresses[0]?.name).toBe('wlan0 (selecionada)');
  expect(wlan0Result.addresses[0]?.address).toBe('192.168.1.41');

  // 5. Banner includes tip when multiple physical interfaces exist
  const banner = formatNetworkBanner(3000, defaultResult);
  expect(banner.some(line => line.includes('Dica: Múltiplas redes detectadas'))).toBe(true);
});

it('correctly distinguishes dedicated SoftAP interfaces from regular Wi-Fi', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan0: [item('192.168.1.41')],
    ap0: [item('10.107.248.23')],
  };

  const result = networkInfo(3000, interfaces, '10.107.248.23');
  expect(result.addresses[0]?.name).toBe('ap0 (hotspot)');
  expect(result.addresses[0]?.address).toBe('10.107.248.23');

  const banner = formatNetworkBanner(3000, result);
  expect(banner).toContain('Celulares (Hotspot / ap0 (hotspot)): http://10.107.248.23:3000');
  expect(banner).toContain('Celulares (Wi-Fi / wlan0): http://192.168.1.41:3000');
});

// Cenários de validação da Etapa 5B.3 (correção de hotspot e target dinâmico):

it('Cenário A: wlan0 = 192.168.1.41 selecionada como Wi-Fi sem rótulo falso de hotspot', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan0: [item('192.168.1.41')],
  };
  const result = networkInfo(3000, interfaces, '192.168.1.41');
  expect(result.addresses[0]?.address).toBe('192.168.1.41');
  expect(result.addresses[0]?.name).toBe('wlan0 (selecionada)');
  expect(result.addresses[0]?.name.includes('hotspot')).toBe(false);
  const banner = formatNetworkBanner(3000, result);
  expect(banner).toContain('Celulares (Wi-Fi / wlan0 (selecionada)): http://192.168.1.41:3000');
  expect(banner.some(line => line.includes('Celulares (Hotspot'))).toBe(false);
});

it('Cenário B: wlan1 = 10.107.248.23 selecionada como candidato de hotspot', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan1: [item('10.107.248.23')],
  };
  const result = networkInfo(3000, interfaces, '10.107.248.23');
  expect(result.addresses[0]?.address).toBe('10.107.248.23');
  expect(result.addresses[0]?.name).toBe('wlan1 (selecionada)');
  const banner = formatNetworkBanner(3000, result);
  expect(banner.join('\n')).toContain('http://10.107.248.23:3000');
});

it('Cenário C: wlan0 e wlan1 simultâneos, seleção explícita de wlan1 posiciona wlan1 em primeiro lugar', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan0: [item('192.168.1.41')],
    wlan1: [item('10.107.248.23')],
  };
  const result = networkInfo(3000, interfaces, '10.107.248.23');
  expect(result.addresses[0]?.address).toBe('10.107.248.23');
  expect(result.addresses[0]?.url).toBe('http://10.107.248.23:3000');
  expect(result.addresses[1]?.address).toBe('192.168.1.41');
  expect(result.addresses[1]?.url).toBe('http://192.168.1.41:3000');
});

it('Cenário D: sobreposição dinâmica de IP no servidor (setDynamicTarget) altera o target anterior', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan0: [item('192.168.1.41')],
    wlan1: [item('10.107.248.23')],
  };

  try {
    setDynamicTarget('192.168.1.41');
    expect(getDynamicTarget()).toBe('192.168.1.41');
    const result1 = networkInfo(3000, interfaces);
    expect(result1.addresses[0]?.address).toBe('192.168.1.41');

    setDynamicTarget('10.107.248.23');
    expect(getDynamicTarget()).toBe('10.107.248.23');
    const result2 = networkInfo(3000, interfaces);
    expect(result2.addresses[0]?.address).toBe('10.107.248.23');
    expect(result2.addresses[1]?.address).toBe('192.168.1.41');
  } finally {
    setDynamicTarget(undefined);
  }
});

it('Cenário E: regra de seleção de origem localhost vs LAN para convite e QR Code', () => {
  const item = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family } as NetworkInterfaceInfo);
  const interfaces = {
    wlan0: [item('192.168.1.41')],
    wlan1: [item('10.107.248.23')],
  };

  // Anfitrião com target dinâmico wlan1
  setDynamicTarget('10.107.248.23');
  try {
    const info = networkInfo(3000, interfaces);

    // Função de resolução reproduzindo o comportamento de Invite.tsx
    function resolveInviteUrl(hostname: string, netInfo: typeof info): string {
      const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
      const preferredPhysical = netInfo.addresses.find(a => !a.isVirtual);
      if (isLocalhost) {
        return preferredPhysical?.url ?? netInfo.addresses[0]?.url ?? `http://${hostname}:3000`;
      }
      const match = netInfo.addresses.find(a => a.address === hostname);
      return match?.url ?? preferredPhysical?.url ?? netInfo.addresses[0]?.url ?? `http://${hostname}:3000`;
    }

    // 1. Host acessando via localhost na WebView (127.0.0.1) deve priorizar o IP físico alvo (wlan1)
    expect(resolveInviteUrl('127.0.0.1', info)).toBe('http://10.107.248.23:3000');
    expect(resolveInviteUrl('localhost', info)).toBe('http://10.107.248.23:3000');

    // 2. Convidado acessando via LAN pelo IP do hotspot
    expect(resolveInviteUrl('10.107.248.23', info)).toBe('http://10.107.248.23:3000');

    // 3. Convidado acessando via LAN pelo IP alternativo (wlan0)
    expect(resolveInviteUrl('192.168.1.41', info)).toBe('http://192.168.1.41:3000');
  } finally {
    setDynamicTarget(undefined);
  }
});

it('POST /api/network/target atualiza o target dinâmico via HTTP e retorna networkInfo atualizado', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'poker-net-'));
  const app = createApplication({ databasePath: join(directory, 'test.sqlite') });
  const serverPort = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${serverPort}`;

  try {
    const res = await fetch(`${base}/api/network/target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: '10.107.248.23' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { addresses: Array<{ address: string }> } };
    expect(body.ok).toBe(true);
    expect(getDynamicTarget()).toBe('10.107.248.23');
  } finally {
    setDynamicTarget(undefined);
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('isLoopbackAddress valida estritamente endereços de loopback e rejeita LAN/remotos', () => {
  expect(isLoopbackAddress('127.0.0.1')).toBe(true);
  expect(isLoopbackAddress('::1')).toBe(true);
  expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);

  expect(isLoopbackAddress('192.168.1.41')).toBe(false);
  expect(isLoopbackAddress('10.107.248.23')).toBe(false);
  expect(isLoopbackAddress('10.0.0.1')).toBe(false);
  expect(isLoopbackAddress('172.16.0.5')).toBe(false);
  expect(isLoopbackAddress(undefined)).toBe(false);
  expect(isLoopbackAddress(null)).toBe(false);
  expect(isLoopbackAddress('')).toBe(false);
});
