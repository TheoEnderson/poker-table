import type { Reply } from '@poker-table/protocol';

export async function request<T>(path: string, body?: unknown): Promise<T> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json() as Reply<T>;
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name))) {
      throw new Error('Não foi possível acessar o servidor. Confira a conexão com o Wi-Fi da mesa.');
    }
    throw error;
  }
}

// crypto.randomUUID is unavailable on ordinary HTTP LAN origins.
export function commandId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
