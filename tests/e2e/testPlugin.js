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
