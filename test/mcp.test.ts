import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import path from 'node:path';
import { operations } from '../src/catalog.js';
import { loadConfig, projectRoot } from '../src/config.js';
import { createServer } from '../src/server.js';

function payload(result: any) { return JSON.parse(result.content.find((c: any) => c.type === 'text').text); }

test('all operation schemas serialize to valid JSON without leaking runtime objects', () => {
  for (const op of operations) {
    if (op.body) assert.ok(JSON.parse(JSON.stringify(zodToJsonSchema(op.body, { $refStrategy: 'none' }))));
  }
});

test('MCP client negotiates tools, calls, resources and prompts through in-memory transport', async t => {
  const app = createServer(loadConfig({}));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await app.server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await app.close(); });
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 25);
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length);
  const status = payload(await client.callTool({ name: 'discord_status', arguments: {} }));
  assert.equal(status.configured, false);
  assert.equal(status.rest_operations, operations.length);
  const help = payload(await client.callTool({ name: 'discord_help', arguments: { group: 'messages', action: 'send' } }));
  assert.deepEqual(help.required_params, ['channel_id']);
  assert.ok(help.body_schema.properties.content);
  const failed = await client.callTool({ name: 'discord_channels', arguments: { action: 'list' } });
  assert.equal(failed.isError, true);
  assert.match(payload(failed).error, /guild_id/);
  const missingToken = await client.callTool({ name: 'discord_account', arguments: { action: 'me' } });
  assert.equal(missingToken.isError, true);
  assert.match(payload(missingToken).error, /not configured/);
  const encoded = payload(await client.callTool({ name: 'discord_permissions', arguments: { names: ['ViewChannel', 'SendMessages'] } }));
  assert.equal(encoded.bitfield, '3072');
  const admin = payload(await client.callTool({ name: 'discord_permissions', arguments: { bitfield: '8' } }));
  assert.deepEqual(admin.names, ['Administrator']);
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 2);
  const setup = await client.readResource({ uri: 'discord://setup' });
  assert.match((setup.contents[0] as any).text, /npm run setup/);
  const catalog = await client.readResource({ uri: 'discord://catalog' });
  assert.equal(JSON.parse((catalog.contents[0] as any).text).length, operations.length);
  const prompt = await client.getPrompt({ name: 'design_discord_server', arguments: { guild_id: '123456789012345678', brief: 'Gaming community' } });
  assert.match((prompt.messages[0].content as any).text, /Gaming community/);
});

test('built entry point speaks real stdio MCP from a different working directory', { timeout: 20_000 }, async t => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.join(projectRoot, 'dist/index.js')], cwd: path.dirname(projectRoot),
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      DISCORD_BOT_TOKEN: '', DISCORD_GUILD_ID: '', DISCORD_ALLOWED_GUILD_IDS: '', DISCORD_MESSAGE_CONTENT: 'false', DISCORD_GUILD_MEMBERS: 'false' },
    stderr: 'pipe',
  });
  let errors = '';
  transport.stderr?.on('data', chunk => { errors += String(chunk); });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  const status = payload(await client.callTool({ name: 'discord_status', arguments: {} }));
  assert.equal(status.configured, false);
  assert.equal(status.asset_directory, path.join(projectRoot, 'assets'));
  assert.equal(status.gateway.connected, false);
  const deps = payload(await client.callTool({ name: 'discord_voice', arguments: { action: 'dependencies' } }));
  assert.match(deps.report, /opusscript/);
  assert.match(deps.report, /ffmpeg/i);
  assert.ok(!errors.includes('SyntaxError'));
});
