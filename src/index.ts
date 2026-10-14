import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { errorPayload } from './security.js';

const config = loadConfig();
const app = createServer(config);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
process.stdin.once('end', () => { void shutdown(); });
try {
  await app.server.connect(new StdioServerTransport());
} catch (error) {
  console.error(JSON.stringify(errorPayload(error, [config.token])));
  process.exitCode = 1;
  await shutdown();
}
