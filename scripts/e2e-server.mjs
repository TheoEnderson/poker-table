import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApplication } from '../apps/server/dist/http/app.js';

const directory = mkdtempSync(join(tmpdir(), 'poker-e2e-'));
const app = createApplication({ databasePath: join(directory, 'rooms.sqlite'), webDirectory: resolve('apps/web/dist') });
await app.listen(3100, '0.0.0.0');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void app.close().then(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); });
});
