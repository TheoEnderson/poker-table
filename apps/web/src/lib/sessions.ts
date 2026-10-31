import { credentialsSchema, type Credentials } from '@poker-table/protocol';
const key = (code: string) => `poker-table.session.v1.${code}`;
export function loadSession(code: string): Credentials | null {
  try { const parsed = credentialsSchema.safeParse(JSON.parse(localStorage.getItem(key(code)) ?? 'null')); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
export function checkStorage() {
  try { localStorage.setItem('poker-table.storage-check', '1'); localStorage.removeItem('poker-table.storage-check'); }
  catch { throw new Error('Ative o armazenamento deste navegador para guardar sua sessão e poder reconectar.'); }
}
export function saveSession(code: string, credentials: Credentials) { localStorage.setItem(key(code), JSON.stringify(credentials)); }
export function forgetSession(code: string) { localStorage.removeItem(key(code)); }
export function savedRooms(): string[] {
  try { return Object.keys(localStorage).filter(k => k.startsWith('poker-table.session.v1.')).map(k => k.split('.').at(-1)!).filter(code => loadSession(code)); }
  catch { return []; }
}
