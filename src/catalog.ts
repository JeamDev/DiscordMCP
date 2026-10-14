import { z } from 'zod';

export const id = z.string().regex(/^\d{17,20}$/, 'Use a Discord snowflake ID as a string.');
const soundId = z.string().regex(/^\d{1,20}$/);
const text = z.string().min(1);
const object = z.record(z.unknown());
const fields = (shape: z.ZodRawShape) => z.object(shape).passthrough();
const changes = fields({}).refine(v => Object.keys(v).length > 0, 'Supply at least one field to change.');
const image = z.union([text, z.object({ $file: text })]);
const audio = z.union([text, z.object({ $file: text, $kind: z.literal('audio') })]);
const message = fields({
  content: z.string().max(2000).optional(),
  embeds: z.array(object).max(10).optional(),
  components: z.array(object).optional(),
  allowed_mentions: object.optional(),
  attachments: z.array(object).optional(),
  sticker_ids: z.array(id).max(3).optional(),
  poll: object.optional(),
});
const role = fields({ name: z.string().min(1).max(100).optional(), permissions: z.string().regex(/^\d+$/).optional(), color: z.number().int().min(0).max(16777215).optional() });

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface Operation {
  group: string;
  action: string;
  method: Method;
  route: string;
  summary: string;
  body?: z.ZodTypeAny;
  files?: 'attachments' | 'sticker';
  query?: string[];
  scope?: 'channel' | 'webhook' | 'invite' | 'sticker' | 'stage' | 'global';
}
export const operations: Operation[] = [];
function add(group: string, action: string, method: Method, route: string, summary: string, options: Partial<Operation> = {}) {
  operations.push({ group, action, method, route, summary, ...options });
}
const guild = '/guilds/{guild_id}';
const channel = '/channels/{channel_id}';
const msg = `${channel}/messages/{message_id}`;

add('account', 'me', 'GET', '/users/@me', 'Read bot identity.');
add('account', 'edit', 'PATCH', '/users/@me', 'Change bot username, avatar or banner.', { body: changes, scope: 'global' });
add('account', 'guilds', 'GET', '/users/@me/guilds', 'List bot servers; supports pagination.', { query: ['before', 'after', 'limit', 'with_counts'] });
add('account', 'user', 'GET', '/users/{user_id}', 'Get a public user profile.');
add('account', 'application', 'GET', '/applications/@me', 'Read bot application configuration.');
add('account', 'edit_application', 'PATCH', '/applications/@me', 'Edit application description, icon, tags and supported settings.', { body: changes, scope: 'global' });

add('guild', 'get', 'GET', guild, 'Read server settings and features.', { query: ['with_counts'] });
add('guild', 'preview', 'GET', `${guild}/preview`, 'Read server preview.');
add('guild', 'edit', 'PATCH', guild, 'Edit name, icon, banner, splash, description, community features, system/rules channels, AFK and verification settings. Image fields accept {$file:"icon.png"}.', { body: changes });
add('guild', 'audit_log', 'GET', `${guild}/audit-logs`, 'Read audit log entries.', { query: ['user_id', 'action_type', 'before', 'after', 'limit'] });
add('guild', 'voice_regions', 'GET', `${guild}/regions`, 'List server voice regions.');
add('guild', 'integrations', 'GET', `${guild}/integrations`, 'List server integrations.');
add('guild', 'delete_integration', 'DELETE', `${guild}/integrations/{integration_id}`, 'Delete a server integration.');
add('guild', 'vanity_url', 'GET', `${guild}/vanity-url`, 'Get custom invite code and uses.');
add('guild', 'incidents', 'PUT', `${guild}/incident-actions`, 'Set invites_disabled_until or dms_disabled_until (ISO timestamp or null).', { body: changes });
add('guild', 'leave', 'DELETE', '/users/@me/guilds/{guild_id}', 'Make the bot leave this server.');

add('channels', 'list', 'GET', `${guild}/channels`, 'List categories, text, voice, forum, announcement, stage and media channels.');
add('channels', 'get', 'GET', channel, 'Read a channel or thread.', { scope: 'channel' });
add('channels', 'create', 'POST', `${guild}/channels`, 'Create a channel. Types: text=0, voice=2, category=4, announcement=5, stage=13, forum=15, media=16. Set parent_id, topic, permission_overwrites, tags and defaults.', { body: fields({ name: z.string().min(1).max(100), type: z.number().int().optional() }) });
add('channels', 'edit', 'PATCH', channel, 'Edit name, topic, category, slowmode, permissions, NSFW, voice bitrate/limit, forum tags or thread archive/lock.', { body: changes, scope: 'channel' });
add('channels', 'delete', 'DELETE', channel, 'Delete a channel or thread and its message history.', { scope: 'channel' });
add('channels', 'reorder', 'PATCH', `${guild}/channels`, 'Reorder or move channels with [{id,position,parent_id,lock_permissions}].', { body: z.array(fields({ id, position: z.number().int().optional() })).min(1) });
add('channels', 'set_permissions', 'PUT', `${channel}/permissions/{overwrite_id}`, 'Set a role (type=0) or user (type=1) permission overwrite. allow/deny are decimal strings.', { body: fields({ type: z.union([z.literal(0), z.literal(1)]), allow: z.string().regex(/^\d+$/).optional(), deny: z.string().regex(/^\d+$/).optional() }), scope: 'channel' });
add('channels', 'delete_permissions', 'DELETE', `${channel}/permissions/{overwrite_id}`, 'Remove a channel permission overwrite.', { scope: 'channel' });
add('channels', 'follow', 'POST', `${channel}/followers`, 'Follow an announcement channel into webhook_channel_id.', { body: fields({ webhook_channel_id: id }), scope: 'channel' });
add('channels', 'typing', 'POST', `${channel}/typing`, 'Show the bot typing indicator.', { scope: 'channel' });

add('messages', 'list', 'GET', `${channel}/messages`, 'Read up to 100 messages per call; paginate with before/after/around. Content may require MESSAGE_CONTENT intent.', { query: ['around', 'before', 'after', 'limit'], scope: 'channel' });
add('messages', 'search', 'GET', `${guild}/messages/search`, 'Search server messages; limit 1–25, offset up to 9975. Array filters are supported. Requires MESSAGE_CONTENT. Indexing can return retry_after.', { query: ['content', 'slop', 'author_id', 'author_type', 'mentions', 'mentions_role_id', 'mention_everyone', 'replied_to_user_id', 'replied_to_message_id', 'has', 'embed_type', 'embed_provider', 'link_hostname', 'attachment_filename', 'attachment_extension', 'max_id', 'min_id', 'channel_id', 'pinned', 'offset', 'limit', 'sort_by', 'sort_order', 'include_nsfw'] });
add('messages', 'get', 'GET', msg, 'Read a single message.', { scope: 'channel' });
add('messages', 'send', 'POST', `${channel}/messages`, 'Send content, embeds, components, files, stickers, polls or replies (message_reference). Mentions are disabled unless explicitly set.', { body: message, files: 'attachments', scope: 'channel' });
add('messages', 'edit', 'PATCH', msg, 'Edit a bot-authored message. Use attachments to retain existing uploads.', { body: message, files: 'attachments', scope: 'channel' });
add('messages', 'delete', 'DELETE', msg, 'Delete one message.', { scope: 'channel' });
add('messages', 'bulk_delete', 'POST', `${channel}/messages/bulk-delete`, 'Delete 2–100 distinct messages younger than 14 days. Older messages must be deleted individually.', { body: fields({ messages: z.array(id).min(2).max(100).refine(ids => new Set(ids).size === ids.length, 'Message IDs must be unique.') }), scope: 'channel' });
add('messages', 'crosspost', 'POST', `${msg}/crosspost`, 'Publish an announcement message to followers.', { scope: 'channel' });
add('messages', 'pins', 'GET', `${channel}/messages/pins`, 'List pinned messages, paginated with before/limit.', { query: ['before', 'limit'], scope: 'channel' });
add('messages', 'pin', 'PUT', `${channel}/messages/pins/{message_id}`, 'Pin a message.', { scope: 'channel' });
add('messages', 'unpin', 'DELETE', `${channel}/messages/pins/{message_id}`, 'Unpin a message.', { scope: 'channel' });

add('reactions', 'add', 'PUT', `${msg}/reactions/{emoji}/@me`, 'React using a Unicode emoji or custom name:id; pass unescaped emoji.', { scope: 'channel' });
add('reactions', 'remove_own', 'DELETE', `${msg}/reactions/{emoji}/@me`, 'Remove the bot reaction.', { scope: 'channel' });
add('reactions', 'remove_user', 'DELETE', `${msg}/reactions/{emoji}/{user_id}`, 'Remove another user reaction.', { scope: 'channel' });
add('reactions', 'list', 'GET', `${msg}/reactions/{emoji}`, 'List users who reacted.', { query: ['after', 'limit', 'type'], scope: 'channel' });
add('reactions', 'clear', 'DELETE', `${msg}/reactions`, 'Remove all reactions from a message.', { scope: 'channel' });
add('reactions', 'clear_emoji', 'DELETE', `${msg}/reactions/{emoji}`, 'Remove all reactions for one emoji.', { scope: 'channel' });

add('threads', 'create', 'POST', `${channel}/threads`, 'Create a thread or forum/media post. A forum post uses {name,message:{content,...},applied_tags:[...]}.', { body: fields({ name: z.string().min(1).max(100) }), files: 'attachments', scope: 'channel' });
add('threads', 'from_message', 'POST', `${msg}/threads`, 'Start a thread from a message.', { body: fields({ name: z.string().min(1).max(100) }), scope: 'channel' });
add('threads', 'active', 'GET', `${guild}/threads/active`, 'List active threads visible to the bot.');
add('threads', 'archived_public', 'GET', `${channel}/threads/archived/public`, 'List archived public threads.', { query: ['before', 'limit'], scope: 'channel' });
add('threads', 'archived_private', 'GET', `${channel}/threads/archived/private`, 'List archived private threads.', { query: ['before', 'limit'], scope: 'channel' });
add('threads', 'archived_joined', 'GET', `${channel}/users/@me/threads/archived/private`, 'List joined archived private threads.', { query: ['before', 'limit'], scope: 'channel' });
add('threads', 'join', 'PUT', `${channel}/thread-members/@me`, 'Join a thread; channel_id is the thread ID.', { scope: 'channel' });
add('threads', 'leave', 'DELETE', `${channel}/thread-members/@me`, 'Leave a thread.', { scope: 'channel' });
add('threads', 'add_member', 'PUT', `${channel}/thread-members/{user_id}`, 'Add a thread member.', { scope: 'channel' });
add('threads', 'remove_member', 'DELETE', `${channel}/thread-members/{user_id}`, 'Remove a thread member.', { scope: 'channel' });
add('threads', 'members', 'GET', `${channel}/thread-members`, 'List thread members.', { query: ['with_member', 'after', 'limit'], scope: 'channel' });

add('members', 'list', 'GET', `${guild}/members`, 'List members, up to 1000; requires Server Members Intent. Paginate with after.', { query: ['limit', 'after'] });
add('members', 'get', 'GET', `${guild}/members/{user_id}`, 'Read a server member and assigned role IDs.');
add('members', 'search', 'GET', `${guild}/members/search`, 'Search members by username or nickname prefix using query.query.', { query: ['query', 'limit'] });
add('members', 'edit', 'PATCH', `${guild}/members/{user_id}`, 'Change nickname, roles, timeout (communication_disabled_until), mute/deaf or voice channel_id; null disconnects. Timeout is an ISO timestamp up to 28 days, null removes it.', { body: changes });
add('members', 'edit_me', 'PATCH', `${guild}/members/@me`, 'Change the bot server nickname, avatar or banner when supported.', { body: changes });
add('members', 'add_role', 'PUT', `${guild}/members/{user_id}/roles/{role_id}`, 'Assign a role below the bot highest role.');
add('members', 'remove_role', 'DELETE', `${guild}/members/{user_id}/roles/{role_id}`, 'Remove a member role.');
add('members', 'kick', 'DELETE', `${guild}/members/{user_id}`, 'Kick a member.');
add('members', 'prune_count', 'GET', `${guild}/prune`, 'Preview inactive members eligible for pruning.', { query: ['days', 'include_roles'] });
add('members', 'prune', 'POST', `${guild}/prune`, 'Remove inactive members; days and include_roles control eligibility.', { body: fields({ days: z.number().int().min(1).max(30).default(7) }) });

add('moderation', 'bans', 'GET', `${guild}/bans`, 'List server bans.', { query: ['limit', 'before', 'after'] });
add('moderation', 'ban_info', 'GET', `${guild}/bans/{user_id}`, 'Read a member ban.');
add('moderation', 'ban', 'PUT', `${guild}/bans/{user_id}`, 'Ban a user; optionally delete_message_seconds up to 604800 (7 days).', { body: fields({ delete_message_seconds: z.number().int().min(0).max(604800).optional() }).default({}) });
add('moderation', 'unban', 'DELETE', `${guild}/bans/{user_id}`, 'Unban a user.');
add('moderation', 'bulk_ban', 'POST', `${guild}/bulk-ban`, 'Ban up to 200 users. Returns banned_users and failed_users.', { body: fields({ user_ids: z.array(id).min(1).max(200), delete_message_seconds: z.number().int().min(0).max(604800).optional() }) });

add('roles', 'list', 'GET', `${guild}/roles`, 'List roles, positions and permissions.');
add('roles', 'get', 'GET', `${guild}/roles/{role_id}`, 'Read a role.');
add('roles', 'member_counts', 'GET', `${guild}/roles/member-counts`, 'Read member counts by role.');
add('roles', 'create', 'POST', `${guild}/roles`, 'Create a role: name, permissions string, colors, hoist, mentionable and icon.', { body: role });
add('roles', 'edit', 'PATCH', `${guild}/roles/{role_id}`, 'Edit role appearance and permissions; managed roles have restrictions.', { body: changes });
add('roles', 'reorder', 'PATCH', `${guild}/roles`, 'Reorder roles using [{id,position}], within the bot role hierarchy.', { body: z.array(fields({ id, position: z.number().int() })).min(1) });
add('roles', 'delete', 'DELETE', `${guild}/roles/{role_id}`, 'Delete a role.');

add('invites', 'guild_list', 'GET', `${guild}/invites`, 'List server invites.');
add('invites', 'channel_list', 'GET', `${channel}/invites`, 'List channel invites.', { scope: 'channel' });
add('invites', 'create', 'POST', `${channel}/invites`, 'Create an invite with max_age, max_uses, temporary or unique.', { body: fields({ max_age: z.number().int().min(0).max(604800).optional(), max_uses: z.number().int().min(0).max(100).optional() }).default({}), scope: 'channel' });
add('invites', 'get', 'GET', '/invites/{invite_code}', 'Read an invite.', { query: ['with_counts', 'with_expiration', 'guild_scheduled_event_id'], scope: 'invite' });
add('invites', 'delete', 'DELETE', '/invites/{invite_code}', 'Revoke an invite.', { scope: 'invite' });

add('webhooks', 'guild_list', 'GET', `${guild}/webhooks`, 'List server webhooks. Webhook tokens are redacted.');
add('webhooks', 'channel_list', 'GET', `${channel}/webhooks`, 'List channel webhooks.', { scope: 'channel' });
add('webhooks', 'create', 'POST', `${channel}/webhooks`, 'Create a webhook by name and optional avatar.', { body: fields({ name: z.string().min(1).max(80), avatar: image.nullable().optional() }), scope: 'channel' });
add('webhooks', 'get', 'GET', '/webhooks/{webhook_id}', 'Read a webhook using bot authentication.', { scope: 'webhook' });
add('webhooks', 'edit', 'PATCH', '/webhooks/{webhook_id}', 'Edit a webhook name, avatar or channel_id.', { body: changes, scope: 'webhook' });
add('webhooks', 'delete', 'DELETE', '/webhooks/{webhook_id}', 'Delete a webhook.', { scope: 'webhook' });
// Execution retrieves the webhook token internally; credentials never become MCP arguments/results.
add('webhooks', 'execute', 'POST', '/webhooks/{webhook_id}/$token', 'Send a webhook message; supports username/avatar_url overrides, embeds, components, files and thread_name.', { body: message, files: 'attachments', query: ['thread_id', 'with_components'], scope: 'webhook' });
add('webhooks', 'get_message', 'GET', '/webhooks/{webhook_id}/$token/messages/{message_id}', 'Read a webhook message.', { query: ['thread_id'], scope: 'webhook' });
add('webhooks', 'edit_message', 'PATCH', '/webhooks/{webhook_id}/$token/messages/{message_id}', 'Edit a webhook message.', { body: message, files: 'attachments', query: ['thread_id'], scope: 'webhook' });
add('webhooks', 'delete_message', 'DELETE', '/webhooks/{webhook_id}/$token/messages/{message_id}', 'Delete a webhook message.', { query: ['thread_id'], scope: 'webhook' });

add('emojis', 'list', 'GET', `${guild}/emojis`, 'List custom server emojis.');
add('emojis', 'get', 'GET', `${guild}/emojis/{emoji_id}`, 'Read a custom emoji.');
add('emojis', 'create', 'POST', `${guild}/emojis`, 'Upload a static/animated emoji, e.g. {name:"party",image:{$file:"party.gif"}}. Discord limit: 256 KiB.', { body: fields({ name: z.string().min(2).max(32), image, roles: z.array(id).optional() }) });
add('emojis', 'edit', 'PATCH', `${guild}/emojis/{emoji_id}`, 'Rename an emoji or restrict it to roles.', { body: changes });
add('emojis', 'delete', 'DELETE', `${guild}/emojis/{emoji_id}`, 'Delete a custom emoji.');
add('stickers', 'list', 'GET', `${guild}/stickers`, 'List server stickers.');
add('stickers', 'get', 'GET', `${guild}/stickers/{sticker_id}`, 'Read a server sticker.');
add('stickers', 'create', 'POST', `${guild}/stickers`, 'Upload exactly one sticker file (PNG/APNG/GIF/Lottie JSON) using files. body: name, description and tags.', { body: fields({ name: z.string().min(2).max(30), description: z.union([z.literal(''), z.string().min(2).max(100)]), tags: z.string().min(1).max(200) }), files: 'sticker' });
add('stickers', 'edit', 'PATCH', `${guild}/stickers/{sticker_id}`, 'Edit sticker name, description or tags.', { body: changes });
add('stickers', 'delete', 'DELETE', `${guild}/stickers/{sticker_id}`, 'Delete a server sticker.');

add('soundboard', 'defaults', 'GET', '/soundboard-default-sounds', 'List built-in Discord sounds.');
add('soundboard', 'list', 'GET', `${guild}/soundboard-sounds`, 'List custom soundboard sounds.');
add('soundboard', 'get', 'GET', `${guild}/soundboard-sounds/{sound_id}`, 'Read a custom sound.');
add('soundboard', 'create', 'POST', `${guild}/soundboard-sounds`, 'Upload MP3/OGG up to 512 KiB and 5.2 seconds. Example {name:"fart",sound:{$file:"fart.mp3",$kind:"audio"},volume:0.5}.', { body: fields({ name: z.string().min(2).max(32), sound: audio, volume: z.number().min(0).max(1).optional() }) });
add('soundboard', 'edit', 'PATCH', `${guild}/soundboard-sounds/{sound_id}`, 'Edit name, volume or emoji.', { body: changes });
add('soundboard', 'delete', 'DELETE', `${guild}/soundboard-sounds/{sound_id}`, 'Delete a custom sound.');
add('soundboard', 'play', 'POST', `${channel}/send-soundboard-sound`, 'Play a sound. Bot must join this voice channel with self_deaf=false and be able to SPEAK and USE_SOUNDBOARD.', { body: fields({ sound_id: soundId, source_guild_id: id.optional() }), scope: 'channel' });

const event = `${guild}/scheduled-events`;
add('events', 'list', 'GET', event, 'List scheduled server events.', { query: ['with_user_count'] });
add('events', 'get', 'GET', `${event}/{event_id}`, 'Read a scheduled event.', { query: ['with_user_count'] });
add('events', 'create', 'POST', event, 'Schedule a stage (1), voice (2) or external (3) event. External events need entity_metadata.location and scheduled_end_time; voice/stage need channel_id.', { body: fields({ name: z.string().min(1).max(100), scheduled_start_time: z.string().datetime({ offset: true }), privacy_level: z.literal(2), entity_type: z.union([z.literal(1), z.literal(2), z.literal(3)]) }) });
add('events', 'edit', 'PATCH', `${event}/{event_id}`, 'Edit an event, cover image or recurrence. status: active=2, completed=3, cancelled=4.', { body: changes });
add('events', 'delete', 'DELETE', `${event}/{event_id}`, 'Delete a scheduled event.');
add('events', 'users', 'GET', `${event}/{event_id}/users`, 'List subscribers to a scheduled event.', { query: ['limit', 'with_member', 'before', 'after'] });

const auto = `${guild}/auto-moderation/rules`;
add('automod', 'list', 'GET', auto, 'List AutoMod rules.');
add('automod', 'get', 'GET', `${auto}/{rule_id}`, 'Read an AutoMod rule.');
add('automod', 'create', 'POST', auto, 'Create keyword/spam/mention AutoMod with trigger_metadata, actions, exemptions and enabled. Consult discord_help for required fields.', { body: fields({ name: z.string().min(1).max(100), event_type: z.number().int(), trigger_type: z.number().int(), actions: z.array(object).min(1) }) });
add('automod', 'edit', 'PATCH', `${auto}/{rule_id}`, 'Edit AutoMod triggers, actions, exemptions or enabled state.', { body: changes });
add('automod', 'delete', 'DELETE', `${auto}/{rule_id}`, 'Delete an AutoMod rule.');

add('community', 'welcome_get', 'GET', `${guild}/welcome-screen`, 'Read the welcome screen.');
add('community', 'welcome_edit', 'PATCH', `${guild}/welcome-screen`, 'Edit description, welcome_channels and enabled.', { body: changes });
add('community', 'onboarding_get', 'GET', `${guild}/onboarding`, 'Read onboarding prompts and default channels.');
add('community', 'onboarding_edit', 'PUT', `${guild}/onboarding`, 'Set prompts, default_channel_ids, enabled and mode; Discord enforces community onboarding requirements.', { body: changes });
add('community', 'widget_get', 'GET', `${guild}/widget`, 'Read widget settings.');
add('community', 'widget_edit', 'PATCH', `${guild}/widget`, 'Edit public widget enabled/channel_id.', { body: changes });
add('community', 'widget_json', 'GET', `${guild}/widget.json`, 'Read the public widget payload.');
add('community', 'templates', 'GET', `${guild}/templates`, 'List server templates.');
add('community', 'template_create', 'POST', `${guild}/templates`, 'Create a reusable Discord server template.', { body: fields({ name: z.string().min(1).max(100), description: z.string().max(120).optional() }) });
add('community', 'template_sync', 'PUT', `${guild}/templates/{template_code}`, 'Sync a template to current server structure.');
add('community', 'template_edit', 'PATCH', `${guild}/templates/{template_code}`, 'Edit template metadata.', { body: changes });
add('community', 'template_delete', 'DELETE', `${guild}/templates/{template_code}`, 'Delete a server template.');

add('stage', 'get', 'GET', '/stage-instances/{channel_id}', 'Read a live stage instance.', { scope: 'channel' });
add('stage', 'create', 'POST', '/stage-instances', 'Start a stage with channel_id and topic.', { body: fields({ channel_id: id, topic: z.string().min(1).max(120) }), scope: 'stage' });
add('stage', 'edit', 'PATCH', '/stage-instances/{channel_id}', 'Edit stage topic and privacy settings.', { body: changes, scope: 'channel' });
add('stage', 'delete', 'DELETE', '/stage-instances/{channel_id}', 'End a stage instance.', { scope: 'channel' });
add('stage', 'voice_state_me', 'PATCH', `${guild}/voice-states/@me`, 'Request speaking or change bot stage suppression: channel_id, suppress, request_to_speak_timestamp.', { body: changes });
add('stage', 'voice_state_user', 'PATCH', `${guild}/voice-states/{user_id}`, 'Change a member stage suppression using channel_id and suppress.', { body: fields({ channel_id: id, suppress: z.boolean() }) });

add('polls', 'voters', 'GET', `${channel}/polls/{message_id}/answers/{answer_id}`, 'List voters for one answer.', { query: ['after', 'limit'], scope: 'channel' });
add('polls', 'end', 'POST', `${channel}/polls/{message_id}/expire`, 'End a poll created by the bot.', { scope: 'channel' });

const command = '/applications/{application_id}/guilds/{guild_id}/commands';
const globalCommand = '/applications/{application_id}/commands';
for (const [prefix, route] of [['guild', command], ['global', globalCommand]]) {
  const scope = prefix === 'global' ? 'global' as const : undefined;
  add('commands', `${prefix}_list`, 'GET', route, `List ${prefix} application commands. application_id defaults to the current bot application.`, { scope, query: ['with_localizations'] });
  add('commands', `${prefix}_create`, 'POST', route, 'Register a slash/user/message command. Registering a command does not implement its handler; use discord_gateway interactions and discord_interactions.', { scope, body: fields({ name: z.string().min(1).max(32) }) });
  add('commands', `${prefix}_edit`, 'PATCH', `${route}/{command_id}`, 'Edit an application command.', { scope, body: changes });
  add('commands', `${prefix}_delete`, 'DELETE', `${route}/{command_id}`, 'Delete an application command.', { scope });
  add('commands', `${prefix}_replace_all`, 'PUT', route, 'Replace the entire command list. Commands omitted from the array are deleted.', { scope, body: z.array(fields({ name: z.string().min(1).max(32) })) });
}

export const groups = [...new Set(operations.map(op => op.group))];
export function getOperation(group: string, action: string) {
  const operation = operations.find(op => op.group === group && op.action === action);
  if (!operation) throw new Error(`Unknown operation ${group}.${action}. Use discord_help.`);
  return operation;
}
export function routeParameters(operation: Operation) {
  return [...operation.route.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
}
