import { Component } from "/js/components/component.js";

// Renders a frame of a plugin-declared spritesheet (manifest.json "images").
//
// Unlike plugin-blob-image (whose did/cid pair resolves to a *public* CDN URL
// valid for any caller), the object URL backing a sprite is private per-plugin
// state — it isn't derivable from the "image" attribute alone. So this
// element can't validate an attribute pattern the way plugin-blob-image does;
// it must be told which plugin owns it by the host renderer via JS
// properties (pluginId/pluginService), never a plugin-suppliable attribute,
// or one plugin could spoof another's plugin-id and read its assets.
// Live elements currently showing a given (pluginId, name) pair, so a host
// asset-map mutation for a name that's already on screen (e.g. a custom
// image overriding a built-in one, see pluginCustomImages.js) can force a
// re-render — without this, an already-mounted element whose "image"
// attribute value never changes (the common case: a plugin re-rendering
// the same name every tick) would never notice the underlying asset
// changed, since attributeChangedCallback only fires on an actual value
// change. Keyed by a plain string rather than nesting Maps since entries
// churn per element connect/disconnect, not per plugin.
const registry = new Map(); // "pluginId::name" -> Set<PluginSprite>

function registryKey(pluginId, name) {
  return `${pluginId}::${name}`;
}

class PluginSprite extends Component {
  static get observedAttributes() {
    return ["image"];
  }

  // Called by pluginService.js after registerCustomImage/deleteCustomImage
  // mounts or unmounts an image for `name`, so every already-connected
  // sprite currently showing it picks up the change immediately.
  static invalidate(pluginId, name) {
    for (const el of registry.get(registryKey(pluginId, name)) ?? []) {
      el._render();
    }
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() {
    this._unregister();
  }

  attributeChangedCallback() {
    this._render();
  }

  set pluginId(value) {
    this._pluginId = value;
    this._render();
  }

  get pluginId() {
    return this._pluginId;
  }

  set pluginService(value) {
    this._pluginService = value;
    this._render();
  }

  get pluginService() {
    return this._pluginService;
  }

  _unregister() {
    if (!this._registryKey) return;
    const set = registry.get(this._registryKey);
    if (set) {
      set.delete(this);
      if (set.size === 0) registry.delete(this._registryKey);
    }
    this._registryKey = null;
  }

  _render() {
    if (!this.isConnected || !this._pluginId || !this._pluginService) return;
    const name = this.getAttribute("image");
    const nextKey = name ? registryKey(this._pluginId, name) : null;
    if (nextKey !== this._registryKey) {
      this._unregister();
      if (nextKey) {
        let set = registry.get(nextKey);
        if (!set) {
          set = new Set();
          registry.set(nextKey, set);
        }
        set.add(this);
        this._registryKey = nextKey;
      }
    }
    const info = name
      ? this._pluginService.getPluginImageInfo(this._pluginId, name)
      : null;
    if (!info) {
      this.style.backgroundImage = "";
      this.style.width = "";
      this.style.height = "";
      return;
    }
    const { url, frameWidth, frameHeight, frameCount } = info;
    this.style.backgroundImage = `url(${JSON.stringify(url)})`;
    this.style.backgroundRepeat = "no-repeat";
    this.style.backgroundSize = `${frameWidth * frameCount}px ${frameHeight}px`;
    this.style.width = `${frameWidth}px`;
    this.style.height = `${frameHeight}px`;
    this.style.display = "inline-block";
  }
}

PluginSprite.register();

export { PluginSprite };
