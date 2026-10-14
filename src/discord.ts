import { REST } from 'discord.js';
import { z } from 'zod';
import path from 'node:path';
import { Assets } from './assets.js';
import { getOperation, id, routeParameters, type Method, type Operation } from './catalog.js';
import type { Config } from './config.js';
import { sanitize } from './security.js';

export type RequestOptions = {
  body?: unknown;
  query?: URLSearchParams;
  reason?: string;
  auth?: boolean;
  passThroughBody?: boolean;
  files?: { data: Buffer; name: string; key?: string; contentType?: string }[];
};
export interface Transport { request(method: Method, route: string, options?: RequestOptions): Promise<unknown> }

export class DiscordTransport implements Transport {
  private readonly rest: REST;
  constructor(private readonly token: string) {
    // No retry of ambiguous 5xx/network writes. Discord REST handles bucket and global 429s.
    this.rest = new REST({ version: '10', timeout: 20_000, retries: 0 });
    if (token) this.rest.setToken(token);
  }
  async request(method: Method, route: string, options: RequestOptions = {}) {
    if (!this.token) throw new Error('Discord bot is not configured. Run npm run setup locally, then restart this MCP server.');
    const target = route as `/${string}`;
    switch (method) {
      case 'GET': return this.rest.get(target, options);
      case 'POST': return this.rest.post(target, options);
      case 'PATCH': return this.rest.patch(target, options);
      case 'PUT': return this.rest.put(target, options);
      case 'DELETE': return this.rest.delete(target, options);
    }
  }
}

export const callShape = {
  params: z.record(z.string()).default({}).describe('Route IDs, e.g. {guild_id,channel_id,message_id,user_id}. guild_id can default from configuration; application_id defaults to the bot.'),
  query: z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())])).default({}).describe('Query parameters supported by this action; see discord_help.'),
  body: z.unknown().optional().describe('Discord JSON payload. Get the action schema with discord_help. Images support {$file:"relative.png"}; sound uses {$file:"sound.mp3",$kind:"audio"}.'),
  files: z.array(z.object({ path: z.string().min(1), name: z.string().min(1).optional(), description: z.string().max(1024).optional() })).max(10).optional().describe('Files under DISCORD_ASSET_DIR. Sent as Discord multipart attachments.'),
  reason: z.string().min(1).max(512).optional().describe('Human-readable audit log reason for a server change.'),
};
export const callSchema = z.object(callShape);
export type CallArgs = z.input<typeof callSchema>;

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export class DiscordService {
  readonly assets: Assets;
  constructor(readonly config: Config, readonly transport: Transport = new DiscordTransport(config.token)) {
    this.assets = new Assets(config.assetDir);
  }

  assertGuild(guildId: unknown) {
    if (this.config.allowedGuildIds.size && (typeof guildId !== 'string' || !this.config.allowedGuildIds.has(guildId))) {
      throw new Error('Resource is outside DISCORD_ALLOWED_GUILD_IDS (DMs and unknown guilds are also blocked).');
    }
  }

  async checkChannel(channelId: string) {
    id.parse(channelId);
    const channel = record(await this.transport.request('GET', `/channels/${channelId}`));
    this.assertGuild(channel.guild_id);
    return channel;
  }

  private async resolveScope(op: Operation, params: Record<string, string>, body: unknown) {
    let webhook: Record<string, any> | undefined;
    if (params.guild_id) this.assertGuild(params.guild_id);
    if (op.scope === 'global' && this.config.allowedGuildIds.size && op.method !== 'GET') {
      throw new Error('Global account/application changes are unavailable while a guild allowlist is set.');
    }
    if (op.scope === 'channel' && this.config.allowedGuildIds.size) await this.checkChannel(params.channel_id);
    if (op.scope === 'webhook') {
      webhook = record(await this.transport.request('GET', `/webhooks/${params.webhook_id}`));
      this.assertGuild(webhook.guild_id);
    }
    if (op.scope === 'invite' && this.config.allowedGuildIds.size) {
      const invite = record(await this.transport.request('GET', `/invites/${encodeURIComponent(params.invite_code)}`));
      this.assertGuild(invite.guild?.id);
    }
    // Check referenced destinations too: following/moving channels, forum replies, stage starts, etc.
    if (this.config.allowedGuildIds.size) {
      const visit = async (value: unknown): Promise<void> => {
        if (Array.isArray(value)) { for (const item of value) await visit(item); return; }
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
          if ((key === 'guild_id' || key === 'source_guild_id') && item != null) this.assertGuild(item);
          if ((key === 'channel_id' || key.endsWith('_channel_id') || key === 'parent_id') && item != null) await this.checkChannel(id.parse(item));
          if (key.endsWith('_channel_ids') && Array.isArray(item)) for (const cid of item) await this.checkChannel(id.parse(cid));
          if (item && typeof item === 'object') await visit(item);
        }
      };
      await visit(body);
    }
    return webhook;
  }

  async execute(group: string, action: string, input: CallArgs) {
    const args = callSchema.parse(input);
    const op = getOperation(group, action);
    const required = routeParameters(op);
    const params = { ...args.params };
    for (const key of Object.keys(params)) if (!required.includes(key)) throw new Error(`Unexpected route parameter ${key}. Required: ${required.join(', ') || 'none'}.`);
    if (required.includes('guild_id') && !params.guild_id && this.config.guildId) params.guild_id = this.config.guildId;
    // Validate all caller-controlled path components before making any network requests.
    for (const key of required) {
      if (key === 'application_id' && !params[key]) continue;
      if (!params[key]) throw new Error(`Missing params.${key}. Use discord_help for this action.`);
      if (key === 'emoji') z.string().min(1).max(200).parse(params[key]);
      else if (key.endsWith('_code')) z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(params[key]);
      else if (key === 'answer_id' || key === 'sound_id') z.string().regex(/^\d{1,20}$/).parse(params[key]);
      else id.parse(params[key]);
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(args.query)) {
      if (!op.query?.includes(key)) throw new Error(`Unsupported query.${key}. Allowed: ${op.query?.join(', ') || 'none'}.`);
      if (Array.isArray(value) && key === 'include_roles') query.set(key, value.join(','));
      else if (Array.isArray(value)) for (const item of value) query.append(key, item);
      else query.set(key, String(value));
    }
    if (args.files?.length && !op.files) throw new Error('This action does not accept file attachments.');
    if (args.body !== undefined && !op.body) throw new Error('This action does not accept a JSON body.');
    let body: any = op.body?.parse(args.body);
    if (op.files === 'attachments') {
      // A thread post embeds a message. Ordinary threads do not have a message payload.
      const payload = group === 'threads' ? body?.message : body;
      if (payload) payload.allowed_mentions ??= { parse: [], replied_user: false };
      if (args.files?.length && !payload) throw new Error('A forum/media post upload requires body.message.');
      if ((action === 'send' || action === 'execute') && !body?.content && !body?.embeds?.length && !body?.components?.length && !body?.sticker_ids?.length && !body?.poll && !args.files?.length) {
        throw new Error('Message needs content, embeds, components, a poll, stickers or files.');
      }
    }
    if (group === 'messages' && action === 'bulk_delete') {
      const cutoff = Date.now() - 14 * 86400_000;
      for (const mid of body.messages) {
        const created = Number((BigInt(mid) >> 22n) + 1420070400000n);
        if (created <= cutoff) throw new Error('Bulk delete contains a message at least 14 days old. Delete old messages individually.');
      }
    }
    if (params.guild_id) this.assertGuild(params.guild_id);
    if (required.includes('application_id')) {
      const me = record(await this.transport.request('GET', '/applications/@me'));
      if (params.application_id && params.application_id !== me.id) throw new Error('Only this bot application can be managed.');
      params.application_id = id.parse(me.id);
    }
    const webhook = await this.resolveScope(op, params, body);
    if (args.query.thread_id && this.config.allowedGuildIds.size) await this.checkChannel(id.parse(args.query.thread_id));
    body = await this.assets.expand(body);
    let route = op.route.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(params[key]));
    const options: RequestOptions = { query, reason: args.reason };
    if (route.includes('$token')) {
      if (!webhook?.token) throw new Error('Webhook has no executable token; use an incoming webhook accessible to this bot.');
      route = route.replace('$token', encodeURIComponent(webhook.token));
      options.auth = false;
      if (action === 'execute') query.set('wait', 'true');
    }
    if (op.files === 'sticker') {
      if (args.files?.length !== 1) throw new Error('Sticker upload needs exactly one file.');
      const file = args.files[0];
      const name = file.name ?? path.basename(file.path);
      const contentTypes: Record<string, string> = { '.png': 'image/png', '.gif': 'image/gif', '.json': 'application/json' };
      const contentType = contentTypes[path.extname(name).toLowerCase()];
      if (!contentType) throw new Error('Sticker must be PNG/APNG (.png), GIF or Lottie JSON.');
      const form = new FormData();
      for (const [key, value] of Object.entries(body)) form.append(key, String(value));
      form.append('file', new Blob([new Uint8Array(await this.assets.read(file.path, 512 * 1024))], { type: contentType }), name);
      options.body = form;
      options.passThroughBody = true;
    } else {
      if (args.files?.length) {
        const payload = group === 'threads' ? body.message : body;
        const attachments = payload.attachments ?? [];
        // Existing snowflakes are retained; reject colliding new-file indices.
        const reserved = new Set(attachments.map((a: any) => String(a.id)));
        let next = 0;
        options.files = [];
        for (const file of args.files) {
          while (reserved.has(String(next))) next++;
          const name = file.name ?? path.basename(file.path);
          if (path.basename(name) !== name || /[\r\n]/.test(name)) throw new Error('Attachment name must be a plain filename.');
          options.files.push({ data: await this.assets.read(file.path), name, key: `files[${next}]` });
          attachments.push({ id: next, filename: name, ...(file.description && { description: file.description }) });
          reserved.add(String(next++));
        }
        payload.attachments = attachments;
      }
      if (body !== undefined) options.body = body;
    }
    let result: unknown;
    try { result = await this.transport.request(op.method, route, options); }
    catch (error) {
      // REST errors can contain a credential-bearing URL. Redact before propagating.
      if (error instanceof Error) error.message = String(sanitize(error.message, [this.config.token, webhook?.token ?? '']));
      throw error;
    }
    if (group === 'account' && action === 'guilds' && this.config.allowedGuildIds.size && Array.isArray(result)) result = result.filter(g => this.config.allowedGuildIds.has(g.id));
    return sanitize(result ?? { ok: true }, [this.config.token, webhook?.token ?? '']);
  }
}
