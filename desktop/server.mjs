import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export async function createReceiver({ token, onEvent }) {
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const supplied = Buffer.from(request.headers.authorization || '');
    if (request.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(403).end(); return;
    }
    if (request.method !== 'POST' || request.url !== '/events') { response.writeHead(404).end(); return; }
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 16384) { response.writeHead(413).end(); request.destroy(); return; }
        chunks.push(chunk);
      }
      const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!['codex', 'claude', 'dsh'].includes(event.source) || typeof event.sessionId !== 'string'
        || !event.sessionId || event.sessionId.length > 300 || typeof event.kind !== 'string') {
        response.writeHead(400).end(); return;
      }
      // Only the narrow event contract crosses into the store.
      const safe = {};
      for (const key of ['source', 'client', 'sessionId', 'turnId', 'toolId', 'eventId', 'kind', 'intent'])
        if (typeof event[key] === 'string') safe[key] = event[key].slice(0, 300);
      for (const key of ['at', 'pid']) if (Number.isFinite(event[key])) safe[key] = event[key];
      onEvent(safe);
      response.writeHead(204).end();
    } catch { if (!response.headersSent) response.writeHead(400).end(); }
  });
  server.requestTimeout = 3000;
  server.headersTimeout = 3000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { endpoint: `http://127.0.0.1:${server.address().port}/events`, close: () => server.close() };
}
