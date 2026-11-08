import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Store } from '../persistence/database.js';
import { RoomService } from '../rooms/service.js';
import { attachRealtime } from '../realtime/socket.js';
import { failure, RoomError } from '../errors.js';
import { isLoopbackAddress, networkInfo, sameOrigin, setDynamicTarget } from './network.js';

export interface AppOptions { databasePath: string; webDirectory?: string; rateLimitMax?: number }
export function createApplication(options: AppOptions) {
  const store = new Store(options.databasePath), rooms = new RoomService(store);
  const app = express(), http = createServer(app);
  const { io, broadcast } = attachRealtime(http, rooms);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!sameOrigin(req.headers.origin, req.headers.host)) { res.status(403).json(failure(new RoomError('FORBIDDEN', 'Origem não permitida.'))); return; }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/health', (_req, res) => { store.db.prepare('SELECT 1').get(); res.json({ status: 'ok', app: 'poker-table', protocol: 1 }); });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const requests = new Map<string, { count: number; start: number }>();
  app.use('/api', (req, _res, next) => {
    if (req.method === 'GET') return next();
    const now = Date.now(), key = req.socket.remoteAddress ?? 'unknown';
    for (const [id, bucket] of requests) if (now - bucket.start > 60000) requests.delete(id);
    const bucket = requests.get(key) ?? { count: 0, start: now };
    bucket.count++; requests.set(key, bucket);
    const maxRequests = options.rateLimitMax ?? 100;
    if (bucket.count > maxRequests) return next(new RoomError('RATE_LIMITED', 'Muitas solicitações. Aguarde um minuto.'));
    if (!req.is('application/json')) return next(new RoomError('INVALID_INPUT', 'Envie dados JSON.'));
    next();
  });
  app.get('/api/network', (_req, res) => res.json({ ok: true, data: networkInfo((http.address() as AddressInfo).port) }));
  app.post('/api/network/target', (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      return res.status(403).json(failure(new RoomError('FORBIDDEN', 'Configuração de rede restrita ao dispositivo anfitrião local.')));
    }
    const target = typeof req.body?.target === 'string' ? req.body.target.trim() : undefined;
    setDynamicTarget(target);
    const netInfo = networkInfo((http.address() as AddressInfo).port);
    res.json({ ok: true, data: netInfo });
  });
  app.post('/api/rooms', (req, res) => res.status(201).json({ ok: true, data: rooms.create(req.body) }));
  app.get('/api/rooms/:code', (req, res) => res.json({ ok: true, data: rooms.find(req.params.code) }));
  app.post('/api/rooms/:code/join', (req, res) => {
    const admission = rooms.join(req.params.code, req.body);
    broadcast(admission.room.id);
    res.status(201).json({ ok: true, data: admission });
  });
  app.use('/api', (_req, res) => res.status(404).json(failure(new RoomError('NOT_FOUND', 'Endpoint não encontrado.'))));
  if (options.webDirectory) {
    app.use(express.static(options.webDirectory, { index: false }));
    app.get(['/', '/create', '/join', '/join/:code', '/room/:code'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(resolve(options.webDirectory!, 'index.html'));
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express exige quatro parâmetros no error handler.
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const malformed = error instanceof SyntaxError || (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large');
    const reply = failure(malformed ? new RoomError('INVALID_INPUT', 'JSON inválido ou mensagem muito grande.') : error);
    const status = { NOT_FOUND: 404, UNAUTHORIZED: 401, FORBIDDEN: 403, STORAGE_ERROR: 503, RATE_LIMITED: 429 }[reply.error.code as string] ?? 400;
    res.status(status).json(reply);
  };
  app.use(errors);
  return {
    app, http, rooms, store,
    async listen(port = 3000, host = '0.0.0.0') {
      await new Promise<void>((yes, no) => { http.once('error', no); http.listen(port, host, () => { http.off('error', no); yes(); }); });
      return (http.address() as AddressInfo).port;
    },
    async close() { await new Promise<void>(resolve => io.close(() => resolve())); store.close(); },
  };
}
