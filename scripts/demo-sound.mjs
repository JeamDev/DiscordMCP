import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

// Procedurally generated demo; no downloaded samples or third-party audio.
const directory = new URL('../assets/', import.meta.url);
await mkdir(directory, { recursive: true });
const rate = 48000;
const duration = 1.6;
const samples = Math.floor(rate * duration);
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
let seed = 17, phase = 0, smoothNoise = 0;
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  smoothNoise = 0.8 * smoothNoise + 0.2 * ((seed / 0xffffffff) * 2 - 1);
  phase += (85 - 24 * t + 13 * Math.sin(t * 29)) / rate;
  const buzz = 2 * (phase % 1) - 1;
  const sputter = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 43 + Math.sin(t * 17)), 2);
  const envelope = Math.min(1, t / 0.04) * Math.pow(Math.max(0, 1 - t / duration), 0.8);
  const value = envelope * sputter * (0.2 * buzz + 0.6 * smoothNoise);
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 24000), 44 + i * 2);
}
const wavPath = fileURLToPath(new URL('fart.wav', directory));
const mp3Path = fileURLToPath(new URL('fart.mp3', directory));
await writeFile(wavPath, wav);
const encoder = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '96k', mp3Path], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let error = '';
encoder.stderr.on('data', chunk => { error += String(chunk); });
const code = await new Promise((resolve, reject) => { encoder.once('error', reject); encoder.once('close', resolve); });
if (code !== 0) throw new Error(error || `FFmpeg exited ${code}`);
console.log(`Generated demo sound: ${mp3Path} (${duration}s)`);
