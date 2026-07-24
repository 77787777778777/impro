// Tracks plugin-supplied bitmap assets (see manifest.images), mirroring the
// lifecycle of PluginStylesLoader's font handling: the host fetches/validates
// the bytes and owns the resulting object URL, so a plugin never gets to
// author a raw url() string itself (pluginStylesLoader.js's CSS validator
// rejects those outright).
export class PluginAssetsLoader {
  constructor() {
    this._images = new Map(); // pluginId -> Map(name -> descriptor)
  }

  mountImages(pluginId, descriptors) {
    this.unmountImages(pluginId);
    const byName = new Map();
    for (const desc of descriptors) {
      byName.set(desc.name, {
        url: URL.createObjectURL(desc.blob),
        frameWidth: desc.frameWidth,
        frameHeight: desc.frameHeight,
        frameCount: desc.frameCount,
      });
    }
    this._images.set(pluginId, byName);
  }

  unmountImages(pluginId) {
    const byName = this._images.get(pluginId);
    if (!byName) return;
    for (const { url } of byName.values()) URL.revokeObjectURL(url);
    this._images.delete(pluginId);
  }

  get(pluginId, name) {
    return this._images.get(pluginId)?.get(name) ?? null;
  }
}
