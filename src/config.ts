import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
dotenv({ path: path.join(projectRoot, '.env'), quiet: true });

const flag = z.enum(['true', 'false']).default('false').transform(v => v === 'true');
const snowflake = z.string().regex(/^\d{17,20}$/);
const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().default(''),
  DISCORD_GUILD_ID: z.union([snowflake, z.literal('')]).default(''),
  DISCORD_ALLOWED_GUILD_IDS: z.string().default(''),
  DISCORD_ASSET_DIR: z.string().default('./assets'),
  DISCORD_MESSAGE_CONTENT: flag,
  DISCORD_GUILD_MEMBERS: flag,
  DISCORD_EVENT_BUFFER_SIZE: z.coerce.number().int().min(10).max(2000).default(200),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(env);
  const allowedGuildIds = value.DISCORD_ALLOWED_GUILD_IDS.split(',').map(s => s.trim()).filter(Boolean);
  allowedGuildIds.forEach(id => snowflake.parse(id));
  if (value.DISCORD_GUILD_ID && allowedGuildIds.length && !allowedGuildIds.includes(value.DISCORD_GUILD_ID)) {
    throw new Error('DISCORD_GUILD_ID must be included in DISCORD_ALLOWED_GUILD_IDS.');
  }
  return {
    token: value.DISCORD_BOT_TOKEN.trim(),
    guildId: value.DISCORD_GUILD_ID || undefined,
    allowedGuildIds: new Set(allowedGuildIds),
    assetDir: path.resolve(projectRoot, value.DISCORD_ASSET_DIR),
    messageContent: value.DISCORD_MESSAGE_CONTENT,
    guildMembers: value.DISCORD_GUILD_MEMBERS,
    eventBufferSize: value.DISCORD_EVENT_BUFFER_SIZE,
  };
}
export type Config = ReturnType<typeof loadConfig>;
