import type { ErrorCode, Failure } from '@poker-table/protocol';
import { ZodError } from 'zod';

export class RoomError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); }
}
export function failure(error: unknown): Failure {
  if (error instanceof RoomError) return { ok: false, error: { code: error.code, message: error.message } };
  if (error instanceof ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: error.issues[0]?.message ?? 'Comando inválido.' } };
  // Never send SQL, file paths, credentials or stack traces to participants.
  return { ok: false, error: { code: 'STORAGE_ERROR', message: 'Não foi possível confirmar a alteração. Sincronize a mesa e tente novamente.' } };
}
