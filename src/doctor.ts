import { loadConfig } from './config.js';
import { DiscordService } from './discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import { errorPayload } from './security.js';

const config = loadConfig();
const service = new DiscordService(config);
console.log(`Node: ${process.version}\nAssets: ${config.assetDir}\nBot token configured: ${Boolean(config.token)}`);
console.log(generateDependencyReport());
if (!config.token) {
  console.log('Next: create a bot at https://discord.com/developers/applications and run npm run setup.');
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify({ bot: await service.execute('account', 'me', {}), guilds: await service.execute('account', 'guilds', { query: { limit: 100 } }) }, null, 2));
  } catch (error) {
    console.error(JSON.stringify(errorPayload(error, [config.token])));
    process.exitCode = 1;
  }
}
