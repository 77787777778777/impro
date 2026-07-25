// Bridges a real, host-rendered <input type="file"> to a plugin's hostCall
// without ever pushing raw file bytes across the sandbox/postMessage
// boundary. A plugin-rendered <input type="file"> still becomes a real DOM
// node in the host's own document (see pluginRendering.js's normal
// VirtualEl -> DOM path) — so the *host* already has direct access to the
// picked File the moment its change event fires. This store lets the host
// hand the plugin only an opaque, single-use token standing in for that
// File; a subsequent hostCall (e.g. registerCustomImage) redeems the token
// for the actual bytes, read host-side.
const MAX_STAGED_PER_PLUGIN = 5;
const STAGE_TTL_MS = 5 * 60 * 1000;

export class PluginFileStaging {
  constructor(now = () => Date.now()) {
    this._now = now;
    this._byPlugin = new Map(); // pluginId -> Map<token, {file, expiresAt}>
    this._tokenCounter = 0;
  }

  stage(pluginId, file) {
    this._evictExpired(pluginId);
    let staged = this._byPlugin.get(pluginId);
    if (!staged) {
      staged = new Map();
      this._byPlugin.set(pluginId, staged);
    }
    if (staged.size >= MAX_STAGED_PER_PLUGIN) {
      // Evict the oldest entry (Maps iterate in insertion order) to make
      // room, rather than growing unbounded for a plugin that stages files
      // faster than it redeems them.
      const oldestToken = staged.keys().next().value;
      staged.delete(oldestToken);
    }
    const token = `${pluginId}:${this._tokenCounter++}`;
    staged.set(token, { file, expiresAt: this._now() + STAGE_TTL_MS });
    return token;
  }

  // Consumes the token on read — a token is only ever redeemable once.
  take(pluginId, token) {
    const staged = this._byPlugin.get(pluginId);
    if (!staged) return null;
    const entry = staged.get(token);
    if (!entry) return null;
    staged.delete(token);
    if (entry.expiresAt < this._now()) return null;
    return entry.file;
  }

  _evictExpired(pluginId) {
    const staged = this._byPlugin.get(pluginId);
    if (!staged) return;
    const now = this._now();
    for (const [token, entry] of staged) {
      if (entry.expiresAt < now) staged.delete(token);
    }
  }
}
