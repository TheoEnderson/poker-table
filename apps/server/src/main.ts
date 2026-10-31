import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApplication } from './http/app.js';
import { networkInfo } from './http/network.js';

process.umask(0o077);
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um inteiro entre 1 e 65535.');
const app = createApplication({
  databasePath: resolve(process.env.DATABASE_PATH ?? 'data/poker-table.sqlite'),
  webDirectory: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
});
await app.listen(port, process.env.HOST ?? '0.0.0.0');
console.log(`Poker Table: http://localhost:${port}`);
for (const address of networkInfo(port).addresses) console.log(`LAN (${address.name}): ${address.url}`);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().then(() => process.exit(0));
});
