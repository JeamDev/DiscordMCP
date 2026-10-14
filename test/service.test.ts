import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Assets } from '../src/assets.js';
import { loadConfig } from '../src/config.js';
import { DiscordService, type RequestOptions, type Transport } from '../src/discord.js';
import { operations, routeParameters, type Method } from '../src/catalog.js';
import { sanitize, errorPayload } from '../src/security.js';

const GUILD = '123456789012345678';
const OTHER = '223456789012345678';
const CHANNEL = '323456789012345678';
const MESSAGE = '423456789012345678';
const WEBHOOK = '523456789012345678';
const TOKEN = 'private.bot.token.for.test';
class FakeTransport implements Transport {
  calls: { method: Method; route: string; options: RequestOptions }[] = [];
  response: (method: Method, route: string, options: RequestOptions) => unknown = () => ({ ok: true });
  async request(method: Method, route: string, options: RequestOptions = {}) {
    this.calls.push({ method, route, options });
    return this.response(method, route, options);
  }
}
function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const transport = new FakeTransport();
  const config = loadConfig({ DISCORD_BOT_TOKEN: TOKEN, DISCORD_GUILD_ID: GUILD, ...overrides });
  return { transport, service: new DiscordService(config, transport) };
}
async function tempAssets(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'discord-mcp-test-'));
  const assets = path.join(root, 'assets');
  await mkdir(assets);
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('discord-mcp-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return { root, assets };
}

test('catalog has unique actions and no unresolved unsafe path syntax', () => {
  assert.ok(operations.length >= 140);
  assert.equal(new Set(operations.map(o => `${o.group}.${o.action}`)).size, operations.length);
  for (const op of operations) {
    assert.ok(op.route.startsWith('/'));
    assert.ok(!op.route.includes('?'));
    assert.equal(new Set(routeParameters(op)).size, routeParameters(op).length);
    if (op.route.startsWith('/channels/')) assert.equal(op.scope, 'channel');
    if (op.route.startsWith('/webhooks/')) assert.equal(op.scope, 'webhook');
  }
});

test('default guild and audit reason are routed correctly', async () => {
  const { transport, service } = fixture();
  await service.execute('channels', 'create', { body: { name: '💬・чат', type: 0 }, reason: 'Структура сообщества' });
  assert.equal(transport.calls[0].route, `/guilds/${GUILD}/channels`);
  assert.equal(transport.calls[0].options.reason, 'Структура сообщества');
});

test('snowflakes cannot inject a route and invalid input causes no HTTP call', async () => {
  const { transport, service } = fixture();
  await assert.rejects(service.execute('channels', 'delete', { params: { channel_id: `${CHANNEL}/messages` } }));
  await assert.rejects(service.execute('channels', 'delete', { params: { channel_id: CHANNEL, typo_id: MESSAGE } }), /Unexpected route parameter/);
  await assert.rejects(service.execute('channels', 'create', { body: { name: '' } }));
  await assert.rejects(service.execute('messages', 'list', { params: { channel_id: CHANNEL }, query: { token: 'oops' } }), /Unsupported query/);
  assert.equal(transport.calls.length, 0);
});

test('emoji path is encoded and query pagination is preserved', async () => {
  const { service, transport } = fixture();
  await service.execute('reactions', 'list', { params: { channel_id: CHANNEL, message_id: MESSAGE, emoji: 'party:623456789012345678' }, query: { after: MESSAGE, limit: 25 } });
  assert.match(transport.calls[0].route, /party%3A623456789012345678$/);
  assert.equal(transport.calls[0].options.query?.toString(), `after=${MESSAGE}&limit=25`);
});

test('query arrays follow Discord repeated-key syntax, except comma-separated prune roles', async () => {
  const { service, transport } = fixture();
  await service.execute('messages', 'search', { query: { author_id: [MESSAGE, OTHER], has: ['image', 'video'] } });
  assert.deepEqual(transport.calls[0].options.query?.getAll('author_id'), [MESSAGE, OTHER]);
  await service.execute('members', 'prune_count', { query: { include_roles: [MESSAGE, OTHER] } });
  assert.equal(transport.calls[1].options.query?.get('include_roles'), `${MESSAGE},${OTHER}`);
});

test('messages disable mentions by default and preserve explicit mentions', async () => {
  const { service, transport } = fixture();
  await service.execute('messages', 'send', { params: { channel_id: CHANNEL }, body: { content: '@everyone hi' } });
  assert.deepEqual((transport.calls[0].options.body as any).allowed_mentions, { parse: [], replied_user: false });
  await service.execute('messages', 'send', { params: { channel_id: CHANNEL }, body: { content: 'ping', allowed_mentions: { users: [MESSAGE] } } });
  assert.deepEqual((transport.calls[1].options.body as any).allowed_mentions, { users: [MESSAGE] });
  await assert.rejects(service.execute('messages', 'send', { params: { channel_id: CHANNEL }, body: {} }), /Message needs/);
});

test('guild allowlist blocks direct, channel and nested cross-server writes', async () => {
  const { service, transport } = fixture({ DISCORD_ALLOWED_GUILD_IDS: GUILD });
  transport.response = () => ({ id: CHANNEL, guild_id: OTHER });
  await assert.rejects(service.execute('roles', 'delete', { params: { guild_id: OTHER, role_id: MESSAGE } }), /outside/);
  assert.equal(transport.calls.length, 0);
  await assert.rejects(service.execute('messages', 'send', { params: { channel_id: CHANNEL }, body: { content: 'hello' } }), /outside/);
  await assert.rejects(service.execute('guild', 'edit', { body: { system_channel_id: CHANNEL } }), /outside/);
  await assert.rejects(service.execute('community', 'onboarding_edit', { body: { default_channel_ids: [CHANNEL] } }), /outside/);
  await assert.rejects(service.execute('account', 'edit', { body: { username: 'new' } }), /Global/);
  assert.ok(transport.calls.every(c => c.method === 'GET'));
});

test('allowlisted guilds filter enumeration; DMs fail closed', async () => {
  const { service, transport } = fixture({ DISCORD_ALLOWED_GUILD_IDS: GUILD });
  transport.response = (_, route) => route === '/users/@me/guilds' ? [{ id: GUILD }, { id: OTHER }] : { id: CHANNEL, type: 1 };
  assert.deepEqual(await service.execute('account', 'guilds', {}), [{ id: GUILD }]);
  await assert.rejects(service.execute('channels', 'get', { params: { channel_id: CHANNEL } }), /outside/);
});

test('webhook execution obtains token internally and redacts its response', async () => {
  const { service, transport } = fixture({ DISCORD_ALLOWED_GUILD_IDS: GUILD });
  const webhookToken = 'webhook-secret-that-is-long-enough-to-be-redacted';
  transport.response = (_, route) => route === `/webhooks/${WEBHOOK}` ? { guild_id: GUILD, token: webhookToken } : { id: MESSAGE, token: webhookToken, url: `https://discord.com/api/webhooks/${WEBHOOK}/${webhookToken}` };
  const result = await service.execute('webhooks', 'execute', { params: { webhook_id: WEBHOOK }, body: { content: 'hello' } });
  const sent = transport.calls[1];
  assert.equal(sent.route, `/webhooks/${WEBHOOK}/${webhookToken}`);
  assert.equal(sent.options.auth, false);
  assert.equal(sent.options.query?.get('wait'), 'true');
  assert.ok(!JSON.stringify(result).includes(webhookToken));
});

test('out-of-scope webhooks and invites do not mutate resources', async () => {
  const { service, transport } = fixture({ DISCORD_ALLOWED_GUILD_IDS: GUILD });
  transport.response = () => ({ guild_id: OTHER, guild: { id: OTHER }, token: 'secret' });
  await assert.rejects(service.execute('webhooks', 'delete', { params: { webhook_id: WEBHOOK } }), /outside/);
  await assert.rejects(service.execute('invites', 'delete', { params: { invite_code: 'abc123' } }), /outside/);
  assert.ok(transport.calls.every(c => c.method === 'GET'));
});

test('old and duplicate bulk-delete messages are rejected before HTTP', async () => {
  const { service, transport } = fixture();
  const recent = ((BigInt(Date.now() - 60_000) - 1420070400000n) << 22n).toString();
  await assert.rejects(service.execute('messages', 'bulk_delete', { params: { channel_id: CHANNEL }, body: { messages: [MESSAGE, recent] } }), /14 days/);
  await assert.rejects(service.execute('messages', 'bulk_delete', { params: { channel_id: CHANNEL }, body: { messages: [recent, recent] } }), /unique/);
  assert.equal(transport.calls.length, 0);
  await service.execute('messages', 'bulk_delete', { params: { channel_id: CHANNEL }, body: { messages: [recent, (BigInt(recent) + 1n).toString()] } });
  assert.equal(transport.calls.length, 1);
});

test('asset paths reject traversal, oversized files and symlink escape', async t => {
  const { root, assets } = await tempAssets(t);
  await writeFile(path.join(root, 'secret.txt'), 'secret');
  await writeFile(path.join(assets, 'test.png'), Buffer.from([1, 2, 3]));
  const reader = new Assets(assets);
  await assert.rejects(reader.read('../secret.txt'), /inside/);
  await assert.rejects(reader.read(path.join(root, 'secret.txt')), /inside/);
  await assert.rejects(reader.resolve('test.png', 2), /under/);
  assert.equal(await reader.dataUri('test.png', 'image'), 'data:image/png;base64,AQID');
  await mkdir(path.join(root, 'private'));
  await writeFile(path.join(root, 'private', 'outside.png'), 'private');
  await symlink(path.join(root, 'private'), path.join(assets, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(reader.read('escape/outside.png'), /inside/);
});

test('image references and attachment bytes are expanded before dispatch', async t => {
  const { assets } = await tempAssets(t);
  await writeFile(path.join(assets, 'icon.png'), Buffer.from([1, 2, 3]));
  const { service, transport } = fixture({ DISCORD_ASSET_DIR: assets });
  await service.execute('guild', 'edit', { body: { icon: { $file: 'icon.png' } } });
  assert.equal((transport.calls[0].options.body as any).icon, 'data:image/png;base64,AQID');
  await service.execute('messages', 'send', { params: { channel_id: CHANNEL }, body: {}, files: [{ path: 'icon.png', description: 'An icon' }] });
  const upload = transport.calls[1].options;
  assert.deepEqual(upload.files?.[0].data, Buffer.from([1, 2, 3]));
  assert.equal(upload.files?.[0].key, 'files[0]');
  assert.equal((upload.body as any).attachments[0].description, 'An icon');
  await service.execute('threads', 'create', { params: { channel_id: CHANNEL }, body: { name: 'Post', message: { content: 'Hi' } }, files: [{ path: 'icon.png' }] });
  assert.equal((transport.calls[2].options.body as any).message.attachments[0].filename, 'icon.png');
});

test('sticker is multipart, with a real file field and metadata', async t => {
  const { assets } = await tempAssets(t);
  await writeFile(path.join(assets, 'sticker.png'), Buffer.from([1, 2, 3]));
  const { service, transport } = fixture({ DISCORD_ASSET_DIR: assets });
  await service.execute('stickers', 'create', { body: { name: 'Sticker', description: 'A sticker', tags: 'smile' }, files: [{ path: 'sticker.png' }] });
  const options = transport.calls[0].options;
  assert.ok(options.body instanceof FormData);
  assert.equal(options.passThroughBody, true);
  assert.equal(options.body.get('name'), 'Sticker');
  assert.equal((options.body.get('file') as File).type, 'image/png');
});

test('credentials are removed recursively and Discord errors retain useful fields', () => {
  const result = sanitize({ token: 'secret', nested: [{ access_token: 'secret', text: `Token is ${TOKEN}` }] }, [TOKEN]);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes(TOKEN));
  const error = errorPayload({ message: 'Missing permissions', status: 403, code: 50013, rawError: { errors: { name: { message: 'invalid' } } } }) as any;
  assert.equal(error.code, 50013);
  assert.match(error.hint, /permissions/);
  assert.equal(error.fields.name.message, 'invalid');
});

test('configuration rejects typos in booleans and inconsistent allowlist', () => {
  assert.throws(() => loadConfig({ DISCORD_MESSAGE_CONTENT: 'yes' }));
  assert.throws(() => loadConfig({ DISCORD_GUILD_ID: GUILD, DISCORD_ALLOWED_GUILD_IDS: OTHER }), /included/);
  assert.equal(loadConfig({ DISCORD_MESSAGE_CONTENT: 'false' }).messageContent, false);
});

test('soundboard accepts short built-in IDs and opaque additional API fields', async () => {
  const { service, transport } = fixture();
  await service.execute('soundboard', 'play', { params: { channel_id: CHANNEL }, body: { sound_id: '1' } });
  assert.deepEqual(transport.calls[0].options.body, { sound_id: '1' });
  await service.execute('roles', 'edit', { params: { role_id: MESSAGE }, body: { colors: { primary_color: 1234, secondary_color: 5678 } } });
  assert.equal((transport.calls[1].options.body as any).colors.secondary_color, 5678);
});
