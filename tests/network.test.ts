import { expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { formatNetworkBanner, networkInfo, sameOrigin } from '../apps/server/src/http/network.js';

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
