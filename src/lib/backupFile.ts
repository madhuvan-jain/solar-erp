// Backup files of any size. A backup is JSON: { app, version, format, appVersion, exportedAt, data, files }.
// The attachments ("files": id → data: URL) are written last, one per line, and read back one at a time, so a
// device with hundreds of MB of photos never builds (or parses) one giant string — browsers cap strings at ~512 MB.
import type { DataMap } from './store/types';

export interface BackupHead {
  app?: string; version?: number; format?: number; appVersion?: string; exportedAt?: string;
  /** document counters (device mode), so a restore never issues a number twice */
  counters?: Record<string, number>;
  /** staff accounts (device mode): name, email, mobile, role, access rights — no passwords */
  users?: unknown;
  data?: DataMap;
}

const MARKER = '\n,"files":{\n';

/** Builds the backup as a Blob from small parts. `files` yields [id, dataUrl] one at a time. */
export async function buildBackup(head: BackupHead, files: AsyncIterable<[string, string]> | Iterable<[string, string]>): Promise<Blob> {
  const parts: BlobPart[] = [];
  const top = JSON.stringify(head);
  parts.push(top.slice(0, -1)); // without the closing brace
  let n = 0;
  for await (const [id, url] of files as AsyncIterable<[string, string]>) {
    parts.push(new Blob([(n++ ? ',\n' : MARKER) + JSON.stringify(id) + ':' + JSON.stringify(url)]));
  }
  parts.push(n ? '\n}}' : '}');
  return new Blob(parts, { type: 'application/json' });
}

/** Reads a backup: the records at once, the attachments later, one by one (`eachFile`). Old backups work too. */
export async function openBackup(file: Blob, smallLimit = 150 * 1024 * 1024): Promise<{ head: BackupHead; fileCount: number; eachFile: (cb: (id: string, url: string) => Promise<void>) => Promise<number> }> {
  if (file.size <= smallLimit) {
    const all = JSON.parse(await file.text()) as BackupHead & { files?: Record<string, string> };
    const files = all.files && typeof all.files === 'object' ? all.files : {};
    delete all.files;
    return {
      head: all, fileCount: Object.keys(files).length,
      eachFile: async (cb) => { let n = 0; for (const [id, url] of Object.entries(files)) { if (typeof url === 'string') { await cb(id, url); n++; } } return n; },
    };
  }
  // Large: stream through the file in slices.
  const CHUNK = 8 * 1024 * 1024;
  const dec = new TextDecoder();
  let pos = 0, buf = '', headText = '';
  let filesAt = -1; // character offset in the decoded stream is not needed: we restart decoding for files
  // 1. The records: everything before the marker.
  while (pos < file.size) {
    buf += dec.decode(await file.slice(pos, pos + CHUNK).arrayBuffer(), { stream: true });
    pos += CHUNK;
    const at = buf.indexOf(MARKER);
    if (at >= 0) { headText = buf.slice(0, at) + '}'; filesAt = at; break; }
  }
  if (filesAt < 0) throw new Error('That backup file is damaged (attachments section not found).');
  const head = JSON.parse(headText) as BackupHead;
  return {
    head, fileCount: -1,
    eachFile: async (cb) => {
      const d = new TextDecoder();
      let p = 0, b = '', started = false, n = 0;
      const take = async (line: string) => {
        const t = line.replace(/,$/, '').trim();
        if (!t || t === '}}' || t === '}') return;
        const o = JSON.parse('{' + t + '}') as Record<string, string>;
        for (const [id, url] of Object.entries(o)) { await cb(id, url); n++; }
      };
      while (p < file.size) {
        b += d.decode(await file.slice(p, p + CHUNK).arrayBuffer(), { stream: true });
        p += CHUNK;
        if (!started) {
          const at = b.indexOf(MARKER);
          if (at < 0) continue;
          b = b.slice(at + MARKER.length);
          started = true;
        }
        let nl: number;
        while ((nl = b.indexOf('\n')) >= 0) { await take(b.slice(0, nl)); b = b.slice(nl + 1); }
      }
      if (started) await take(b);
      return n;
    },
  };
}

export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  const bin = atob(m[2]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m[1] });
}
