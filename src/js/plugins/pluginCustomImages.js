import { validateSpritesheetImage } from "/js/plugins/sourceProvider.js";

const DB_NAME = "impro-plugin-custom-images";
const STORE_NAME = "images";
const MAX_IMAGES_PER_PLUGIN = 20;
const MAX_TOTAL_BYTES_PER_PLUGIN = 20 * 1024 * 1024;
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function makeKey(pluginId, name) {
  return `${pluginId}::${name}`;
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

// Exported so callers (e.g. pluginService.js's registerCustomImage host
// method) can shape the same public summary from a record without a second
// store round-trip after register()/loadDescriptorsForMount().
export function toPublicDescriptor(record) {
  return {
    name: record.name,
    frameWidth: record.frameWidth,
    frameHeight: record.frameHeight,
    frameCount: record.frameCount,
    size: record.size,
  };
}

// Real backing store: one IndexedDB object store holding every plugin's
// custom images, keyed by a composite "pluginId::name" string (mirrors
// drafts.js's KVIndexedDB pattern). Per-plugin counts here are small (see
// MAX_IMAGES_PER_PLUGIN), so a full-store scan filtered client-side is
// simpler than key-range plumbing and plenty fast. Deliberately local-only
// (not synced via loadData/saveData's AT-proto preferences record, and not
// wired through this project's node-based unit test environment, which has
// no indexedDB) — see PluginCustomImages below for the injectable seam that
// keeps this swappable in tests.
class IndexedDbCustomImageStore {
  constructor(dbName = DB_NAME, storeName = STORE_NAME) {
    this._dbName = dbName;
    this._storeName = storeName;
    this._dbPromise = null;
  }

  async _open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this._storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this._dbPromise;
  }

  async _request(mode, callback) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this._storeName, mode);
      const request = callback(transaction.objectStore(this._storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async list(pluginId) {
    const all = await this._request("readonly", (store) => store.getAll());
    return (all ?? []).filter((record) => record.pluginId === pluginId);
  }

  async put(pluginId, name, record) {
    await this._request("readwrite", (store) =>
      store.put(record, makeKey(pluginId, name)),
    );
  }

  async remove(pluginId, name) {
    await this._request("readwrite", (store) =>
      store.delete(makeKey(pluginId, name)),
    );
  }
}

// User-uploaded spritesheet images, stored locally per plugin. Complements
// manifest.images (bundled into a plugin's own repo at publish time) with a
// runtime path: a plugin renders a real <input type="file"> (see
// pluginRendering.js/pluginFileStaging.js), the host reads the picked File
// directly, and this class validates it with the exact same rules as
// bundled images (validateSpritesheetImage, from sourceProvider.js) before
// persisting it — so PluginAssetsLoader can mount a custom image the same
// way it mounts a bundled one, and <plugin-sprite> needs no changes at all.
export class PluginCustomImages {
  constructor({
    store = new IndexedDbCustomImageStore(),
    validateImage = validateSpritesheetImage,
  } = {}) {
    this._store = store;
    this._validateImage = validateImage;
  }

  async list(pluginId) {
    const records = await this._store.list(pluginId);
    return records
      .map(toPublicDescriptor)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // A name may collide with a bundled manifest.images entry — that's
  // allowed on purpose, so a user can replace a built-in animation with
  // their own upload (see pluginAssetsLoader.js's mountCustomImage, which
  // mounts into the same per-plugin map bundled images use, last write
  // wins). pluginService.js's deleteCustomImage handler is what restores
  // the bundled original when such an override is later deleted.
  async register(
    pluginId,
    { name, frameWidth, frameHeight, frameCount },
    bytes,
  ) {
    if (typeof name !== "string" || !NAME_RE.test(name)) {
      throw new Error(
        'Image name must be 1-64 characters of letters, numbers, "_", or "-"',
      );
    }
    if (
      !isPositiveInt(frameWidth) ||
      !isPositiveInt(frameHeight) ||
      !isPositiveInt(frameCount)
    ) {
      throw new Error(
        "frameWidth, frameHeight, and frameCount must be positive integers",
      );
    }
    const existing = await this.list(pluginId);
    const replacing = existing.find((entry) => entry.name === name);
    const otherCount = existing.length - (replacing ? 1 : 0);
    if (otherCount >= MAX_IMAGES_PER_PLUGIN) {
      throw new Error(
        `This plugin already has the maximum of ${MAX_IMAGES_PER_PLUGIN} custom images`,
      );
    }
    const otherBytes = existing.reduce(
      (sum, entry) => sum + (entry.name === name ? 0 : entry.size),
      0,
    );
    if (otherBytes + bytes.byteLength > MAX_TOTAL_BYTES_PER_PLUGIN) {
      throw new Error(
        `This plugin's custom images would exceed the ${MAX_TOTAL_BYTES_PER_PLUGIN}-byte limit`,
      );
    }
    const blob = await this._validateImage(
      bytes,
      { frameWidth, frameHeight, frameCount },
      name,
    );
    const record = {
      pluginId,
      name,
      blob,
      frameWidth,
      frameHeight,
      frameCount,
      size: blob.size,
      createdAt: new Date().toISOString(),
    };
    await this._store.put(pluginId, name, record);
    // Returns the full record (including the blob) so the caller can mount
    // it into PluginAssetsLoader without a second store round-trip; strip
    // the blob (toPublicDescriptor) before this ever reaches the plugin.
    return record;
  }

  async delete(pluginId, name) {
    await this._store.remove(pluginId, name);
  }

  // Descriptors shaped for PluginAssetsLoader.mountCustomImage — includes
  // the blob, unlike list()'s public-facing summaries.
  async loadDescriptorsForMount(pluginId) {
    const records = await this._store.list(pluginId);
    return records.map((record) => ({
      name: record.name,
      blob: record.blob,
      frameWidth: record.frameWidth,
      frameHeight: record.frameHeight,
      frameCount: record.frameCount,
    }));
  }

  async purgeForPlugin(pluginId) {
    const records = await this._store.list(pluginId);
    await Promise.all(
      records.map((record) => this._store.remove(pluginId, record.name)),
    );
  }
}
