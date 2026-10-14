import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const mime: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

export class Assets {
  constructor(readonly root: string) {}

  async resolve(filename: string, maxBytes = 25 * 1024 * 1024) {
    const root = await realpath(this.root);
    const target = await realpath(path.resolve(root, filename));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('Asset must be a file inside DISCORD_ASSET_DIR.');
    }
    const info = await stat(target);
    if (!info.isFile() || info.size > maxBytes) throw new Error(`Asset must be a regular file under ${maxBytes} bytes.`);
    return target;
  }

  async read(filename: string, maxBytes?: number) {
    return readFile(await this.resolve(filename, maxBytes));
  }

  async dataUri(filename: string, kind: 'image' | 'audio') {
    const contentType = mime[path.extname(filename).toLowerCase()];
    if (!contentType?.startsWith(`${kind}/`)) throw new Error(`Unsupported ${kind} file extension.`);
    const data = await this.read(filename, kind === 'image' ? 10 * 1024 * 1024 : 512 * 1024);
    return `data:${contentType};base64,${data.toString('base64')}`;
  }

  // File references keep base64 payloads out of MCP context. Example: {icon: {$file: "icon.png"}}.
  async expand(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(v => this.expand(v)));
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (typeof object.$file === 'string') {
        if (Object.keys(object).some(k => k !== '$file' && k !== '$kind')) throw new Error('File references only accept $file and $kind.');
        const kind = object.$kind ?? 'image';
        if (kind !== 'image' && kind !== 'audio') throw new Error('$kind must be image or audio.');
        return this.dataUri(object.$file, kind);
      }
      return Object.fromEntries(await Promise.all(Object.entries(object).map(async ([k, v]) => [k, await this.expand(v)])));
    }
    return value;
  }
}
