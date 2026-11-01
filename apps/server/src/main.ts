import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApplication } from './http/app.js';
import { formatNetworkBanner } from './http/network.js';

process.umask(0o077);
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser um inteiro entre 1 e 65535.');
const app = createApplication({
  databasePath: resolve(process.env.DATABASE_PATH ?? 'data/poker-table.sqlite'),
  webDirectory: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
});
try {
  await app.listen(port, process.env.HOST ?? '0.0.0.0');
} catch (err: unknown) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    console.error(`\n[ERRO] A porta ${port} já está em uso por outro processo.`);
    console.error('Verifique se outra instância do Poker Table já está em execução.');
    console.error(`Para iniciar em outra porta, utilize: PORT=${port + 1} npm start\n`);
    process.exit(1);
  }
  throw err;
}

console.log('\nPoker Table pronto para uso offline:');
for (const line of formatNetworkBanner(port)) {
  console.log(`- ${line}`);
}
console.log('\nPressione Ctrl+C para encerrar o servidor.\n');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().then(() => process.exit(0));
});
