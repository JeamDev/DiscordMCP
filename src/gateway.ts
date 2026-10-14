import { Client, GatewayIntentBits, Events, type Interaction, type RepliableInteraction, type PresenceData } from 'discord.js';
import type { DiscordService } from './discord.js';
import { sanitize } from './security.js';

type BufferedEvent = { sequence: number; time: string; type: string; guild_id?: string; data: unknown };
type PendingInteraction = { interaction: RepliableInteraction; expires: number; mode: 'reply' | 'update' };

export class Gateway {
  private client?: Client;
  private connecting?: Promise<Client>;
  private events: BufferedEvent[] = [];
  private sequence = 0;
  private pending = new Map<string, PendingInteraction>();
  private commandsEnabled = false;
  private lastError?: string;
  constructor(private readonly service: DiscordService) {}

  private record(type: string, data: unknown, guildId?: string) {
    if (this.service.config.allowedGuildIds.size && (!guildId || !this.service.config.allowedGuildIds.has(guildId))) return;
    const safe = sanitize(data, [this.service.config.token]);
    const serialized = JSON.stringify(safe);
    const bounded = serialized.length > 48_000 ? { truncated: true, preview: serialized.slice(0, 48_000), hint: 'Fetch the resource through a REST tool for full details.' } : safe;
    this.events.push({ sequence: ++this.sequence, time: new Date().toISOString(), type, guild_id: guildId, data: bounded });
    if (this.events.length > this.service.config.eventBufferSize) this.events.shift();
  }

  private pruneInteractions() {
    const now = Date.now();
    for (const [key, value] of this.pending) if (value.expires <= now) this.pending.delete(key);
    // Keep memory bounded even on a busy server.
    while (this.pending.size > 500) this.pending.delete(this.pending.keys().next().value!);
  }

  private async onInteraction(interaction: Interaction) {
    // Dedicated family worker owns these buttons/modals, avoiding duplicate acknowledgments.
    if ('customId' in interaction && typeof interaction.customId === 'string' && interaction.customId.startsWith('family:')) return;
    if (!this.commandsEnabled) return;
    if (this.service.config.allowedGuildIds.size && (!interaction.guildId || !this.service.config.allowedGuildIds.has(interaction.guildId))) return;
    try {
      if (interaction.isAutocomplete()) {
        await interaction.respond([]);
        return;
      }
      if (!interaction.isRepliable()) return;
      const update = interaction.isMessageComponent();
      if (update) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: 64 });
      this.pruneInteractions();
      this.pending.set(interaction.id, { interaction, expires: Date.now() + 14 * 60_000, mode: update ? 'update' : 'reply' });
      const data: Record<string, unknown> = {
        id: interaction.id, type: interaction.type, channel_id: interaction.channelId,
        user: { id: interaction.user.id, username: interaction.user.username },
        deferred: true, expires_in_seconds: 840,
      };
      if (interaction.isCommand()) data.command_name = interaction.commandName;
      if (interaction.isChatInputCommand()) data.options = interaction.options.data;
      if (interaction.isContextMenuCommand()) data.target_id = interaction.targetId;
      if (interaction.isMessageComponent()) data.custom_id = interaction.customId;
      if (interaction.isAnySelectMenu()) data.values = interaction.values;
      if (interaction.isModalSubmit()) data.fields = interaction.fields.fields.map(f => ({ custom_id: f.customId, value: 'value' in f ? f.value : undefined }));
      this.record('interaction_ready', data, interaction.guildId ?? undefined);
    } catch (error) {
      this.lastError = String(sanitize(error instanceof Error ? error.message : String(error), [this.service.config.token, interaction.token]));
    }
  }

  async connect(): Promise<Client> {
    if (this.client?.isReady()) return this.client;
    if (this.connecting) return this.connecting;
    if (!this.service.config.token) throw new Error('Configure DISCORD_BOT_TOKEN locally with npm run setup first.');
    this.connecting = (async () => {
      const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.GuildExpressions, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.AutoModerationConfiguration, GatewayIntentBits.AutoModerationExecution];
      if (this.service.config.messageContent) intents.push(GatewayIntentBits.MessageContent);
      if (this.service.config.guildMembers) intents.push(GatewayIntentBits.GuildMembers);
      const client = new Client({ intents });
      this.client = client;
      client.on(Events.Error, error => { this.lastError = String(sanitize(error.message, [this.service.config.token])); });
      client.on(Events.ShardError, error => { this.lastError = String(sanitize(error.message, [this.service.config.token])); });
      client.on(Events.Raw, packet => {
        if (!packet.t || packet.t === 'INTERACTION_CREATE' || packet.t === 'READY' || packet.t === 'RESUMED' || packet.t === 'VOICE_SERVER_UPDATE') return;
        const data = packet.d as Record<string, unknown>;
        const guildId = typeof data.guild_id === 'string' ? data.guild_id : packet.t.startsWith('GUILD_') && typeof data.id === 'string' ? data.id : undefined;
        this.record(packet.t, data, guildId);
      });
      client.on(Events.InteractionCreate, interaction => { void this.onInteraction(interaction); });
      let timer: NodeJS.Timeout | undefined;
      const ready = new Promise<Client>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Gateway connection timed out. Check token, network and enabled privileged intents.')), 25_000);
        client.once(Events.ClientReady, () => resolve(client));
      });
      try {
        // Await both so a rejected login cannot leave an unhandled ready timeout.
        await Promise.all([client.login(this.service.config.token), ready]);
        this.lastError = undefined;
        return client;
      } catch (error) {
        await client.destroy();
        this.client = undefined;
        throw error;
      } finally { clearTimeout(timer); }
    })();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }

  enableInteractions(enabled: boolean) { this.commandsEnabled = enabled; }

  status() {
    this.pruneInteractions();
    return {
      connected: this.client?.isReady() ?? false, bot_id: this.client?.user?.id,
      guilds: this.client ? [...this.client.guilds.cache.values()].filter(g => !this.service.config.allowedGuildIds.size || this.service.config.allowedGuildIds.has(g.id)).map(g => ({ id: g.id, name: g.name })) : [],
      latest_sequence: this.sequence, buffered_events: this.events.length,
      interactions_enabled: this.commandsEnabled, pending_interactions: this.pending.size,
      last_error: this.lastError,
    };
  }

  read(after = 0, limit = 50, types?: string[], guildId?: string) {
    if (guildId) this.service.assertGuild(guildId);
    const events = this.events.filter(e => e.sequence > after && (!types?.length || types.includes(e.type)) && (!guildId || e.guild_id === guildId)).slice(0, limit);
    return { events, next_cursor: events.at(-1)?.sequence ?? this.sequence, latest_sequence: this.sequence,
      dropped_before_cursor: this.events.length > 0 && after < this.events[0].sequence - 1 };
  }

  async presence(presence: PresenceData) {
    const client = await this.connect();
    client.user!.setPresence(presence);
    return { ok: true };
  }

  async interaction(action: 'reply' | 'followup' | 'delete_reply', interactionId: string, body?: Record<string, unknown>) {
    this.pruneInteractions();
    const item = this.pending.get(interactionId);
    if (!item) throw new Error('Interaction is unknown or expired. Enable Gateway interactions before invoking a command.');
    this.service.assertGuild(item.interaction.guildId);
    const payload = { ...body, allowedMentions: { parse: [] as never[], repliedUser: false } };
    // This tool uses discord.js camelCase response fields, documented in its schema.
    if (action === 'delete_reply') { await item.interaction.deleteReply(); return { ok: true }; }
    if (action === 'followup') return sanitize((await item.interaction.followUp(payload)).toJSON(), [this.service.config.token, item.interaction.token]);
    return sanitize((await item.interaction.editReply(payload)).toJSON(), [this.service.config.token, item.interaction.token]);
  }

  async close() {
    if (this.connecting) await this.connecting.catch(() => undefined);
    await this.client?.destroy();
    this.client = undefined;
    this.pending.clear();
  }
}
