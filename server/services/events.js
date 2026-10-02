/**
 * Server-sent events hub: kitchen display + admin live updates without polling.
 * Deliberately tiny — no socket.io, no extra deps (old iPad friendly).
 */
const clients = new Set();

export function handler(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'hello', t: Date.now() })}\n\n`);
  const client = { res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
}

export function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try {
      c.res.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}
