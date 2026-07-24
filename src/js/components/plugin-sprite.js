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
class PluginSprite extends Component {
  static get observedAttributes() {
    return ["image"];
  }

  connectedCallback() {
    this._render();
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

  _render() {
    if (!this.isConnected || !this._pluginId || !this._pluginService) return;
    const name = this.getAttribute("image");
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
