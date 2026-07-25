// Test plugin fixture

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginWorkerPath = path.resolve(
  __dirname,
  "..",
  "..",
  "impro-plugin",
  "main.js",
);

export const TEST_PLUGIN_BASE_ID = "test-plugin";
export const TEST_PLUGIN_ID = `${TEST_PLUGIN_BASE_ID}__LOCAL`;
export const TEST_PLUGIN_NAME = "Test Plugin";

export const TEST_PLUGIN_DEFAULTS = {
  greeting: "Hi",
  loud: false,
  theme: "light",
};

// Manifest as served by the local plugin endpoint — matches the on-disk
// format, where the id has no __LOCAL suffix (the runtime appends it).
export const TEST_PLUGIN_RAW_MANIFEST = {
  id: TEST_PLUGIN_BASE_ID,
  name: TEST_PLUGIN_NAME,
  version: "1.0.0",
  author: "Test Author",
  description: "A test fixture plugin",
};

// Manifest as it appears in installed-plugin preferences and at runtime.
export const TEST_PLUGIN_MANIFEST = {
  ...TEST_PLUGIN_RAW_MANIFEST,
  id: TEST_PLUGIN_ID,
};

const TEST_PLUGIN_BODY = /* js */ `
const DEFAULTS = ${JSON.stringify(TEST_PLUGIN_DEFAULTS)};

class TestSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName(${JSON.stringify(TEST_PLUGIN_NAME)});
  }

  display() {
    new Setting(this.containerEl)
      .setName("Greeting")
      .setDesc("Text shown to the user")
      .addText((text) =>
        text
          .setPlaceholder("Hi")
          .setValue(this.plugin.settings.greeting)
          .onChange(async (value) => {
            this.plugin.settings.greeting = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(this.containerEl)
      .setName("Loud mode")
      .setDesc("Whether to be loud")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.loud)
          .onChange(async (value) => {
            this.plugin.settings.loud = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(this.containerEl)
      .setName("Theme")
      .setDesc("Preferred theme")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ light: "Light", dark: "Dark", auto: "Auto" })
          .setValue(this.plugin.settings.theme)
          .onChange(async (value) => {
            this.plugin.settings.theme = value;
            await this.plugin.saveData(this.plugin.settings);
          }),
      );

    new Setting(this.containerEl)
      .setName("Reset settings")
      .setDesc("Restore defaults")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings = { ...DEFAULTS };
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
  }
}

class TestPlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULTS, ...(saved ?? {}) };
    this.addSettingTab(new TestSettingTab());
  }
}

TestPlugin.register();
`;

// Message a plugin throws from display(); exported so the error-path test can
// assert the surfaced copy without duplicating the string.
export const TAB_LOAD_ERROR_MESSAGE = "Settings failed to load";

// A plugin whose setting tab throws while rendering, to exercise the detail
// view's tab-load error path.
const THROWING_TAB_PLUGIN_BODY = /* js */ `
class ThrowingSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName(${JSON.stringify(TEST_PLUGIN_NAME)});
  }

  display() {
    throw new Error(${JSON.stringify(TAB_LOAD_ERROR_MESSAGE)});
  }
}

class TestPlugin extends Plugin {
  async onload() {
    this.addSettingTab(new ThrowingSettingTab());
  }
}

TestPlugin.register();
`;

// A plugin that loads but registers no setting tab.
const NO_SETTINGS_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {}
}

TestPlugin.register();
`;

// A plugin that seeds the composer with a signature string on every open
// (post and reply). Used by composer-init e2e tests.
const POST_COMPOSER_INIT_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    this.app.on("post-composer-open", (composer, context) => {
      composer.appendText("\\n\\n— from test plugin (" + context.kind + ")");
      composer.setCursor(0);
    });
  }
}

TestPlugin.register();
`;

// Fixture for the persistent "overlay" slot + manifest.images/createSprite
// (see plugins.md's "Images"/"Persistent overlay" sections). Matches
// tests/e2e/fixtures/test-sprite.png's real dimensions (128x128 frames, 15
// frames in a single 1920x128 row).
export const OVERLAY_SPRITE_IMAGE_NAME = "idle_breathe";
export const OVERLAY_SPRITE_FRAME_WIDTH = 128;
export const OVERLAY_SPRITE_FRAME_HEIGHT = 128;
export const OVERLAY_SPRITE_FRAME_COUNT = 15;

// Reuses TEST_PLUGIN_BASE_ID/TEST_PLUGIN_ID rather than inventing a new id,
// since mockServer.js's local-plugin routes (manifest.json/main.js/assets)
// are hardcoded to serve whatever is configured for that one fixed id.

// Manifest as served by the local plugin endpoint (raw form, no __LOCAL
// suffix — the runtime appends it), granting the "overlay" ui permission.
export const OVERLAY_PLUGIN_RAW_MANIFEST = {
  id: TEST_PLUGIN_BASE_ID,
  name: "Overlay Test Plugin",
  version: "1.0.0",
  author: "Test Author",
  description: "A test fixture plugin for the persistent overlay slot",
  permissions: { ui: ["overlay"] },
  images: [
    {
      name: OVERLAY_SPRITE_IMAGE_NAME,
      file: "assets/test-sprite.png",
      frameWidth: OVERLAY_SPRITE_FRAME_WIDTH,
      frameHeight: OVERLAY_SPRITE_FRAME_HEIGHT,
      frameCount: OVERLAY_SPRITE_FRAME_COUNT,
    },
  ],
};

// Same manifest, but without the "overlay" ui permission — used to verify
// registration is silently refused.
export const OVERLAY_PLUGIN_RAW_MANIFEST_NO_PERMISSION = {
  ...OVERLAY_PLUGIN_RAW_MANIFEST,
  permissions: {},
};

export const OVERLAY_PLUGIN_MANIFEST = {
  ...OVERLAY_PLUGIN_RAW_MANIFEST,
  id: TEST_PLUGIN_ID,
};

const OVERLAY_SPRITE_PLUGIN_BODY = /* js */ `
class TestSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName("Overlay Test Plugin");
  }
  display() {}
}

class TestPlugin extends Plugin {
  async onload() {
    // A settings tab with no meaningful content — its only purpose in this
    // fixture is to give e2e tests a reliable "onload() finished" signal
    // (the settings link appearing) independent of whether the overlay slot
    // registration itself succeeded or was refused for lacking permission.
    this.addSettingTab(new TestSettingTab());
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass("test-overlay-root");
      el.createSprite((sprite) => sprite.setImage(${JSON.stringify(OVERLAY_SPRITE_IMAGE_NAME)}));
      return el;
    });
  }
}

TestPlugin.register();
`;

export function getOverlaySpritePluginSource() {
  return getWorkerSource() + "\n" + OVERLAY_SPRITE_PLUGIN_BODY;
}

// Fixture for the one-way broadcast events (post-liked/post-unliked/etc.,
// see plugins.md's "Reacting to app activity" section) and refreshSlot:
// listens for "post-liked" and toggles a class + records the payload,
// re-rendering via refreshSlot rather than waiting for a context change.
const OVERLAY_REACTIVE_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    this._reacted = false;
    this._lastLikedUri = null;
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass(this._reacted ? "test-overlay-reacted" : "test-overlay-idle");
      if (this._lastLikedUri) el.setAttr("data-liked-uri", this._lastLikedUri);
      el.createSprite((sprite) => sprite.setImage(${JSON.stringify(OVERLAY_SPRITE_IMAGE_NAME)}));
      return el;
    });
    this.app.on("post-liked", ({ uri }) => {
      this._reacted = true;
      this._lastLikedUri = uri;
      this.refreshSlot("overlay");
    });
  }
}

TestPlugin.register();
`;

export function getOverlayReactivePluginSource() {
  return getWorkerSource() + "\n" + OVERLAY_REACTIVE_PLUGIN_BODY;
}

// Fixture for the "feed-refreshed" broadcast event: records the most recent
// payload as JSON on the overlay root's dataset, re-rendering via
// refreshSlot the same way OVERLAY_REACTIVE_PLUGIN_BODY does for
// post-liked.
const FEED_REFRESHED_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    this._lastPayload = null;
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass("test-feed-refreshed-root");
      el.setAttr("data-payload", JSON.stringify(this._lastPayload));
      el.createSprite((sprite) => sprite.setImage(${JSON.stringify(OVERLAY_SPRITE_IMAGE_NAME)}));
      return el;
    });
    this.app.on("feed-refreshed", (payload) => {
      this._lastPayload = payload;
      this.refreshSlot("overlay");
    });
  }
}

TestPlugin.register();
`;

export function getFeedRefreshedPluginSource() {
  return getWorkerSource() + "\n" + FEED_REFRESHED_PLUGIN_BODY;
}

// Fixture for this.app.data.getLandmarkRects() (see plugins.md's "UI
// geometry" section): fetches the snapshot on load and renders each
// landmark's rect (or "null") as data attributes so an e2e test can assert
// on them via the DOM without needing an RPC bridge back out of the plugin.
const OVERLAY_LANDMARKS_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    const { viewport, landmarks } = await this.app.data.getLandmarkRects();
    this._viewport = viewport;
    this._landmarks = landmarks;
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass("test-landmarks-root");
      el.setAttr("data-viewport", JSON.stringify(this._viewport));
      for (const [name, rect] of Object.entries(this._landmarks)) {
        el.setAttr("data-landmark-" + name, JSON.stringify(rect));
      }
      return el;
    });
  }
}

TestPlugin.register();
`;

export function getOverlayLandmarksPluginSource() {
  return getWorkerSource() + "\n" + OVERLAY_LANDMARKS_PLUGIN_BODY;
}

// Fixture proving a user-action event's optional "position" field (see
// plugins.md's "Reacting to app activity") carries the real, measured
// click position through to the plugin, rather than being lost or always
// undefined — renders it as a data attribute so the e2e test can compare
// it against the real button's on-screen bounding box.
const OVERLAY_POSITION_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    this._position = null;
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass("test-position-root");
      el.setAttr("data-position", JSON.stringify(this._position));
      return el;
    });
    this.app.on("post-liked", ({ position }) => {
      this._position = position ?? null;
      this.refreshSlot("overlay");
    });
  }
}

TestPlugin.register();
`;

export function getOverlayPositionPluginSource() {
  return getWorkerSource() + "\n" + OVERLAY_POSITION_PLUGIN_BODY;
}

// Fixture for this.app.data.prefersReducedMotion() (see plugins.md):
// mirrors buddy's actual movement-tick shape (a rescheduled async tick
// checking this on every iteration) to prove it resolves correctly in a
// real Worker, rather than throwing "window is not defined" the way a
// plugin calling window.matchMedia directly once did — which, with no
// error handling around the reschedule, permanently froze the tick loop.
const OVERLAY_REDUCED_MOTION_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    this._tickCount = 0;
    this._reducedMotion = null;
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass("test-reduced-motion-root");
      el.setAttr("data-reduced-motion", String(this._reducedMotion));
      el.setAttr("data-tick-count", String(this._tickCount));
      return el;
    });
    this._scheduleTick();
  }
  _scheduleTick() {
    setTimeout(async () => {
      this._reducedMotion = await this.app.data.prefersReducedMotion();
      this._tickCount += 1;
      this.refreshSlot("overlay");
      this._scheduleTick();
    }, 200);
  }
}

TestPlugin.register();
`;

export function getOverlayReducedMotionPluginSource() {
  return getWorkerSource() + "\n" + OVERLAY_REDUCED_MOTION_PLUGIN_BODY;
}

// Fixture for the replaceChildren fix (plugin-slot.js): moves position via
// an inline CSS transition on "post-liked" (should animate smoothly, since
// the DOM node must persist across refreshSlot for a transition to have a
// "previous value" to interpolate from) and jumps instantly via
// transition:none on "post-reposted" (the deliberate teleport-style
// exception). Position/transition are both set inline so this fixture
// needs no separate styles.css route.
const OVERLAY_MOVEMENT_PLUGIN_BODY = /* js */ `
class TestPlugin extends Plugin {
  async onload() {
    this._x = 10;
    this._instant = false;
    this.registerSlot("overlay", () => {
      const el = new VirtualEl("div");
      el.addClass("test-movement-root");
      el.setStyle("transition", this._instant ? "none" : "transform 2s linear");
      el.setStyle("transform", "translateX(" + this._x + "px)");
      return el;
    });
    this.app.on("post-liked", () => {
      this._x += 300;
      this._instant = false;
      this.refreshSlot("overlay");
    });
    this.app.on("post-reposted", () => {
      this._x += 300;
      this._instant = true;
      this.refreshSlot("overlay");
    });
  }
}

TestPlugin.register();
`;

export function getOverlayMovementPluginSource() {
  return getWorkerSource() + "\n" + OVERLAY_MOVEMENT_PLUGIN_BODY;
}

// Fixture for the user-configured-endpoint network capability
// (pluginConfiguredFetch.js / app.configuredEndpoint): renders buttons
// (rather than an overlay slot, which is position:fixed;pointer-events:none
// and not meant to be clicked into) inside a settings tab so a real
// Playwright click can drive requestUrl()/fetch() directly and the test can
// intercept the resulting network calls via page.route().
export const CONFIGURED_FETCH_TEST_URL =
  "https://fake-llm.test/v1/chat/completions";
export const CONFIGURED_FETCH_OTHER_URL =
  "https://other-host.test/v1/chat/completions";

export const CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST = {
  id: TEST_PLUGIN_BASE_ID,
  name: "Configured Fetch Test Plugin",
  version: "1.0.0",
  author: "Test Author",
  description: "A test fixture plugin for the configured-endpoint fetch API",
  permissions: { network: ["configuredEndpoint"] },
};

export const CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST_NO_PERMISSION = {
  ...CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST,
  permissions: {},
};

export const CONFIGURED_FETCH_PLUGIN_MANIFEST = {
  ...CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST,
  id: TEST_PLUGIN_ID,
};

function configuredFetchPluginBody({
  url = CONFIGURED_FETCH_TEST_URL,
  otherUrl = CONFIGURED_FETCH_OTHER_URL,
  badUrl = "http://example.com/v1",
} = {}) {
  return /* js */ `
class TestSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName("Configured Fetch Test Plugin");
  }
  display() {
    const el = this.containerEl;
    el.addClass("test-configured-fetch-root");
    el.setAttr("data-request-result", JSON.stringify(this.plugin._requestResult ?? null));
    el.setAttr("data-request-error", this.plugin._requestError ?? "");
    el.setAttr("data-fetch-result", JSON.stringify(this.plugin._fetchResult ?? null));
    el.setAttr("data-fetch-error", this.plugin._fetchError ?? "");
    el.createEl("button", { cls: "test-request-url-button", text: "Request URL" }).onClick(async () => {
      try {
        this.plugin._requestResult = await this.plugin.app.configuredEndpoint.requestUrl(
          ${JSON.stringify(url)},
        );
        this.plugin._requestError = null;
      } catch (e) {
        this.plugin._requestError = e.message;
        this.plugin._requestResult = null;
      }
      this.refresh();
    });
    el.createEl("button", { cls: "test-request-bad-url-button", text: "Request bad URL" }).onClick(async () => {
      try {
        this.plugin._requestResult = await this.plugin.app.configuredEndpoint.requestUrl(
          ${JSON.stringify(badUrl)},
        );
        this.plugin._requestError = null;
      } catch (e) {
        this.plugin._requestError = e.message;
        this.plugin._requestResult = null;
      }
      this.refresh();
    });
    el.createEl("button", { cls: "test-fetch-approved-button", text: "Fetch approved" }).onClick(async () => {
      try {
        const res = await this.plugin.app.configuredEndpoint.fetch(
          ${JSON.stringify(url)},
          {
            method: "POST",
            headers: { Authorization: "Bearer sk-test" },
            body: JSON.stringify({ ping: true }),
          },
        );
        this.plugin._fetchResult = { status: res.status, body: await res.text() };
        this.plugin._fetchError = null;
      } catch (e) {
        this.plugin._fetchError = e.message;
        this.plugin._fetchResult = null;
      }
      this.refresh();
    });
    el.createEl("button", { cls: "test-fetch-other-button", text: "Fetch other" }).onClick(async () => {
      try {
        await this.plugin.app.configuredEndpoint.fetch(${JSON.stringify(otherUrl)}, {});
        this.plugin._fetchError = null;
      } catch (e) {
        this.plugin._fetchError = e.message;
      }
      this.refresh();
    });
  }
}

class TestPlugin extends Plugin {
  async onload() {
    this.addSettingTab(new TestSettingTab());
  }
}

TestPlugin.register();
`;
}

export function getConfiguredFetchPluginSource(options) {
  return getWorkerSource() + "\n" + configuredFetchPluginBody(options);
}

// Fixture for the clipboard-write capability (app.clipboard.write).
export const CLIPBOARD_PLUGIN_RAW_MANIFEST = {
  id: TEST_PLUGIN_BASE_ID,
  name: "Clipboard Test Plugin",
  version: "1.0.0",
  author: "Test Author",
  description: "A test fixture plugin for the clipboard-write API",
  permissions: { clipboard: ["write"] },
};

export const CLIPBOARD_PLUGIN_RAW_MANIFEST_NO_PERMISSION = {
  ...CLIPBOARD_PLUGIN_RAW_MANIFEST,
  permissions: {},
};

export const CLIPBOARD_PLUGIN_MANIFEST = {
  ...CLIPBOARD_PLUGIN_RAW_MANIFEST,
  id: TEST_PLUGIN_ID,
};

const CLIPBOARD_TEST_TEXT = "drafted reply text from the test plugin";

const CLIPBOARD_PLUGIN_BODY = /* js */ `
class TestSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName("Clipboard Test Plugin");
  }
  display() {
    const el = this.containerEl;
    el.addClass("test-clipboard-root");
    el.setAttr("data-copy-error", this.plugin._copyError ?? "");
    el.setAttr("data-copy-done", this.plugin._copyDone ? "true" : "false");
    el.createEl("button", { cls: "test-copy-button", text: "Copy" }).onClick(async () => {
      try {
        await this.plugin.app.clipboard.write(${JSON.stringify(CLIPBOARD_TEST_TEXT)});
        this.plugin._copyError = null;
        this.plugin._copyDone = true;
      } catch (e) {
        this.plugin._copyError = e.message;
      }
      this.refresh();
    });
  }
}

class TestPlugin extends Plugin {
  async onload() {
    this.addSettingTab(new TestSettingTab());
  }
}

TestPlugin.register();
`;

export function getClipboardPluginSource() {
  return getWorkerSource() + "\n" + CLIPBOARD_PLUGIN_BODY;
}

// Fixture for user-uploaded custom images (pluginCustomImages.js /
// app.customImages): a settings tab with a real <input type="file"> whose
// change event stages the picked File and immediately attempts
// registration with baked-in geometry (parametrized per test — a mismatch
// against the fixture PNG's real 128x128x15 dimensions is what exercises
// the dimension-check rejection path), then renders the result and (once
// registered) an actual createSprite() so the test can confirm real
// rendering, not just a successful RPC.
export const CUSTOM_IMAGE_NAME = "my_custom_dance";

export const CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST = {
  id: TEST_PLUGIN_BASE_ID,
  name: "Custom Images Test Plugin",
  version: "1.0.0",
  author: "Test Author",
  description: "A test fixture plugin for the custom-images upload API",
  permissions: { images: ["upload"] },
};

export const CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST_NO_PERMISSION = {
  ...CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST,
  permissions: {},
};

export const CUSTOM_IMAGE_PLUGIN_MANIFEST = {
  ...CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST,
  id: TEST_PLUGIN_ID,
};

function customImagePluginBody({
  name = CUSTOM_IMAGE_NAME,
  frameWidth = OVERLAY_SPRITE_FRAME_WIDTH,
  frameHeight = OVERLAY_SPRITE_FRAME_HEIGHT,
  frameCount = OVERLAY_SPRITE_FRAME_COUNT,
} = {}) {
  return /* js */ `
class TestSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName("Custom Images Test Plugin");
  }
  display() {
    const el = this.containerEl;
    el.addClass("test-custom-images-root");
    el.setAttr("data-register-error", this.plugin._registerError ?? "");
    el.setAttr("data-list", JSON.stringify(this.plugin._list ?? []));
    el.createEl("input", {
      cls: "test-file-input",
      attr: { type: "file", accept: "image/png" },
    }).onChange(async (event) => {
      try {
        await this.plugin.app.customImages.register({
          name: ${JSON.stringify(name)},
          frameWidth: ${frameWidth},
          frameHeight: ${frameHeight},
          frameCount: ${frameCount},
          fileToken: event.target.value,
        });
        this.plugin._registerError = null;
      } catch (e) {
        this.plugin._registerError = e.message;
      }
      try {
        this.plugin._list = await this.plugin.app.customImages.list();
      } catch (e) {
        this.plugin._list = [];
      }
      this.refresh();
    });
    if ((this.plugin._list ?? []).some((entry) => entry.name === ${JSON.stringify(name)})) {
      el.createSprite((sprite) => sprite.setImage(${JSON.stringify(name)}));
    }
    el.createEl("button", { cls: "test-delete-button", text: "Delete" }).onClick(async () => {
      try {
        await this.plugin.app.customImages.delete(${JSON.stringify(name)});
      } catch (e) {
        // ignore — permission-gating tests don't exercise delete
      }
      try {
        this.plugin._list = await this.plugin.app.customImages.list();
      } catch (e) {
        this.plugin._list = [];
      }
      this.refresh();
    });
  }
}

class TestPlugin extends Plugin {
  async onload() {
    this._registerError = null;
    // Tolerate a missing "upload" images permission here (the no-permission
    // fixture variant) so onload() still completes and registers the
    // settings tab — the interesting assertion is that a later register()
    // attempt fails, not that loading itself fails.
    try {
      this._list = await this.app.customImages.list();
    } catch (e) {
      this._list = [];
    }
    this.addSettingTab(new TestSettingTab());
  }
}

TestPlugin.register();
`;
}

export function getCustomImagePluginSource(options) {
  return getWorkerSource() + "\n" + customImagePluginBody(options);
}

// Fixture for overriding a *bundled* manifest.images entry by name: same
// upload/delete controls as customImagePluginBody, but the sprite is
// rendered unconditionally (not gated on the custom-images list containing
// the name) — the point of this fixture is to observe what the host has
// actually mounted for OVERLAY_SPRITE_IMAGE_NAME at each point (bundled →
// overridden by an upload → restored after deleting the override), which a
// list-gated render would hide as soon as the plugin's own list no longer
// includes it.
export const CUSTOM_IMAGE_OVERRIDE_PLUGIN_RAW_MANIFEST = {
  ...CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST,
  images: [
    {
      name: OVERLAY_SPRITE_IMAGE_NAME,
      file: "assets/test-sprite.png",
      frameWidth: OVERLAY_SPRITE_FRAME_WIDTH,
      frameHeight: OVERLAY_SPRITE_FRAME_HEIGHT,
      frameCount: OVERLAY_SPRITE_FRAME_COUNT,
    },
  ],
};

export const CUSTOM_IMAGE_OVERRIDE_PLUGIN_MANIFEST = {
  ...CUSTOM_IMAGE_OVERRIDE_PLUGIN_RAW_MANIFEST,
  id: TEST_PLUGIN_ID,
};

function customImageOverridePluginBody() {
  const name = OVERLAY_SPRITE_IMAGE_NAME;
  return /* js */ `
class TestSettingTab extends PluginSettingTab {
  constructor() {
    super();
    this.setName("Custom Images Override Test Plugin");
  }
  display() {
    const el = this.containerEl;
    el.addClass("test-custom-images-root");
    el.setAttr("data-register-error", this.plugin._registerError ?? "");
    el.setAttr("data-list", JSON.stringify(this.plugin._list ?? []));
    el.createEl("input", {
      cls: "test-file-input",
      attr: { type: "file", accept: "image/png" },
    }).onChange(async (event) => {
      try {
        await this.plugin.app.customImages.register({
          name: ${JSON.stringify(name)},
          frameWidth: ${OVERLAY_SPRITE_FRAME_WIDTH},
          frameHeight: ${OVERLAY_SPRITE_FRAME_HEIGHT},
          frameCount: ${OVERLAY_SPRITE_FRAME_COUNT},
          fileToken: event.target.value,
        });
        this.plugin._registerError = null;
      } catch (e) {
        this.plugin._registerError = e.message;
      }
      try {
        this.plugin._list = await this.plugin.app.customImages.list();
      } catch (e) {
        this.plugin._list = [];
      }
      this.refresh();
    });
    // Unconditional — see this fixture's header comment.
    el.createSprite((sprite) => sprite.setImage(${JSON.stringify(name)}));
    el.createEl("button", { cls: "test-delete-button", text: "Delete" }).onClick(async () => {
      await this.plugin.app.customImages.delete(${JSON.stringify(name)});
      try {
        this.plugin._list = await this.plugin.app.customImages.list();
      } catch (e) {
        this.plugin._list = [];
      }
      this.refresh();
    });
  }
}

class TestPlugin extends Plugin {
  async onload() {
    this._registerError = null;
    this._list = await this.app.customImages.list();
    this.addSettingTab(new TestSettingTab());
  }
}

TestPlugin.register();
`;
}

export function getCustomImageOverridePluginSource() {
  return getWorkerSource() + "\n" + customImageOverridePluginBody();
}

let cachedWorkerSource = null;

function getWorkerSource() {
  if (!cachedWorkerSource) {
    cachedWorkerSource = fs
      .readFileSync(pluginWorkerPath, "utf-8")
      .replace(/^export /gm, "");
  }
  return cachedWorkerSource;
}

export function getTestPluginSource() {
  return getWorkerSource() + "\n" + TEST_PLUGIN_BODY;
}

export function getThrowingTabPluginSource() {
  return getWorkerSource() + "\n" + THROWING_TAB_PLUGIN_BODY;
}

export function getNoSettingsPluginSource() {
  return getWorkerSource() + "\n" + NO_SETTINGS_PLUGIN_BODY;
}

export function getPostComposerInitPluginSource() {
  return getWorkerSource() + "\n" + POST_COMPOSER_INIT_PLUGIN_BODY;
}
