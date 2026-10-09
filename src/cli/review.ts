import {createServer as createViteServer} from 'vite';
import {config} from '../config.js';
import {startServer} from '../server.js';

const api = await startServer(config.appPort, false);
const vite = await createViteServer({server: {host: '127.0.0.1', port: config.reviewPort}});
await vite.listen();
console.log(`审核台：http://127.0.0.1:${config.reviewPort}`);

const shutdown = async () => {
  await vite.close();
  await api.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

