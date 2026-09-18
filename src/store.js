import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const EMPTY = () => ({
  version: 1,
  members: [],
  pods: [],
  meetups: [],
  nudges: [],
  interactions: [], // {kind:'co-attend'|'one-on-one'|'message', a, b, at}
  blocks: [], // {by, target}
  reports: [],
  createdAt: new Date().toISOString(),
});

export class Store {
  constructor(filePath = config.dbPath) {
    this.filePath = filePath;
    this.data = EMPTY();
    this._writing = null;
  }

  static async open(filePath) {
    const s = new Store(filePath);
    await s.load();
    return s;
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      this.data = { ...EMPTY(), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.data = EMPTY();
      await this.save();
    }
    return this.data;
  }

  /** Atomic write: temp file + rename, so a crash can't truncate the db. */
  async save() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fsp.rename(tmp, this.filePath);
  }

  /** Serialises mutations so concurrent requests can't interleave writes. */
  async mutate(fn) {
    const run = async () => {
      const result = await fn(this.data);
      await this.save();
      return result;
    };
    this._writing = (this._writing || Promise.resolve()).then(run, run);
    return this._writing;
  }

  reset() {
    this.data = EMPTY();
  }

  member(id) {
    return this.data.members.find((m) => m.id === id) || null;
  }

  pod(id) {
    return this.data.pods.find((p) => p.id === id) || null;
  }

  activePods() {
    return this.data.pods.filter((p) => (p.status || 'active') === 'active');
  }

  podOf(memberId) {
    return this.activePods().find((p) => p.memberIds.includes(memberId)) || null;
  }

  /** Members with no *active* pod. A dissolved pod releases its members back
   *  into the pool, which is what makes a block recoverable rather than final. */
  unpodded() {
    const claimed = new Set(this.activePods().flatMap((p) => p.memberIds));
    return this.data.members.filter((m) => !claimed.has(m.id) && m.status === 'active');
  }
}

export function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function existsSyncDb(filePath = config.dbPath) {
  return fs.existsSync(filePath);
}
