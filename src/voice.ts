import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { AudioPlayerStatus, VoiceConnectionStatus, NoSubscriberBehavior, StreamType,
  createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  type AudioPlayer, type VoiceConnection, generateDependencyReport } from '@discordjs/voice';
import type { DiscordService } from './discord.js';
import type { Gateway } from './gateway.js';

type Track = { path: string; name: string; volume: number };
type Session = { connection: VoiceConnection; player: AudioPlayer; queue: Track[]; current?: Track; process?: ChildProcess; lastError?: string };

export class Voice {
  private sessions = new Map<string, Session>();
  constructor(private readonly service: DiscordService, private readonly gateway: Gateway) {}

  async join(guildId: string, channelId: string, selfDeaf = false) {
    this.service.assertGuild(guildId);
    const client = await this.gateway.connect();
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isVoiceBased()) throw new Error('channel_id must be a voice or stage channel in this guild.');
    if (!channel.joinable) throw new Error('Bot cannot join this voice channel. Check Connect permission and user limit.');
    this.leave(guildId);
    const connection = joinVoiceChannel({ guildId, channelId, adapterCreator: guild.voiceAdapterCreator, selfDeaf, selfMute: false });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    const session: Session = { connection, player, queue: [] };
    this.sessions.set(guildId, session);
    connection.subscribe(player);
    connection.on('error', error => { session.lastError = error.message; });
    connection.on('stateChange', (_, state) => {
      if (state.status === VoiceConnectionStatus.Disconnected) {
        // Discord may reconnect after a move; stop stale sessions when recovery fails.
        void Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]).catch(() => { if (this.sessions.get(guildId) === session) this.leave(guildId); });
      }
    });
    player.on('error', error => { session.lastError = error.message; });
    player.on(AudioPlayerStatus.Idle, () => {
      session.process?.kill(); session.process = undefined; session.current = undefined;
      this.next(session);
    });
    try { await entersState(connection, VoiceConnectionStatus.Ready, 20_000); }
    catch (error) { this.leave(guildId); throw error; }
    return this.status(guildId);
  }

  private next(session: Session) {
    if (session.current || !session.queue.length) return;
    const track = session.queue.shift()!;
    session.current = track;
    const executable = ffmpeg as unknown as string | null;
    if (!executable) { session.lastError = 'FFmpeg is unavailable on this platform.'; session.current = undefined; return; }
    const process = spawn(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error',
      '-protocol_whitelist', 'file,pipe', '-i', track.path, '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    session.process = process;
    let diagnostic = '';
    process.stderr?.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-2000); });
    process.on('error', error => {
      session.lastError = error.message;
      session.player.stop(true);
    });
    process.on('exit', code => { if (code && session.process === process) session.lastError = diagnostic || `FFmpeg exited with code ${code}`; });
    const resource = createAudioResource(process.stdout!, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume?.setVolume(track.volume);
    session.player.play(resource);
  }

  async play(guildId: string, filename: string, volume: number, enqueue: boolean) {
    this.service.assertGuild(guildId);
    const session = this.requireSession(guildId);
    if (!/\.(mp3|wav|ogg|opus|flac|m4a|aac|webm|mp4)$/i.test(filename)) throw new Error('Unsupported local audio/video extension.');
    const file = await this.service.assets.resolve(filename, 100 * 1024 * 1024);
    const track = { path: file, name: path.basename(file), volume };
    if (!enqueue) this.stop(guildId);
    session.queue.push(track);
    this.next(session);
    return this.status(guildId);
  }
  private requireSession(guildId: string) {
    this.service.assertGuild(guildId);
    const session = this.sessions.get(guildId);
    if (!session) throw new Error('Join a voice channel with discord_voice first.');
    return session;
  }
  pause(guildId: string) { this.requireSession(guildId).player.pause(); return this.status(guildId); }
  resume(guildId: string) { this.requireSession(guildId).player.unpause(); return this.status(guildId); }
  skip(guildId: string) {
    const session = this.requireSession(guildId);
    session.player.stop(true);
    return this.status(guildId);
  }
  stop(guildId: string) {
    const session = this.requireSession(guildId);
    session.queue = [];
    session.process?.kill(); session.process = undefined;
    session.player.stop(true); session.current = undefined;
    return this.status(guildId);
  }
  leave(guildId: string) {
    this.service.assertGuild(guildId);
    const session = this.sessions.get(guildId);
    if (session) { this.stop(guildId); session.player.removeAllListeners(); session.connection.destroy(); this.sessions.delete(guildId); }
    return { ok: true };
  }
  status(guildId?: string) {
    if (guildId) this.service.assertGuild(guildId);
    return [...this.sessions].filter(([id]) => !guildId || id === guildId).map(([id, s]) => ({
      guild_id: id, channel_id: s.connection.joinConfig.channelId, connection: s.connection.state.status,
      player: s.player.state.status, current: s.current?.name ?? null, queue: s.queue.map(t => t.name), last_error: s.lastError,
    }));
  }
  dependencies() { return generateDependencyReport(); }
  close() { for (const guildId of [...this.sessions.keys()]) this.leave(guildId); }
}
