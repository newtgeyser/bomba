import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static.js';
import { createWebSocketServer } from './ws.js';
import { createRoomManager } from './rooms.js';
import { createDataStore } from './store.js';
import { handleApi } from './api.js';
import { createRatingsStore } from './ratings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

const store = await createDataStore(path.join(repoRoot, 'data'));
const ratings = await createRatingsStore(store);
const roomManager = createRoomManager({ store, ratings });

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    if (await handleApi({ req, res, store })) return;

    // Serve `client/` and `shared/` as static ESM.
    const staticRoot = repoRoot;
    const ok = await serveStatic({
      req,
      res,
      roots: [
        { urlPrefix: '/', dir: path.join(staticRoot, 'client'), defaultFile: 'index.html' },
        { urlPrefix: '/shared/', dir: path.join(staticRoot, 'shared') },
      ],
    });
    if (!ok) {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch (err) {
    res.writeHead(500);
    res.end('Internal Server Error');
    console.error(err);
  }
});

createWebSocketServer(server, {
  path: '/ws',
  onConnection: (socket) => roomManager.onSocketConnection(socket),
});

server.listen(PORT, HOST, () => {
  console.log(`ABO dev server listening on http://${HOST}:${PORT}`);
});
