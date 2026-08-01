import { createServer } from './server.js';

const PORT = Number(process.env['PORT'] ?? 8787);

const server = createServer(PORT);
console.log(`[server] EMBER listening on ws://localhost:${PORT}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} — shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
