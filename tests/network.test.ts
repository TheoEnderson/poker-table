import { expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { networkInfo, sameOrigin } from '../apps/server/src/http/network.js';
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
