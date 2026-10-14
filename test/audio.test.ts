import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { createAudioResource, StreamType } from '@discordjs/voice';

test('bundled FFmpeg and Opus encode actual audio frames without Discord credentials', { timeout: 15_000 }, async t => {
  const process = spawn(ffmpeg as unknown as string, ['-nostdin', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.12', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { process.kill(); });
  const closed = new Promise<number | null>((resolve, reject) => { process.once('error', reject); process.once('close', resolve); });
  const resource = createAudioResource(process.stdout!, { inputType: StreamType.Raw, inlineVolume: true });
  resource.volume!.setVolume(0.5);
  const packets: Buffer[] = [];
  for await (const packet of resource.playStream) packets.push(packet);
  assert.equal(await closed, 0);
  assert.ok(packets.length >= 5, 'At least five 20 ms Opus packets should be produced.');
  assert.ok(packets.every(packet => Buffer.isBuffer(packet) && packet.length > 0 && packet.length < 1500));
});
