import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

// Versioned, transactional migrations. Never delete an unreadable database.
const migrations = [
  `CREATE TABLE rooms (
    id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, config TEXT NOT NULL,
    host_id TEXT NOT NULL, admin_hash TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE participants (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), name TEXT NOT NULL,
    seat INTEGER CHECK(seat BETWEEN 1 AND 10), session_hash TEXT NOT NULL,
    joined_at TEXT NOT NULL, UNIQUE(room_id, seat)
  );
  CREATE INDEX participants_room ON participants(room_id);
  CREATE TABLE commands (
    room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL,
    command_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    PRIMARY KEY(room_id, player_id, command_id)
  );`,
];

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > migrations.length) { this.db.close(); throw new Error('Banco de uma versão mais recente. Atualize o servidor.'); }
    for (let i = version.user_version; i < migrations.length; i++) this.transaction(() => {
      this.db.exec(migrations[i]);
      this.db.exec(`PRAGMA user_version=${i + 1}`);
    });
    // Presence is ephemeral. A restart creates a newer authoritative snapshot.
    this.db.exec('UPDATE rooms SET revision=revision+1 WHERE closed=0');
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
