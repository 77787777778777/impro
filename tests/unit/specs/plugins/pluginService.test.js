import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  PluginService,
  PermissionsDeclinedError,
} from "/js/plugins/pluginService.js";
import { Signal, SignalMap } from "/js/signals.js";
import { EventEmitter } from "/js/eventEmitter.js";
import { HiddenFeedItemsStore } from "/js/dataLayer/hiddenFeedItemsStore.js";
import { respondToConfirm } from "../../testHelpers.js";

function emptyDataLayer() {
  const dataLayer = new EventEmitter();
  dataLayer.dataStore = { $feeds: new SignalMap() };
  return dataLayer;
}

class FakePreferences {
  constructor(state) {
    this.state = state;
  }
  getInstalledPlugins() {
    return this.state.installedPlugins;
  }
  setInstalledPlugins(plugins) {
    this.state.installedPlugins = plugins;
    // Return a fresh identity to mirror the real provider, which clones
    // preferences on every write so dependent signals invalidate.
    return new FakePreferences(this.state);
  }
  getPluginSettings(pluginId) {
    return this.state.pluginSettings[pluginId];
  }
  setPluginSettings(pluginId, data) {
    this.state.pluginSettings[pluginId] = data;
    return this;
  }
  clearPluginSettings(pluginId) {
    delete this.state.pluginSettings[pluginId];
    return this;
  }
}

function makeProvider() {
  const state = { installedPlugins: [], pluginSettings: {} };
  const preferences = new FakePreferences(state);
  const $preferences = new Signal.State(preferences);
  return {
    state,
    provider: {
      $preferences,
      requirePreferences: () => preferences,
      updatePreferences: async (saved) => {
        $preferences.set(saved);
      },
    },
  };
}

// Build a PluginService with its async-heavy dependencies replaced by
// inert fakes so we can exercise the install/update orchestration logic
// without spinning up sandbox iframes or real fetches.
function makeService({
  remoteListings = [],
  localListings = null,
  liveManifests = {},
  liveManifestsByRepo = {},
} = {}) {
  const { state, provider } = makeProvider();
  const service = new PluginService(
    provider,
    null,
    emptyDataLayer(),
    new HiddenFeedItemsStore(),
  );
  const loadCalls = [];
  const reloadCalls = [];
  const unloadCalls = [];
  const reconcileCalls = [];
  service.pluginBridge = {
    isLoaded: () => false,
    unloadPlugin: (id) => {
      unloadCalls.push(id);
    },
    loadPlugin: async (id, version, repo) => {
      loadCalls.push({ id, version, repo });
    },
    reloadPlugin: async (id, version, repo) => {
      reloadCalls.push({ id, version, repo });
    },
    loadPlugins: async (entries) => ({
      loadedPlugins: entries,
      erroredPlugins: [],
    }),
  };
  service.remoteRegistry = {
    getListing: async (id) =>
      remoteListings.find((listing) => listing.id === id) ?? null,
    getListings: async () => remoteListings,
  };
  service.localPluginsEnabled = localListings != null;
  service.localRegistry = localListings
    ? {
        getListings: async () => localListings,
        getListing: async (id) =>
          localListings.find((listing) => listing.id === id) ?? null,
      }
    : null;
  service.sourceProvider = {
    getLiveManifest: async (id) => {
      if (!liveManifests[id]) throw new Error(`no manifest for ${id}`);
      return liveManifests[id];
    },
    getLiveManifestFromRepo: async (repo) => {
      if (!liveManifestsByRepo[repo]) {
        throw new Error(`no manifest for ${repo}`);
      }
      return liveManifestsByRepo[repo];
    },
    getCacheUrls: async (id, version, repo) => [
      `https://cache.test/${id}/${version}/${repo}`,
    ],
  };
  service.pluginCache = {
    reconcile: async (urls) => {
      reconcileCalls.push(urls);
    },
  };
  service.pluginCustomImages = { purgeForPlugin: async () => {} };
  return {
    service,
    state,
    provider,
    loadCalls,
    reloadCalls,
    unloadCalls,
    reconcileCalls,
  };
}

describe("installPlugin", () => {
  it("persists manifest metadata and loads the plugin", async () => {
    const { service, state, loadCalls } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          author: "ow",
          description: "the first",
        },
      },
    });
    await service.installPlugin("alpha");
    assert.deepEqual(state.installedPlugins, [
      {
        id: "alpha",
        name: "Alpha",
        version: "1.0.0",
        author: "ow",
        description: "the first",
        repo: "ow/alpha",
        enabled: true,
        permissions: {},
      },
    ]);
    assert.deepEqual(loadCalls, [
      { id: "alpha", version: "1.0.0", repo: "ow/alpha" },
    ]);
  });

  it("$pluginsInfo reflects newly installed plugin synchronously", async () => {
    const { service } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          author: "ow",
          description: "the first",
        },
      },
    });
    assert.deepEqual(service.$pluginsInfo.get(), []);
    await service.installPlugin("alpha");
    const info = service.$pluginsInfo.get();
    assert.deepEqual(info.length, 1);
    assert.deepEqual(info[0].id, "alpha");
    assert.deepEqual(info[0].name, "Alpha");
    assert.deepEqual(info[0].version, "1.0.0");
    assert.deepEqual(info[0].enabled, true);
  });

  it("throws and rolls back the preference entry when load fails", async () => {
    const { service, state } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: { id: "alpha", name: "Alpha", version: "1.0.0" },
      },
    });
    service.pluginBridge.loadPlugin = async () => {
      throw new Error("boom");
    };
    let caught = null;
    try {
      await service.installPlugin("alpha");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("boom"));
    assert.deepEqual(state.installedPlugins, []);
  });

  it("rejects when the plugin is not in the remote registry", async () => {
    const { service } = makeService();
    let caught = null;
    try {
      await service.installPlugin("alpha");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("unknown plugin"));
  });

  it("aborts install when the permission prompt is declined", async () => {
    const { service, state, loadCalls } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          permissions: { fetch: ["https://api.example.com/*"] },
        },
      },
    });
    const installing = service.installPlugin("alpha");
    await respondToConfirm(false);
    let caught = null;
    try {
      await installing;
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof PermissionsDeclinedError);
    assert.deepEqual(state.installedPlugins, []);
    assert.deepEqual(loadCalls, []);
  });

  it("does not prompt on install when manifest has no permissions", async () => {
    const { service, state } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: { id: "alpha", name: "Alpha", version: "1.0.0" },
      },
    });
    await service.installPlugin("alpha");
    assert.deepEqual(state.installedPlugins.length, 1);
  });
});

describe("updatePlugin", () => {
  it("refreshes name/description/author/version from the live manifest", async () => {
    const { service, state, reloadCalls } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          author: "ow",
          description: "the first",
        },
      },
    });
    await service.installPlugin("alpha");

    service.sourceProvider.getLiveManifest = async () => ({
      id: "alpha",
      name: "Alpha Renamed",
      version: "1.1.0",
      author: "ow2",
      description: "new description",
    });

    const result = await service.updatePlugin("alpha");
    assert.deepEqual(result, { updated: true, version: "1.1.0" });
    assert.deepEqual(state.installedPlugins[0], {
      id: "alpha",
      name: "Alpha Renamed",
      version: "1.1.0",
      author: "ow2",
      description: "new description",
      repo: "ow/alpha",
      enabled: true,
      permissions: {},
    });
    assert.deepEqual(reloadCalls, [
      { id: "alpha", version: "1.1.0", repo: "ow/alpha" },
    ]);
  });

  it("does nothing when live manifest is not newer", async () => {
    const { service, state, reloadCalls } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: { id: "alpha", name: "Alpha", version: "1.0.0" },
      },
    });
    await service.installPlugin("alpha");

    const result = await service.updatePlugin("alpha");
    assert.deepEqual(result, { updated: false });
    assert.deepEqual(state.installedPlugins[0].version, "1.0.0");
    assert.deepEqual(reloadCalls.length, 0);
  });

  it("does not prompt when no new permissions were added", async () => {
    const { service } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          permissions: { fetch: ["https://api.example.com/*"] },
        },
      },
    });
    const installing = service.installPlugin("alpha");
    await respondToConfirm(true);
    await installing;
    service.sourceProvider.getLiveManifest = async () => ({
      id: "alpha",
      name: "Alpha",
      version: "1.1.0",
      permissions: { fetch: ["https://api.example.com/*"] },
    });

    const result = await service.updatePlugin("alpha");
    assert.deepEqual(result, { updated: true, version: "1.1.0" });
  });

  it("aborts update and keeps old version when the prompt is declined", async () => {
    const { service, state, reloadCalls } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          permissions: { fetch: ["https://api.example.com/*"] },
        },
      },
    });
    const installing = service.installPlugin("alpha");
    await respondToConfirm(true);
    await installing;
    service.sourceProvider.getLiveManifest = async () => ({
      id: "alpha",
      name: "Alpha",
      version: "1.1.0",
      permissions: {
        fetch: ["https://api.example.com/*", "https://newhost.com/*"],
      },
    });

    const updating = service.updatePlugin("alpha");
    await respondToConfirm(false);
    let caught = null;
    try {
      await updating;
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof PermissionsDeclinedError);
    assert.deepEqual(state.installedPlugins[0].version, "1.0.0");
    assert.deepEqual(state.installedPlugins[0].permissions, {
      fetch: ["https://api.example.com/*"],
    });
    assert.deepEqual(reloadCalls.length, 0);
  });

  it("persists updated permissions when the prompt is accepted", async () => {
    const { service, state } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifests: {
        alpha: {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          permissions: { fetch: ["https://api.example.com/*"] },
        },
      },
    });
    const installing = service.installPlugin("alpha");
    await respondToConfirm(true);
    await installing;
    service.sourceProvider.getLiveManifest = async () => ({
      id: "alpha",
      name: "Alpha",
      version: "1.1.0",
      permissions: {
        fetch: ["https://api.example.com/*", "https://newhost.com/*"],
      },
    });

    const updating = service.updatePlugin("alpha");
    await respondToConfirm(true);
    await updating;
    assert.deepEqual(state.installedPlugins[0].permissions, {
      fetch: ["https://api.example.com/*", "https://newhost.com/*"],
    });
  });
});

describe("loadEnabledPlugins", () => {
  it("only loads entries marked enabled", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: false },
    ];
    const loadPluginsCalls = [];
    service.pluginBridge.loadPlugins = async (entries) => {
      loadPluginsCalls.push(entries);
      return { loadedPlugins: entries, erroredPlugins: [] };
    };
    await service.loadEnabledPlugins();
    assert.deepEqual(loadPluginsCalls.length, 1);
    assert.deepEqual(
      loadPluginsCalls[0].map((entry) => entry.id),
      ["a"],
    );
  });

  it("skips __LOCAL entries when localPluginsEnabled is false", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b__LOCAL", version: "1.0.0", repo: null, enabled: true },
    ];
    const loadPluginsCalls = [];
    service.pluginBridge.loadPlugins = async (entries) => {
      loadPluginsCalls.push(entries);
      return { loadedPlugins: entries, erroredPlugins: [] };
    };
    await service.loadEnabledPlugins();
    assert.deepEqual(
      loadPluginsCalls[0].map((entry) => entry.id),
      ["a"],
    );
  });

  it("loads __LOCAL entries when localPluginsEnabled is true", async () => {
    const { service, state } = makeService({ localListings: [] });
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b__LOCAL", version: "1.0.0", repo: null, enabled: true },
    ];
    const loadPluginsCalls = [];
    service.pluginBridge.loadPlugins = async (entries) => {
      loadPluginsCalls.push(entries);
      return { loadedPlugins: entries, erroredPlugins: [] };
    };
    await service.loadEnabledPlugins();
    assert.deepEqual(
      loadPluginsCalls[0].map((entry) => entry.id),
      ["a", "b__LOCAL"],
    );
  });

  it("keeps plugins enabled when the bridge reports they errored", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
    ];
    service.pluginBridge.loadPlugins = async () => ({
      loadedPlugins: [],
      erroredPlugins: [{ pluginId: "b", error: new Error("nope") }],
    });
    await service.loadEnabledPlugins();
    assert.deepEqual(
      state.installedPlugins.find((entry) => entry.id === "b").enabled,
      true,
    );
    assert.deepEqual(
      state.installedPlugins.find((entry) => entry.id === "a").enabled,
      true,
    );
  });

  it("shows one error toast per distinct load-error message", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
      { id: "c", version: "1.0.0", repo: "ow/c", enabled: true },
    ];
    service.pluginBridge.loadPlugins = async () => ({
      loadedPlugins: [],
      erroredPlugins: [
        { pluginId: "a", error: new Error("Failed to load plugin source") },
        { pluginId: "b", error: new Error("Failed to load plugin source") },
        { pluginId: "c", error: new Error("Failed to load plugin manifest") },
      ],
    });
    document.body.innerHTML = "";
    await service.loadEnabledPlugins();
    const toasts = [...document.body.querySelectorAll('[data-testid="toast"]')];
    assert.deepEqual(
      toasts.map((toast) => toast.textContent.trim()),
      [
        "Failed to load plugin(s): a, b - Failed to load plugin source",
        "Failed to load plugin(s): c - Failed to load plugin manifest",
      ],
    );
    document.body.innerHTML = "";
  });

  it("with ?disable-plugins, disables all enabled plugins in one save and skips loading", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: false },
      { id: "c", version: "1.0.0", repo: "ow/c", enabled: true },
    ];
    const loadPluginsCalls = [];
    service.pluginBridge.loadPlugins = async (entries) => {
      loadPluginsCalls.push(entries);
      return { loadedPlugins: entries, erroredPlugins: [] };
    };
    let saveCalls = 0;
    const originalSave =
      service.prefManager.preferencesProvider.updatePreferences;
    service.prefManager.preferencesProvider.updatePreferences = async (
      prefs,
    ) => {
      saveCalls++;
      return originalSave(prefs);
    };
    window.history.replaceState({}, "", "http://localhost/?disable-plugins");
    try {
      await service.loadEnabledPlugins();
    } finally {
      window.history.replaceState({}, "", "http://localhost/");
    }
    assert.deepEqual(loadPluginsCalls.length, 0);
    assert.deepEqual(saveCalls, 1);
    assert.deepEqual(state.installedPlugins, [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: false },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: false },
      { id: "c", version: "1.0.0", repo: "ow/c", enabled: false },
    ]);
  });

  it("with ?disable-plugins and no enabled plugins, performs no save and no load", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: false },
    ];
    const loadPluginsCalls = [];
    service.pluginBridge.loadPlugins = async (entries) => {
      loadPluginsCalls.push(entries);
      return { loadedPlugins: entries, erroredPlugins: [] };
    };
    let saveCalls = 0;
    service.prefManager.preferencesProvider.updatePreferences = async () => {
      saveCalls++;
    };
    window.history.replaceState({}, "", "http://localhost/?disable-plugins");
    try {
      await service.loadEnabledPlugins();
    } finally {
      window.history.replaceState({}, "", "http://localhost/");
    }
    assert.deepEqual(loadPluginsCalls.length, 0);
    assert.deepEqual(saveCalls, 0);
  });

  it("reconciles cache against all installed (including disabled)", async () => {
    const { service, state, reconcileCalls } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: false },
    ];
    await service.loadEnabledPlugins();
    assert.deepEqual(reconcileCalls.length, 1);
    assert.deepEqual(reconcileCalls[0], [
      "https://cache.test/a/1.0.0/ow/a",
      "https://cache.test/b/1.0.0/ow/b",
    ]);
  });
});

describe("uninstallPlugin", () => {
  it("unloads, removes preference, clears settings, and reconciles", async () => {
    const { service, state, unloadCalls, reconcileCalls } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
    ];
    state.pluginSettings = { a: { color: "red" }, b: { color: "blue" } };
    await service.uninstallPlugin("a");
    assert.deepEqual(unloadCalls, ["a"]);
    assert.deepEqual(
      state.installedPlugins.map((entry) => entry.id),
      ["b"],
    );
    assert.deepEqual(state.pluginSettings, { b: { color: "blue" } });
    // Cache should be reconciled against the remaining plugin only
    assert.deepEqual(reconcileCalls.length, 1);
    assert.deepEqual(reconcileCalls[0], ["https://cache.test/b/1.0.0/ow/b"]);
  });
});

describe("enablePlugin", () => {
  it("flips enabled and loads the plugin", async () => {
    const { service, state, loadCalls } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: false },
    ];
    await service.enablePlugin("a");
    assert.deepEqual(state.installedPlugins[0].enabled, true);
    assert.deepEqual(loadCalls, [{ id: "a", version: "1.0.0", repo: "ow/a" }]);
  });

  it("rolls back to disabled when load fails", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: false },
    ];
    service.pluginBridge.loadPlugin = async () => {
      throw new Error("boom");
    };
    let caught = null;
    try {
      await service.enablePlugin("a");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("boom"));
    assert.deepEqual(state.installedPlugins[0].enabled, false);
  });
});

describe("reloadPlugins", () => {
  it("reloads only enabled plugins", async () => {
    const { service, state, reloadCalls } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: false },
    ];
    await service.reloadPlugins();
    assert.deepEqual(
      reloadCalls.map((call) => call.id),
      ["a"],
    );
  });

  it("disables plugins that throw and re-throws the first failure", async () => {
    const { service, state } = makeService();
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
    ];
    service.pluginBridge.reloadPlugin = async (id) => {
      if (id === "b") throw new Error("b broke");
    };
    let caught = null;
    try {
      await service.reloadPlugins();
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("b broke"));
    assert.deepEqual(
      state.installedPlugins.find((entry) => entry.id === "b").enabled,
      false,
    );
    assert.deepEqual(
      state.installedPlugins.find((entry) => entry.id === "a").enabled,
      true,
    );
  });
});

describe("checkForUpdates", () => {
  it("populates $availableUpdates with plugins whose live version is newer", async () => {
    const { service, state } = makeService({
      liveManifests: {
        a: { id: "a", name: "A", version: "2.0.0" },
        b: { id: "b", name: "B", version: "1.0.0" },
      },
    });
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
    ];
    const updates = await service.checkForUpdates();
    assert.deepEqual([...updates.entries()], [["a", "2.0.0"]]);
    assert.deepEqual(service.$availableUpdates.get(), updates);
  });

  it("skips plugins whose live manifest fails to fetch", async () => {
    const { service, state } = makeService({
      liveManifests: {
        a: { id: "a", name: "A", version: "2.0.0" },
        // b intentionally missing — getLiveManifest will throw
      },
    });
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
    ];
    const updates = await service.checkForUpdates();
    assert.deepEqual([...updates.keys()], ["a"]);
  });
});

describe("updateAllPlugins", () => {
  it("returns empty buckets when there are no available updates", async () => {
    const { service } = makeService();
    const result = await service.updateAllPlugins();
    assert.deepEqual(result, { updated: [], failed: [], declined: [] });
  });

  it("partitions results into updated and failed buckets", async () => {
    const { service, state } = makeService({
      liveManifests: {
        a: { id: "a", name: "A", version: "2.0.0" },
        b: { id: "b", name: "B", version: "2.0.0" },
      },
    });
    state.installedPlugins = [
      { id: "a", version: "1.0.0", repo: "ow/a", enabled: true },
      { id: "b", version: "1.0.0", repo: "ow/b", enabled: true },
    ];
    await service.checkForUpdates();
    // Make b's reload fail; a should still update successfully.
    service.pluginBridge.reloadPlugin = async (id) => {
      if (id === "b") throw new Error("reload failed");
    };
    const result = await service.updateAllPlugins();
    assert.deepEqual(result.updated, ["a"]);
    assert.deepEqual(result.failed, ["b"]);
  });
});

describe("$pluginsInfo", () => {
  it("hides __LOCAL plugins when localPluginsEnabled is false", () => {
    const { service, state } = makeService({});
    state.installedPlugins = [
      { id: "alpha", name: "Alpha", version: "1.0.0", enabled: true },
      { id: "gamma__LOCAL", name: "Gamma", version: "0.1.0", enabled: true },
    ];
    const info = service.$pluginsInfo.get();
    assert.deepEqual(info.length, 1);
    assert.deepEqual(info[0].id, "alpha");
  });

  it("includes __LOCAL plugins when localPluginsEnabled is true", () => {
    const { service, state } = makeService({ localListings: [] });
    state.installedPlugins = [
      { id: "alpha", name: "Alpha", version: "1.0.0", enabled: true },
      { id: "gamma__LOCAL", name: "Gamma", version: "0.1.0", enabled: true },
    ];
    const info = service.$pluginsInfo.get();
    assert.deepEqual(info.length, 2);
  });
});

describe("registry listings loader/selector", () => {
  it("returns null from the selector before the loader runs", () => {
    const { service } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha", name: "Alpha" }],
    });
    assert.deepEqual(service.$registryListings.get(), null);
  });

  it("merges remote + local listings and marks installed entries", async () => {
    const { service, provider } = makeService({
      remoteListings: [
        { id: "alpha", repo: "ow/alpha", name: "Alpha" },
        { id: "beta", repo: "ow/beta", name: "Beta" },
      ],
      localListings: [{ id: "gamma__LOCAL", name: "Gamma" }],
    });
    provider.$preferences.set(
      provider
        .requirePreferences()
        .setInstalledPlugins([
          { id: "alpha", version: "1.0.0", repo: "ow/alpha", enabled: true },
        ]),
    );
    await service.loadRegistryListings();
    const listings = service.$registryListings.get();
    assert.deepEqual(listings.length, 3);
    const byId = Object.fromEntries(
      listings.map((listing) => [listing.id, listing]),
    );
    assert.deepEqual(byId.alpha.installed, true);
    assert.deepEqual(byId.beta.installed, false);
    assert.deepEqual(byId.gamma__LOCAL.installed, false);
  });

  it("reflects updated install state on subsequent selector reads", async () => {
    const { service, provider } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha", name: "Alpha" }],
    });
    await service.loadRegistryListings();
    assert.deepEqual(service.$registryListings.get()[0].installed, false);
    provider.$preferences.set(
      provider
        .requirePreferences()
        .setInstalledPlugins([
          { id: "alpha", version: "1.0.0", repo: "ow/alpha", enabled: true },
        ]),
    );
    assert.deepEqual(service.$registryListings.get()[0].installed, true);
  });

  it("updates installed plugin repo when remote listing repo changes", async () => {
    const { service, provider } = makeService({
      remoteListings: [{ id: "alpha", repo: "newowner/alpha", name: "Alpha" }],
    });
    provider.$preferences.set(
      provider.requirePreferences().setInstalledPlugins([
        {
          id: "alpha",
          version: "1.0.0",
          repo: "oldowner/alpha",
          enabled: true,
        },
      ]),
    );
    await service.loadRegistryListings();
    const installed = provider.requirePreferences().getInstalledPlugins();
    assert.deepEqual(installed[0].repo, "newowner/alpha");
  });

  it("does not rewrite installed repos when listings match", async () => {
    const { service, provider } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha", name: "Alpha" }],
    });
    provider.$preferences.set(
      provider
        .requirePreferences()
        .setInstalledPlugins([
          { id: "alpha", version: "1.0.0", repo: "ow/alpha", enabled: true },
        ]),
    );
    const before = provider.$preferences.get();
    await service.loadRegistryListings();
    assert.deepEqual(provider.$preferences.get(), before);
  });

  it("sorts listings alphabetically by name, ignoring case", async () => {
    const { service } = makeService({
      remoteListings: [
        { id: "gamma", repo: "ow/gamma", name: "gamma" },
        { id: "alpha", repo: "ow/alpha", name: "Alpha" },
      ],
      localListings: [{ id: "beta__LOCAL", name: "Beta" }],
    });
    await service.loadRegistryListings();
    const listings = service.$registryListings.get();
    assert.deepEqual(
      listings.map((listing) => listing.name),
      ["Alpha", "Beta", "gamma"],
    );
  });

  it("returns only remote listings when localRegistry is absent", async () => {
    const { service } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha", name: "Alpha" }],
    });
    await service.loadRegistryListings();
    const listings = service.$registryListings.get();
    assert.deepEqual(listings.length, 1);
    assert.deepEqual(listings[0].id, "alpha");
  });
});

describe("installUnregisteredPlugin", () => {
  it("installs from a github.com URL using manifest metadata", async () => {
    const { service, state, loadCalls } = makeService({
      liveManifestsByRepo: {
        "ow/alpha": {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
          author: "ow",
          description: "the first",
        },
      },
    });
    const result = await service.installUnregisteredPlugin(
      "https://github.com/ow/alpha",
    );
    assert.deepEqual(result, { id: "alpha", name: "Alpha" });
    assert.deepEqual(state.installedPlugins, [
      {
        id: "alpha",
        name: "Alpha",
        version: "1.0.0",
        author: "ow",
        description: "the first",
        repo: "ow/alpha",
        enabled: true,
        permissions: {},
      },
    ]);
    assert.deepEqual(loadCalls, [
      { id: "alpha", version: "1.0.0", repo: "ow/alpha" },
    ]);
  });

  it("strips .git and extra path segments from the URL", async () => {
    const { service, state } = makeService({
      liveManifestsByRepo: {
        "ow/alpha": { id: "alpha", name: "Alpha", version: "1.0.0" },
      },
    });
    await service.installUnregisteredPlugin(
      "https://github.com/ow/alpha.git/tree/main",
    );
    assert.deepEqual(state.installedPlugins[0].repo, "ow/alpha");
  });

  it("installs from a tangled.org URL using a tangled repo spec", async () => {
    const { service, state, loadCalls } = makeService({
      liveManifestsByRepo: {
        "tangled:@ow.example.com/alpha": {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
        },
      },
    });
    const result = await service.installUnregisteredPlugin(
      "https://tangled.org/@ow.example.com/alpha",
    );
    assert.deepEqual(result, { id: "alpha", name: "Alpha" });
    assert.deepEqual(
      state.installedPlugins[0].repo,
      "tangled:@ow.example.com/alpha",
    );
    assert.deepEqual(loadCalls, [
      {
        id: "alpha",
        version: "1.0.0",
        repo: "tangled:@ow.example.com/alpha",
      },
    ]);
  });

  it("accepts tangled.sh URLs", async () => {
    const { service, state } = makeService({
      liveManifestsByRepo: {
        "tangled:@ow.example.com/alpha": {
          id: "alpha",
          name: "Alpha",
          version: "1.0.0",
        },
      },
    });
    await service.installUnregisteredPlugin(
      "https://tangled.sh/@ow.example.com/alpha",
    );
    assert.deepEqual(
      state.installedPlugins[0].repo,
      "tangled:@ow.example.com/alpha",
    );
  });

  it("rejects URLs from unsupported hosts", async () => {
    const { service, state } = makeService();
    let caught = null;
    try {
      await service.installUnregisteredPlugin("https://example.com/ow/alpha");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("Invalid repo URL"));
    assert.deepEqual(state.installedPlugins, []);
  });

  it("rejects malformed URL strings", async () => {
    const { service } = makeService();
    let caught = null;
    try {
      await service.installUnregisteredPlugin("not a url");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("Invalid repo URL"));
  });

  it("throws when manifest is missing required fields", async () => {
    const { service, state } = makeService();
    service.sourceProvider.getLiveManifestFromRepo = async () => {
      throw new Error('missing required field "version"');
    };
    let caught = null;
    try {
      await service.installUnregisteredPlugin("https://github.com/ow/alpha");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("Failed to fetch manifest"));
    assert.deepEqual(state.installedPlugins, []);
  });

  it("rejects when the plugin id is already installed", async () => {
    const { service, state } = makeService({
      liveManifestsByRepo: {
        "ow/alpha": { id: "alpha", name: "Alpha", version: "1.0.0" },
      },
    });
    state.installedPlugins = [
      {
        id: "alpha",
        name: "Alpha",
        version: "0.9.0",
        repo: "ow/alpha",
        enabled: true,
      },
    ];
    let caught = null;
    try {
      await service.installUnregisteredPlugin("https://github.com/ow/alpha");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("already installed"));
    assert.deepEqual(state.installedPlugins.length, 1);
  });

  it("rolls back the preference entry when load fails", async () => {
    const { service, state } = makeService({
      liveManifestsByRepo: {
        "ow/alpha": { id: "alpha", name: "Alpha", version: "1.0.0" },
      },
    });
    service.pluginBridge.loadPlugin = async () => {
      throw new Error("boom");
    };
    let caught = null;
    try {
      await service.installUnregisteredPlugin("https://github.com/ow/alpha");
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("boom"));
    assert.deepEqual(state.installedPlugins, []);
  });

  it("rejects when the plugin id is already in the remote registry", async () => {
    const { service, state } = makeService({
      remoteListings: [{ id: "alpha", repo: "ow/alpha" }],
      liveManifestsByRepo: {
        "someone/alpha-fork": {
          id: "alpha",
          name: "Alpha Fork",
          version: "1.0.0",
        },
      },
    });
    let caught = null;
    try {
      await service.installUnregisteredPlugin(
        "https://github.com/someone/alpha-fork",
      );
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("in the registry"));
    assert.deepEqual(state.installedPlugins, []);
  });

  it("rejects when the plugin id is in the local registry", async () => {
    const { service, state } = makeService({
      localListings: [{ id: "alpha", repo: "ow/alpha-local" }],
      liveManifestsByRepo: {
        "someone/alpha-fork": {
          id: "alpha",
          name: "Alpha Fork",
          version: "1.0.0",
        },
      },
    });
    let caught = null;
    try {
      await service.installUnregisteredPlugin(
        "https://github.com/someone/alpha-fork",
      );
    } catch (error) {
      caught = error;
    }
    assert(caught?.message.includes("in the registry"));
    assert.deepEqual(state.installedPlugins, []);
  });
});

describe("getFilteredFeedItems", () => {
  const feedURI = "at://did:test/app.bsky.feed.generator/test";

  function addFilter(service, pluginId, invoke) {
    const entry = { pluginId, invoke };
    service.registries.feedFilters.add(entry);
    return entry;
  }

  it("returns an empty object when no filters are registered", async () => {
    const { service } = makeService();
    const result = await service.getFilteredFeedItems(feedURI, { feed: [] });
    assert.deepEqual(result, {});
  });

  it("passes feed.feed (not the wrapper) to each filter", async () => {
    const { service } = makeService();
    const feedItems = [{ post: { uri: "p1" } }];
    let captured = null;
    addFilter(service, "alpha", async (_uri, items) => {
      captured = items;
      return {};
    });

    await service.getFilteredFeedItems(feedURI, { feed: feedItems });

    assert.deepEqual(captured, feedItems);
  });

  it("merges hide verdicts from multiple filters", async () => {
    const { service } = makeService();
    addFilter(service, "alpha", async () => ({ p1: false }));
    addFilter(service, "beta", async () => ({ p2: false }));

    const result = await service.getFilteredFeedItems(feedURI, { feed: [] });

    assert.deepEqual(result, { p1: false, p2: false });
  });

  it("ignores non-false verdicts", async () => {
    const { service } = makeService();
    addFilter(service, "alpha", async () => ({
      p1: true,
      p2: false,
      p3: null,
      p4: { hidden: true },
    }));

    const result = await service.getFilteredFeedItems(feedURI, { feed: [] });

    assert.deepEqual(result, { p2: false });
  });

  it("does not let one filter's keep override another filter's hide", async () => {
    const { service } = makeService();
    addFilter(service, "alpha", async () => ({ p1: false, p2: true }));
    addFilter(service, "beta", async () => ({ p1: true, p2: false }));

    const result = await service.getFilteredFeedItems(feedURI, { feed: [] });

    assert.deepEqual(result, { p1: false, p2: false });
  });

  it("continues past filters that throw", async () => {
    const { service } = makeService();
    addFilter(service, "alpha", async () => {
      throw new Error("boom");
    });
    addFilter(service, "beta", async () => ({ p1: false }));

    const originalError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await service.getFilteredFeedItems(feedURI, { feed: [] });
    } finally {
      console.error = originalError;
    }

    assert.deepEqual(result, { p1: false });
  });

  it("skips filters that return null or non-object values", async () => {
    const { service } = makeService();
    addFilter(service, "alpha", async () => null);
    addFilter(service, "beta", async () => "not-an-object");
    addFilter(service, "gamma", async () => ({ p1: false }));

    const result = await service.getFilteredFeedItems(feedURI, { feed: [] });

    assert.deepEqual(result, { p1: false });
  });
});

describe("feed filter integration", () => {
  function makeHarness(getFilteredFeedItems) {
    const { provider } = makeProvider();
    const dataLayer = emptyDataLayer();
    const hiddenFeedItemsStore = new HiddenFeedItemsStore();
    const service = new PluginService(
      provider,
      null,
      dataLayer,
      hiddenFeedItemsStore,
    );
    service.getFilteredFeedItems = getFilteredFeedItems;
    return { service, dataLayer, hiddenFeedItemsStore };
  }

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("merges appended pages into the hidden-items store", async () => {
    let call = 0;
    const { dataLayer, hiddenFeedItemsStore } = makeHarness(async () => {
      call += 1;
      return call === 1 ? { p1: false } : { p2: false };
    });
    dataLayer.emit("feedLoaded", { feedURI: "f", feed: {}, reload: false });
    await flush();
    dataLayer.emit("feedLoaded", { feedURI: "f", feed: {}, reload: false });
    await flush();
    assert.deepEqual(hiddenFeedItemsStore.get("f"), { p1: false, p2: false });
  });

  it("replaces on reload", async () => {
    let call = 0;
    const { dataLayer, hiddenFeedItemsStore } = makeHarness(async () => {
      call += 1;
      return call === 1 ? { p1: false } : { p2: false };
    });
    dataLayer.emit("feedLoaded", { feedURI: "f", feed: {}, reload: false });
    await flush();
    dataLayer.emit("feedLoaded", { feedURI: "f", feed: {}, reload: true });
    await flush();
    assert.deepEqual(hiddenFeedItemsStore.get("f"), { p2: false });
  });

  it("targets a specific feed on refresh request", async () => {
    const invocations = [];
    const { service, dataLayer, hiddenFeedItemsStore } = makeHarness(
      async (uri) => {
        invocations.push(uri);
        return { [`x-${uri}`]: false };
      },
    );
    dataLayer.dataStore.$feeds.set("a", { feed: [] });
    dataLayer.dataStore.$feeds.set("b", { feed: [] });
    await service.refreshFeedFilters("a");
    await flush();
    assert.deepEqual(invocations, ["a"]);
    assert.deepEqual(hiddenFeedItemsStore.get("a"), { "x-a": false });
    assert.deepEqual(hiddenFeedItemsStore.get("b"), {});
  });

  it("refreshes all cached feeds when no URI is supplied", async () => {
    const invocations = [];
    const { service, dataLayer, hiddenFeedItemsStore } = makeHarness(
      async (uri) => {
        invocations.push(uri);
        return { [`x-${uri}`]: false };
      },
    );
    dataLayer.dataStore.$feeds.set("a", { feed: [] });
    dataLayer.dataStore.$feeds.set("b", { feed: [] });
    await service.refreshFeedFilters();
    await flush();
    assert.deepEqual(new Set(invocations), new Set(["a", "b"]));
    assert.deepEqual(hiddenFeedItemsStore.get("a"), { "x-a": false });
    assert.deepEqual(hiddenFeedItemsStore.get("b"), { "x-b": false });
  });
});

describe("getClaimedFacetTypes", () => {
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }
  function registerTransform(service, pluginId, message) {
    const handler =
      service.pluginBridge._registrationTargets.get("richTextTransform");
    return handler({ pluginId, call: () => {} }, message);
  }

  it("is empty when no transforms are registered", () => {
    const service = makeServiceWithRealBridge();
    assert.deepEqual([...service.getClaimedFacetTypes()], []);
  });

  it("unions handlesFacetTypes across registered transforms", () => {
    const service = makeServiceWithRealBridge();
    registerTransform(service, "alpha", {
      handlerId: 1,
      handlesFacetTypes: ["blue.moji.richtext.facet", "dev.impro.foo"],
    });
    registerTransform(service, "beta", {
      handlerId: 2,
      handlesFacetTypes: ["dev.impro.foo"],
    });
    assert.deepEqual([...service.getClaimedFacetTypes()].sort(), [
      "blue.moji.richtext.facet",
      "dev.impro.foo",
    ]);
  });

  it("drops entries when a transform unregisters", () => {
    const service = makeServiceWithRealBridge();
    const dispose = registerTransform(service, "alpha", {
      handlerId: 1,
      handlesFacetTypes: ["blue.moji.richtext.facet"],
    });
    dispose();
    assert.deepEqual([...service.getClaimedFacetTypes()], []);
  });

  it("tolerates a transform registered without handlesFacetTypes", () => {
    const service = makeServiceWithRealBridge();
    registerTransform(service, "alpha", { handlerId: 1 });
    assert.deepEqual([...service.getClaimedFacetTypes()], []);
  });
});

describe("slot registry", () => {
  // These tests exercise the registration target wired by _setupRegistries,
  // so they need the real PluginBridge instead of the makeService stub.
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }

  function register(service, plugin, message) {
    const handler = service.pluginBridge._registrationTargets.get("slot");
    return handler(plugin, message);
  }

  function makePlugin(pluginId, calls = []) {
    return {
      pluginId,
      call: (handlerId, ...args) => {
        calls.push({ handlerId, args });
        return Promise.resolve({ tag: "div", attrs: {}, text: pluginId });
      },
    };
  }

  it("returns an empty list for unknown slots", () => {
    const service = makeServiceWithRealBridge();
    assert.deepEqual(service.getSlotEntries("nope"), []);
  });

  it("records registrations in order", async () => {
    const service = makeServiceWithRealBridge();
    register(service, makePlugin("alpha"), {
      target: "slot",
      name: "x",
      handlerId: 1,
    });
    register(service, makePlugin("beta"), {
      target: "slot",
      name: "x",
      handlerId: 2,
    });
    const entries = service.getSlotEntries("x");
    assert.deepEqual(
      entries.map((entry) => entry.pluginId),
      ["alpha", "beta"],
    );
  });

  it("invokes the plugin handler with the slot context", async () => {
    const service = makeServiceWithRealBridge();
    const calls = [];
    register(service, makePlugin("alpha", calls), {
      target: "slot",
      name: "x",
      handlerId: 7,
    });
    const [entry] = service.getSlotEntries("x");
    await entry.invoke({ uri: "at://test" });
    assert.deepEqual(calls, [{ handlerId: 7, args: [{ uri: "at://test" }] }]);
  });

  it("dispose removes the entry and prunes the slot when empty", () => {
    const service = makeServiceWithRealBridge();
    const dispose = register(service, makePlugin("alpha"), {
      target: "slot",
      name: "x",
      handlerId: 1,
    });
    assert.deepEqual(service.getSlotEntries("x").length, 1);
    dispose();
    assert.deepEqual(service.getSlotEntries("x"), []);
    assert.deepEqual(service.$slots.get("x"), null);
  });

  it("updates the $slots signal on register and unregister", () => {
    const service = makeServiceWithRealBridge();
    const updates = [];
    const initial = service.$slots.get("x");
    const dispose = register(service, makePlugin("alpha"), {
      target: "slot",
      name: "x",
      handlerId: 1,
    });
    updates.push(
      service.$slots.get("x")?.map((entry) => entry.pluginId) ?? null,
    );
    dispose();
    updates.push(
      service.$slots.get("x")?.map((entry) => entry.pluginId) ?? null,
    );
    assert.deepEqual(initial, null);
    assert.deepEqual(updates, [["alpha"], null]);
  });
});

describe("refreshSlot host method", () => {
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }

  function register(service, plugin, message) {
    const handler = service.pluginBridge._registrationTargets.get("slot");
    return handler(plugin, message);
  }

  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  it("re-invokes every entry registered for the slot", async () => {
    const service = makeServiceWithRealBridge();
    const calls = [];
    const makePlugin = (pluginId) => ({
      pluginId,
      call: (handlerId, ...args) => {
        calls.push({ pluginId, handlerId, args });
        return Promise.resolve(null);
      },
    });
    register(service, makePlugin("alpha"), {
      target: "slot",
      name: "x",
      handlerId: 1,
    });
    register(service, makePlugin("beta"), {
      target: "slot",
      name: "x",
      handlerId: 2,
    });
    for (const entry of service.getSlotEntries("x")) {
      await entry.invoke({});
    }
    calls.length = 0;

    await getHandler(service, "refreshSlot")(
      { pluginId: "alpha" },
      {
        name: "x",
      },
    );
    for (const entry of service.getSlotEntries("x")) {
      await entry.invoke({});
    }
    assert.deepEqual(
      calls.map((c) => c.pluginId),
      ["alpha", "beta"],
    );
  });

  it("is a no-op for a slot with no registered entries", () => {
    const service = makeServiceWithRealBridge();
    assert.doesNotThrow(() => {
      getHandler(service, "refreshSlot")(
        { pluginId: "alpha" },
        {
          name: "nope",
        },
      );
    });
    assert.deepEqual(service.getSlotEntries("nope"), []);
  });
});

describe("prefersReducedMotion host method", () => {
  // Regression test: plugin code always runs in a real Worker (even
  // "sandboxed" plugins relay into a nested Worker — see
  // plugin-sandbox.html), which has no window/matchMedia of its own. A
  // plugin (buddy) once called window.matchMedia directly from inside its
  // own code and crashed with "window is not defined" on every invocation,
  // permanently breaking its movement loop (the tick scheduler had no
  // error handling, so a throwing tick just silently stopped rescheduling
  // forever). This host method exists so plugins never need to touch
  // matchMedia themselves at all.
  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  it("reflects window.matchMedia's current value", () => {
    const { provider } = makeProvider();
    const service = new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
    const original = window.matchMedia;
    try {
      window.matchMedia = (query) => ({ matches: true, media: query });
      assert.equal(getHandler(service, "prefersReducedMotion")(), true);
      window.matchMedia = (query) => ({ matches: false, media: query });
      assert.equal(getHandler(service, "prefersReducedMotion")(), false);
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("broadcastEvent", () => {
  function addListener(service, event, pluginId, handler) {
    let listeners = service.registries.eventListeners.get(event);
    if (!listeners) {
      listeners = new Map();
      service.registries.eventListeners.set(event, listeners);
    }
    listeners.set(pluginId, handler);
  }

  it("does nothing when no listeners are registered", () => {
    const { service } = makeService();
    assert.doesNotThrow(() =>
      service.broadcastEvent("post-liked", { uri: "x" }),
    );
  });

  it("invokes every registered listener with the given args", async () => {
    const { service } = makeService();
    const calls = [];
    addListener(service, "post-liked", "alpha", (payload) => {
      calls.push({ pluginId: "alpha", payload });
    });
    addListener(service, "post-liked", "beta", (payload) => {
      calls.push({ pluginId: "beta", payload });
    });
    service.broadcastEvent("post-liked", { uri: "at://test" });
    // handler invocations are synchronous; only the .catch chaining is async
    assert.deepEqual(calls, [
      { pluginId: "alpha", payload: { uri: "at://test" } },
      { pluginId: "beta", payload: { uri: "at://test" } },
    ]);
  });

  it("catches a rejecting listener without affecting others", async () => {
    const { service } = makeService();
    const calls = [];
    addListener(service, "post-liked", "broken", async () => {
      throw new Error("boom");
    });
    addListener(service, "post-liked", "ok", (payload) => {
      calls.push(payload);
    });
    service.broadcastEvent("post-liked", { uri: "at://test" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, [{ uri: "at://test" }]);
  });
});

describe("app.data host methods", () => {
  function makeStubComputedMap(lookup) {
    const calls = [];
    const map = {
      get: (key) => {
        calls.push(key);
        return lookup(key);
      },
    };
    return { map, calls };
  }

  function makeService(dataLayerOverrides) {
    const { provider } = makeProvider();
    const dataLayer = Object.assign(emptyDataLayer(), dataLayerOverrides);
    return new PluginService(
      provider,
      null,
      dataLayer,
      new HiddenFeedItemsStore(),
    );
  }

  it("getProfile host method returns the hydrated profile from derived", async () => {
    const profiles = makeStubComputedMap((did) => ({
      did,
      handle: "alice.test",
    }));
    const service = makeService({
      derived: { $hydratedProfiles: profiles.map },
    });
    const handler = service.pluginBridge._hostCallHandlers.get("getProfile");
    const result = await handler(null, { did: "did:plc:abc" });
    assert.deepEqual(profiles.calls, ["did:plc:abc"]);
    assert.deepEqual(result, { did: "did:plc:abc", handle: "alice.test" });
  });

  it("getPost fetches the post on a cache miss", async () => {
    const ensureCalls = [];
    const service = makeService({
      declarative: {
        ensurePost: async (uri) => {
          ensureCalls.push(uri);
          return { uri, record: { text: "fetched" } };
        },
      },
    });
    const handler = service.pluginBridge._hostCallHandlers.get("getPost");
    const result = await handler(null, { uri: "at://example/post/1" });
    assert.deepEqual(ensureCalls, ["at://example/post/1"]);
    assert.deepEqual(result, {
      uri: "at://example/post/1",
      record: { text: "fetched" },
    });
  });

  it("getPost returns null when the post cannot be loaded", async () => {
    const service = makeService({
      declarative: {
        ensurePost: async () => {
          throw new Error("Post not found");
        },
      },
    });
    const handler = service.pluginBridge._hostCallHandlers.get("getPost");
    const result = await handler(null, { uri: "at://example/post/gone" });
    assert.deepEqual(result, null);
  });

  it("getProfile fetches on a cache miss and returns the basic hydrated profile", async () => {
    let loaded = false;
    const profiles = makeStubComputedMap((did) =>
      loaded ? { did, handle: "alice.test" } : null,
    );
    const ensureCalls = [];
    const service = makeService({
      derived: { $hydratedProfiles: profiles.map },
      declarative: {
        ensureDetailedProfile: async (did) => {
          ensureCalls.push(did);
          loaded = true;
        },
      },
    });
    const handler = service.pluginBridge._hostCallHandlers.get("getProfile");
    const result = await handler(null, { did: "did:plc:abc" });
    assert.deepEqual(ensureCalls, ["did:plc:abc"]);
    assert.deepEqual(result, { did: "did:plc:abc", handle: "alice.test" });
  });

  it("getKnownFollowers resolves via the declarative layer", async () => {
    const knownFollowers = { followers: [{ did: "did:plc:follower" }] };
    const ensureCalls = [];
    const service = makeService({
      declarative: {
        ensureKnownFollowers: async (did) => {
          ensureCalls.push(did);
          return knownFollowers;
        },
      },
    });
    const handler =
      service.pluginBridge._hostCallHandlers.get("getKnownFollowers");
    const result = await handler(null, { did: "did:plc:abc" });
    assert.deepEqual(ensureCalls, ["did:plc:abc"]);
    assert.deepEqual(result, knownFollowers);
  });

  it("getKnownFollowers returns null when the list cannot be loaded", async () => {
    const service = makeService({
      declarative: {
        ensureKnownFollowers: async () => {
          throw new Error("Known followers not found");
        },
      },
    });
    const handler =
      service.pluginBridge._hostCallHandlers.get("getKnownFollowers");
    const result = await handler(null, { did: "did:plc:missing" });
    assert.deepEqual(result, null);
  });

  it("getProfile returns null when the profile cannot be loaded", async () => {
    const service = makeService({
      derived: { $hydratedProfiles: makeStubComputedMap(() => null).map },
      declarative: {
        ensureDetailedProfile: async () => {
          throw new Error("Profile not found");
        },
      },
    });
    const handler = service.pluginBridge._hostCallHandlers.get("getProfile");
    const result = await handler(null, { did: "did:plc:missing" });
    assert.deepEqual(result, null);
  });
});

describe("action host methods", () => {
  const feedbackPlugin = {
    pluginId: "test-plugin",
    permissions: { actions: ["feedFeedback"] },
  };
  const postUri = "at://did:plc:author/app.bsky.feed.post/1";
  const feedUri = "at://did:plc:feedgen/app.bsky.feed.generator/cool-feed";

  function makeService({
    feedItem = null,
    feedGenerator = null,
    hydratedProfiles = {},
  } = {}) {
    const { provider } = makeProvider();
    const calls = {
      showLess: [],
      showMore: [],
      mute: [],
      unmute: [],
      block: [],
      unblock: [],
    };
    const dataLayer = Object.assign(new EventEmitter(), {
      dataStore: {
        $feeds: {
          get: (uri) =>
            uri === feedUri && feedItem ? { feed: [feedItem] } : null,
        },
      },
      derived: {
        $feedGenerators: {
          get: (uri) => (uri === feedUri ? feedGenerator : null),
        },
        $hydratedDetailedProfiles: { get: () => null },
        $hydratedProfiles: { get: (did) => hydratedProfiles[did] ?? null },
      },
      mutations: {
        sendShowLessInteraction: async (...args) => calls.showLess.push(args),
        sendShowMoreInteraction: async (...args) => calls.showMore.push(args),
        muteProfile: async (profile) => calls.mute.push(profile),
        unmuteProfile: async (profile) => calls.unmute.push(profile),
        blockProfile: async (profile) => calls.block.push(profile),
        unblockProfile: async (profile) => calls.unblock.push(profile),
      },
      declarative: {
        ensureProfile: async (did) => hydratedProfiles[did] ?? { did },
      },
    });
    const session = { did: "did:plc:me", handle: "me.test" };
    const service = new PluginService(
      provider,
      session,
      dataLayer,
      new HiddenFeedItemsStore(),
    );
    return { service, calls };
  }

  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  it("showLessLikeThis resolves feedContext and proxy from the feed", async () => {
    const { service, calls } = makeService({
      feedItem: { post: { uri: postUri }, feedContext: "ctx" },
      feedGenerator: { uri: feedUri, did: "did:web:feed.example" },
    });
    await getHandler(service, "showLessLikeThis")(feedbackPlugin, {
      postUri,
      feedUri,
    });
    assert.deepEqual(calls.showLess, [
      [postUri, feedUri, "ctx", "did:web:feed.example#bsky_fg"],
    ]);
  });

  it("showLessLikeThis and showMoreLikeThis reject when feedUri is missing", async () => {
    const { service, calls } = makeService();
    await assert.rejects(
      getHandler(service, "showLessLikeThis")(feedbackPlugin, { postUri }),
      /requires a feedUri/,
    );
    await assert.rejects(
      getHandler(service, "showMoreLikeThis")(feedbackPlugin, { postUri }),
      /requires a feedUri/,
    );
    assert.deepEqual(calls.showLess, []);
    assert.deepEqual(calls.showMore, []);
  });

  it("both methods reject when postUri is missing", async () => {
    const { service, calls } = makeService();
    await assert.rejects(
      getHandler(service, "showLessLikeThis")(feedbackPlugin, { feedUri }),
      /requires a postUri/,
    );
    await assert.rejects(
      getHandler(service, "showMoreLikeThis")(feedbackPlugin, { feedUri }),
      /requires a postUri/,
    );
    assert.deepEqual(calls.showLess, []);
    assert.deepEqual(calls.showMore, []);
  });

  it("muteActor and blockActor reject when did is missing", async () => {
    const { service } = makeService();
    await assert.rejects(
      getHandler(service, "muteActor")(
        { pluginId: "test-plugin", permissions: { actions: ["mute"] } },
        {},
      ),
      /muteActor requires a did/,
    );
    await assert.rejects(
      getHandler(service, "blockActor")(
        { pluginId: "test-plugin", permissions: { actions: ["block"] } },
        {},
      ),
      /blockActor requires a did/,
    );
  });

  it("showLessLikeThis with an uncached feed still resolves the generator proxy", async () => {
    const { service, calls } = makeService({
      feedGenerator: { uri: feedUri, did: "did:web:feed.example" },
    });
    await getHandler(service, "showLessLikeThis")(feedbackPlugin, {
      postUri,
      feedUri,
    });
    assert.deepEqual(calls.showLess, [
      [postUri, feedUri, null, "did:web:feed.example#bsky_fg"],
    ]);
  });

  it("showMoreLikeThis resolves attribution the same way", async () => {
    const { service, calls } = makeService({
      feedItem: { post: { uri: postUri }, feedContext: "ctx" },
      feedGenerator: { uri: feedUri, did: "did:web:feed.example" },
    });
    await getHandler(service, "showMoreLikeThis")(feedbackPlugin, {
      postUri,
      feedUri,
    });
    assert.deepEqual(calls.showMore, [
      [postUri, feedUri, "ctx", "did:web:feed.example#bsky_fg"],
    ]);
  });

  it("both methods require the feedFeedback action permission", async () => {
    const { service, calls } = makeService();
    const noPermissionPlugin = {
      pluginId: "test-plugin",
      permissions: { actions: ["mute"] },
    };
    for (const name of ["showLessLikeThis", "showMoreLikeThis"]) {
      await assert.rejects(
        getHandler(service, name)(noPermissionPlugin, { postUri, feedUri }),
        /"feedFeedback" action permission/,
      );
    }
    assert.deepEqual(calls.showLess, []);
    assert.deepEqual(calls.showMore, []);
  });

  it("muteActor routes the mute flag to muteProfile and unmuteProfile", async () => {
    const did = "did:plc:target";
    const profile = { did, handle: "target.example" };
    const { service, calls } = makeService({
      hydratedProfiles: { [did]: profile },
    });
    const mutePlugin = {
      pluginId: "test-plugin",
      permissions: { actions: ["mute"] },
    };
    await getHandler(service, "muteActor")(mutePlugin, { did, mute: true });
    await getHandler(service, "muteActor")(mutePlugin, { did, mute: false });
    assert.deepEqual(calls.mute, [profile]);
    assert.deepEqual(calls.unmute, [profile]);
  });

  it("blockActor routes the block flag to blockProfile and unblockProfile", async () => {
    const did = "did:plc:target";
    const { service, calls } = makeService();
    const blockPlugin = {
      pluginId: "test-plugin",
      permissions: { actions: ["block"] },
    };
    await getHandler(service, "blockActor")(blockPlugin, { did, block: true });
    await getHandler(service, "blockActor")(blockPlugin, { did, block: false });
    assert.deepEqual(calls.block, [{ did }]);
    assert.deepEqual(calls.unblock, [{ did }]);
  });

  it("muteActor and blockActor require their action permissions", async () => {
    const { service, calls } = makeService();
    const noPermissionPlugin = {
      pluginId: "test-plugin",
      permissions: { actions: ["feedFeedback"] },
    };
    const did = "did:plc:target";
    await assert.rejects(
      getHandler(service, "muteActor")(noPermissionPlugin, { did }),
      /"mute" action permission/,
    );
    await assert.rejects(
      getHandler(service, "blockActor")(noPermissionPlugin, { did }),
      /"block" action permission/,
    );
    assert.deepEqual(calls.mute, []);
    assert.deepEqual(calls.block, []);
  });

  it("all action methods reject when signed out", async () => {
    const { provider } = makeProvider();
    const service = new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
    const allActionsPlugin = {
      pluginId: "test-plugin",
      permissions: { actions: ["mute", "block", "feedFeedback"] },
    };
    const argsByMethod = {
      muteActor: { did: "did:plc:target" },
      blockActor: { did: "did:plc:target" },
      showLessLikeThis: { postUri, feedUri },
      showMoreLikeThis: { postUri, feedUri },
    };
    for (const [name, args] of Object.entries(argsByMethod)) {
      await assert.rejects(
        getHandler(service, name)(allActionsPlugin, args),
        /Not signed in/,
      );
    }
  });
});

describe("post/profile action host methods (like/repost/follow/bookmark)", () => {
  const postUri = "at://did:plc:author/app.bsky.feed.post/1";
  const did = "did:plc:target";
  const post = { uri: postUri, cid: "cid-1" };
  const profile = { did, handle: "target.example" };

  function makeService({
    resolvePost = () => post,
    resolveProfile = () => profile,
  } = {}) {
    const { provider } = makeProvider();
    const calls = {
      addLike: [],
      removeLike: [],
      createRepost: [],
      deleteRepost: [],
      followProfile: [],
      unfollowProfile: [],
      addBookmark: [],
      removeBookmark: [],
    };
    const dataLayer = {
      on: () => {},
      declarative: {
        ensurePost: async (uri) => resolvePost(uri),
        ensureDetailedProfile: async (d) => resolveProfile(d),
      },
      mutations: {
        addLike: async (p) => calls.addLike.push(p),
        removeLike: async (p) => calls.removeLike.push(p),
        createRepost: async (p) => calls.createRepost.push(p),
        deleteRepost: async (p) => calls.deleteRepost.push(p),
        followProfile: async (p) => calls.followProfile.push(p),
        unfollowProfile: async (p) => calls.unfollowProfile.push(p),
        addBookmark: async (p) => calls.addBookmark.push(p),
        removeBookmark: async (p) => calls.removeBookmark.push(p),
      },
    };
    const session = { did: "did:plc:me", handle: "me.test" };
    const service = new PluginService(
      provider,
      session,
      dataLayer,
      new HiddenFeedItemsStore(),
    );
    const broadcasts = [];
    service.broadcastEvent = (event, payload) =>
      broadcasts.push({ event, payload });
    return { service, calls, broadcasts };
  }

  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  const grantedPlugin = (scope) => ({
    pluginId: "test-plugin",
    permissions: { actions: [scope] },
  });
  const noPermissionPlugin = {
    pluginId: "test-plugin",
    permissions: { actions: [] },
  };

  it("likePost routes the like flag to addLike/removeLike and broadcasts post-liked/post-unliked", async () => {
    const { service, calls, broadcasts } = makeService();
    await getHandler(service, "likePost")(grantedPlugin("like"), {
      uri: postUri,
      like: true,
    });
    await getHandler(service, "likePost")(grantedPlugin("like"), {
      uri: postUri,
      like: false,
    });
    assert.deepEqual(calls.addLike, [post]);
    assert.deepEqual(calls.removeLike, [post]);
    assert.deepEqual(broadcasts, [
      { event: "post-liked", payload: { uri: postUri, position: null } },
      { event: "post-unliked", payload: { uri: postUri, position: null } },
    ]);
  });

  it("repostPost routes the repost flag to createRepost/deleteRepost and broadcasts", async () => {
    const { service, calls, broadcasts } = makeService();
    await getHandler(service, "repostPost")(grantedPlugin("repost"), {
      uri: postUri,
      repost: true,
    });
    await getHandler(service, "repostPost")(grantedPlugin("repost"), {
      uri: postUri,
      repost: false,
    });
    assert.deepEqual(calls.createRepost, [post]);
    assert.deepEqual(calls.deleteRepost, [post]);
    assert.deepEqual(broadcasts, [
      { event: "post-reposted", payload: { uri: postUri, position: null } },
      { event: "post-unreposted", payload: { uri: postUri, position: null } },
    ]);
  });

  it("followActor routes the follow flag to followProfile/unfollowProfile and broadcasts", async () => {
    const { service, calls, broadcasts } = makeService();
    await getHandler(service, "followActor")(grantedPlugin("follow"), {
      did,
      follow: true,
    });
    await getHandler(service, "followActor")(grantedPlugin("follow"), {
      did,
      follow: false,
    });
    assert.deepEqual(calls.followProfile, [profile]);
    assert.deepEqual(calls.unfollowProfile, [profile]);
    assert.deepEqual(broadcasts, [
      { event: "profile-followed", payload: { did, position: null } },
      { event: "profile-unfollowed", payload: { did, position: null } },
    ]);
  });

  it("bookmarkPost routes the bookmark flag to addBookmark/removeBookmark without broadcasting", async () => {
    const { service, calls, broadcasts } = makeService();
    await getHandler(service, "bookmarkPost")(grantedPlugin("bookmark"), {
      uri: postUri,
      bookmark: true,
    });
    await getHandler(service, "bookmarkPost")(grantedPlugin("bookmark"), {
      uri: postUri,
      bookmark: false,
    });
    assert.deepEqual(calls.addBookmark, [post]);
    assert.deepEqual(calls.removeBookmark, [post]);
    assert.deepEqual(broadcasts, []);
  });

  it("each method requires its own action permission", async () => {
    const { service, calls } = makeService();
    await assert.rejects(
      getHandler(service, "likePost")(noPermissionPlugin, { uri: postUri }),
      /"like" action permission/,
    );
    await assert.rejects(
      getHandler(service, "repostPost")(noPermissionPlugin, { uri: postUri }),
      /"repost" action permission/,
    );
    await assert.rejects(
      getHandler(service, "followActor")(noPermissionPlugin, { did }),
      /"follow" action permission/,
    );
    await assert.rejects(
      getHandler(service, "bookmarkPost")(noPermissionPlugin, { uri: postUri }),
      /"bookmark" action permission/,
    );
    assert.deepEqual(calls.addLike, []);
    assert.deepEqual(calls.createRepost, []);
    assert.deepEqual(calls.followProfile, []);
    assert.deepEqual(calls.addBookmark, []);
  });

  it("each method requires a uri/did argument", async () => {
    const { service } = makeService();
    await assert.rejects(
      getHandler(service, "likePost")(grantedPlugin("like"), {}),
      /likePost requires a uri/,
    );
    await assert.rejects(
      getHandler(service, "repostPost")(grantedPlugin("repost"), {}),
      /repostPost requires a uri/,
    );
    await assert.rejects(
      getHandler(service, "followActor")(grantedPlugin("follow"), {}),
      /followActor requires a did/,
    );
    await assert.rejects(
      getHandler(service, "bookmarkPost")(grantedPlugin("bookmark"), {}),
      /bookmarkPost requires a uri/,
    );
  });

  it("throws a clear error when the post/profile cannot be resolved", async () => {
    const { service } = makeService({
      resolvePost: () => null,
      resolveProfile: () => null,
    });
    await assert.rejects(
      getHandler(service, "likePost")(grantedPlugin("like"), { uri: postUri }),
      /Could not resolve post/,
    );
    await assert.rejects(
      getHandler(service, "followActor")(grantedPlugin("follow"), { did }),
      /Could not resolve profile/,
    );
  });

  it("all methods reject when signed out", async () => {
    const { provider } = makeProvider();
    const service = new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
    const allActionsPlugin = {
      pluginId: "test-plugin",
      permissions: { actions: ["like", "repost", "follow", "bookmark"] },
    };
    const argsByMethod = {
      likePost: { uri: postUri },
      repostPost: { uri: postUri },
      followActor: { did },
      bookmarkPost: { uri: postUri },
    };
    for (const [name, args] of Object.entries(argsByMethod)) {
      await assert.rejects(
        getHandler(service, name)(allActionsPlugin, args),
        /Not signed in/,
      );
    }
  });
});

describe("getRecord host method", () => {
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }

  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }

  const VALID_COLLECTION = "blue.moji.collection.item";
  const VALID_RKEY = "blobcat";

  let didCounter = 0;
  function uniqueDid() {
    didCounter++;
    return `did:plc:test${didCounter.toString().padStart(6, "0")}`;
  }

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(handler) {
    const calls = [];
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      return handler(url);
    };
    return { calls };
  }

  it("fetches the record from Slingshot", async () => {
    const service = makeServiceWithRealBridge();
    const did = uniqueDid();
    const record = {
      uri: `at://${did}/${VALID_COLLECTION}/${VALID_RKEY}`,
      cid: "bafyfake",
      value: { name: "blobcat" },
    };
    const { calls } = stubFetch(async () => jsonResponse(200, record));
    const handler = service.pluginBridge._hostCallHandlers.get("getRecord");
    const result = await handler(null, {
      repo: did,
      collection: VALID_COLLECTION,
      rkey: VALID_RKEY,
    });
    assert.deepEqual(result, record);
    const url = new URL(calls[0]);
    assert.deepEqual(url.origin, "https://slingshot.microcosm.blue");
    assert.deepEqual(url.pathname, "/xrpc/com.atproto.repo.getRecord");
    assert.deepEqual(url.searchParams.get("repo"), did);
    assert.deepEqual(url.searchParams.get("collection"), VALID_COLLECTION);
    assert.deepEqual(url.searchParams.get("rkey"), VALID_RKEY);
  });

  it("returns null on RecordNotFound", async () => {
    const service = makeServiceWithRealBridge();
    const did = uniqueDid();
    stubFetch(async () =>
      jsonResponse(400, { error: "RecordNotFound", message: "gone" }),
    );
    const handler = service.pluginBridge._hostCallHandlers.get("getRecord");
    const result = await handler(null, {
      repo: did,
      collection: VALID_COLLECTION,
      rkey: VALID_RKEY,
    });
    assert.deepEqual(result, null);
  });

  it("rejects on other errors so the plugin can retry", async () => {
    const service = makeServiceWithRealBridge();
    const did = uniqueDid();
    stubFetch(async () => jsonResponse(502, null));
    const handler = service.pluginBridge._hostCallHandlers.get("getRecord");
    let caught = null;
    try {
      await handler(null, {
        repo: did,
        collection: VALID_COLLECTION,
        rkey: VALID_RKEY,
      });
    } catch (e) {
      caught = e;
    }
    assert(caught !== null);
  });

  it("rejects invalid repo/collection/rkey inputs without hitting the network", async () => {
    const service = makeServiceWithRealBridge();
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return jsonResponse(200, {});
    };
    const handler = service.pluginBridge._hostCallHandlers.get("getRecord");
    const invalidInputs = [
      { repo: "not-a-did", collection: VALID_COLLECTION, rkey: VALID_RKEY },
      { repo: "did:plc:abc", collection: "not.enough", rkey: VALID_RKEY },
      { repo: "did:plc:abc", collection: VALID_COLLECTION, rkey: "" },
      { repo: "did:plc:abc", collection: VALID_COLLECTION, rkey: "has/slash" },
    ];
    for (const inputs of invalidInputs) {
      let caught = null;
      try {
        await handler(null, inputs);
      } catch (e) {
        caught = e;
      }
      assert(
        caught !== null,
        `expected rejection for ${JSON.stringify(inputs)}`,
      );
    }
    assert.deepEqual(fetched, false);
  });
});

describe("configured endpoint host methods", () => {
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }

  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  let pluginIdCounter = 0;
  function uniquePlugin(permissions) {
    pluginIdCounter++;
    return {
      pluginId: `endpoint-test-${pluginIdCounter}`,
      manifest: { name: `Endpoint Test ${pluginIdCounter}` },
      permissions,
    };
  }

  const grantedPlugin = () => uniquePlugin({ network: ["configuredEndpoint"] });
  const noPermissionPlugin = () => uniquePlugin({});

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("getConfiguredEndpointUrl requires network permission", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "getConfiguredEndpointUrl")(noPermissionPlugin()),
      /"configuredEndpoint" network permission/,
    );
  });

  it("getConfiguredEndpointUrl returns null before anything is approved", async () => {
    const service = makeServiceWithRealBridge();
    const result = await getHandler(
      service,
      "getConfiguredEndpointUrl",
    )(grantedPlugin());
    assert.deepEqual(result, null);
  });

  it("requestConfiguredEndpointUrl requires network permission", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "requestConfiguredEndpointUrl")(
        noPermissionPlugin(),
        { url: "https://api.example.com/v1" },
      ),
      /"configuredEndpoint" network permission/,
    );
  });

  it("rejects an unacceptable url before ever showing a modal", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "requestConfiguredEndpointUrl")(grantedPlugin(), {
        url: "http://example.com/v1",
      }),
      /not an allowed endpoint address/,
    );
    // If a modal had opened, this would hang forever waiting for a button
    // that's never rendered — completing at all is the assertion.
  });

  it("stores the url and returns accepted:true when the user allows it", async () => {
    const service = makeServiceWithRealBridge();
    const plugin = grantedPlugin();
    const url = "https://api.example.com/v1/chat/completions";
    const requesting = getHandler(service, "requestConfiguredEndpointUrl")(
      plugin,
      { url },
    );
    await respondToConfirm(true);
    const result = await requesting;
    assert.deepEqual(result, { accepted: true, url });
    const stored = await getHandler(
      service,
      "getConfiguredEndpointUrl",
    )(plugin);
    assert.deepEqual(stored, url);
  });

  it("does not persist the url when the user declines", async () => {
    const service = makeServiceWithRealBridge();
    const plugin = grantedPlugin();
    const url = "https://api.example.com/v1/chat/completions";
    const requesting = getHandler(service, "requestConfiguredEndpointUrl")(
      plugin,
      { url },
    );
    await respondToConfirm(false);
    const result = await requesting;
    assert.deepEqual(result, { accepted: false, url: null });
  });

  it("configuredFetch requires network permission", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "configuredFetch")(noPermissionPlugin(), {
        url: "https://api.example.com/v1",
        init: {},
      }),
      /"configuredEndpoint" network permission/,
    );
  });

  it("configuredFetch delegates to the approved url only", async () => {
    const service = makeServiceWithRealBridge();
    const plugin = grantedPlugin();
    const url = "https://api.example.com/v1/chat/completions";
    const requesting = getHandler(service, "requestConfiguredEndpointUrl")(
      plugin,
      { url },
    );
    await respondToConfirm(true);
    await requesting;

    let called = null;
    globalThis.fetch = async (fetchUrl, init) => {
      called = { fetchUrl, init };
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () => "{}",
      };
    };
    const result = await getHandler(service, "configuredFetch")(plugin, {
      url,
      init: { headers: { Authorization: "Bearer sk-test" } },
    });
    assert.deepEqual(result.status, 200);
    assert.deepEqual(called.fetchUrl, url);
    assert.deepEqual(called.init.headers.Authorization, "Bearer sk-test");

    await assert.rejects(
      getHandler(service, "configuredFetch")(plugin, {
        url: "https://evil.com/x",
        init: {},
      }),
      /not the approved endpoint/,
    );
  });

  it("uninstallPlugin clears the stored endpoint", async () => {
    const service = makeServiceWithRealBridge();
    service.sourceProvider = { getCacheUrls: async () => [] };
    service.pluginCache = { reconcile: async () => {} };
    service.pluginCustomImages = { purgeForPlugin: async () => {} };
    const plugin = grantedPlugin();
    const url = "https://api.example.com/v1/chat/completions";
    const requesting = getHandler(service, "requestConfiguredEndpointUrl")(
      plugin,
      { url },
    );
    await respondToConfirm(true);
    await requesting;
    assert.deepEqual(
      await getHandler(service, "getConfiguredEndpointUrl")(plugin),
      url,
    );
    await service.uninstallPlugin(plugin.pluginId);
    assert.deepEqual(
      await getHandler(service, "getConfiguredEndpointUrl")(plugin),
      null,
    );
  });
});

describe("custom image host methods", () => {
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }

  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  let pluginIdCounter = 0;
  function uniquePlugin(permissions, manifestImageNames = []) {
    pluginIdCounter++;
    return {
      pluginId: `image-test-${pluginIdCounter}`,
      manifest: {
        name: `Image Test ${pluginIdCounter}`,
        images: manifestImageNames.map((name) => ({ name })),
      },
      permissions,
    };
  }

  const grantedPlugin = (manifestImageNames) =>
    uniquePlugin({ images: ["upload"] }, manifestImageNames);
  const noPermissionPlugin = () => uniquePlugin({});

  function makeFakeFile(bytes = new Uint8Array([1, 2, 3]).buffer) {
    return {
      arrayBuffer: async () => bytes,
    };
  }

  it("registerCustomImage requires images upload permission", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "registerCustomImage")(noPermissionPlugin(), {
        name: "x",
        frameWidth: 1,
        frameHeight: 1,
        frameCount: 1,
        fileToken: "tok",
      }),
      /"upload" images permission/,
    );
  });

  it("registerCustomImage rejects a missing/expired file token", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "registerCustomImage")(grantedPlugin(), {
        name: "x",
        frameWidth: 1,
        frameHeight: 1,
        frameCount: 1,
        fileToken: "nonexistent",
      }),
      /No staged file/,
    );
  });

  it("registerCustomImage stages a file, stores it, and mounts it for rendering", async () => {
    const service = makeServiceWithRealBridge();
    // Swap in a fake so the test doesn't touch real indexedDB or
    // createImageBitmap (unavailable in this node-based test env — see
    // pluginCustomImages.test.js for its own dedicated coverage).
    const registeredCalls = [];
    service.pluginCustomImages = {
      register: async (pluginId, meta, bytes) => {
        registeredCalls.push({ pluginId, meta, bytes });
        return {
          pluginId,
          name: meta.name,
          blob: { fake: true },
          frameWidth: meta.frameWidth,
          frameHeight: meta.frameHeight,
          frameCount: meta.frameCount,
          size: bytes.byteLength,
        };
      },
    };
    const mountCalls = [];
    service.pluginAssetsLoader = {
      mountCustomImage: (pluginId, name, descriptor) => {
        mountCalls.push({ pluginId, name, descriptor });
      },
    };
    const plugin = grantedPlugin(["idle_breathe"]);
    const file = makeFakeFile();
    const token = service.pluginFileStaging.stage(plugin.pluginId, file);
    const result = await getHandler(service, "registerCustomImage")(plugin, {
      name: "my_dance",
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 4,
      fileToken: token,
    });
    assert.deepEqual(result, {
      name: "my_dance",
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 4,
      size: 3,
    });
    assert.deepEqual(registeredCalls[0].meta.name, "my_dance");
    assert.deepEqual(mountCalls.length, 1);
    assert.deepEqual(mountCalls[0].name, "my_dance");
    // The token is single-use.
    assert.deepEqual(
      service.pluginFileStaging.take(plugin.pluginId, token),
      null,
    );
  });

  it("listCustomImages requires permission and delegates to the store", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "listCustomImages")(noPermissionPlugin()),
      /"upload" images permission/,
    );
    const plugin = grantedPlugin();
    service.pluginCustomImages = {
      list: async (pluginId) => [{ name: `list-for-${pluginId}` }],
    };
    const result = await getHandler(service, "listCustomImages")(plugin);
    assert.deepEqual(result, [{ name: `list-for-${plugin.pluginId}` }]);
  });

  it("deleteCustomImage requires permission and unmounts the image", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "deleteCustomImage")(noPermissionPlugin(), {
        name: "x",
      }),
      /"upload" images permission/,
    );
    const plugin = grantedPlugin();
    const deleteCalls = [];
    const unmountCalls = [];
    service.pluginCustomImages = {
      delete: async (pluginId, name) => deleteCalls.push({ pluginId, name }),
    };
    service.pluginAssetsLoader = {
      unmountImage: (pluginId, name) => unmountCalls.push({ pluginId, name }),
    };
    await getHandler(service, "deleteCustomImage")(plugin, { name: "gone" });
    assert.deepEqual(deleteCalls, [
      { pluginId: plugin.pluginId, name: "gone" },
    ]);
    assert.deepEqual(unmountCalls, [
      { pluginId: plugin.pluginId, name: "gone" },
    ]);
  });

  it("deleteCustomImage restores the bundled image when the deleted name overrode one", async () => {
    const service = makeServiceWithRealBridge();
    const plugin = grantedPlugin(["idle_breathe"]);
    // grantedPlugin only sets manifest.images[].name — fill in the rest of
    // the manifest image entry deleteCustomImage needs to re-fetch it.
    plugin.manifest.images = [
      {
        name: "idle_breathe",
        file: "assets/001_idle_breathe.png",
        frameWidth: 128,
        frameHeight: 128,
        frameCount: 15,
      },
    ];
    service.pluginCustomImages = { delete: async () => {} };
    service.prefManager.$installedPlugin = {
      get: () => ({ version: "1.2.3", repo: "tangled:alice/buddy" }),
    };
    const getImageCalls = [];
    service.sourceProvider = {
      getImage: async (pluginId, version, repo, file, geometry) => {
        getImageCalls.push({ pluginId, version, repo, file, geometry });
        return { fake: "bundled-blob" };
      },
    };
    const mountCalls = [];
    service.pluginAssetsLoader = {
      unmountImage: () => {
        throw new Error("should not unmount — should restore instead");
      },
      mountCustomImage: (pluginId, name, descriptor) => {
        mountCalls.push({ pluginId, name, descriptor });
      },
    };
    await getHandler(service, "deleteCustomImage")(plugin, {
      name: "idle_breathe",
    });
    assert.deepEqual(getImageCalls, [
      {
        pluginId: plugin.pluginId,
        version: "1.2.3",
        repo: "tangled:alice/buddy",
        file: "assets/001_idle_breathe.png",
        geometry: { frameWidth: 128, frameHeight: 128, frameCount: 15 },
      },
    ]);
    assert.deepEqual(mountCalls, [
      {
        pluginId: plugin.pluginId,
        name: "idle_breathe",
        descriptor: {
          blob: { fake: "bundled-blob" },
          frameWidth: 128,
          frameHeight: 128,
          frameCount: 15,
        },
      },
    ]);
  });

  it("uninstallPlugin purges custom images", async () => {
    const service = makeServiceWithRealBridge();
    service.sourceProvider = { getCacheUrls: async () => [] };
    service.pluginCache = { reconcile: async () => {} };
    const purgeCalls = [];
    service.pluginCustomImages = {
      purgeForPlugin: async (pluginId) => purgeCalls.push(pluginId),
    };
    const plugin = grantedPlugin();
    await service.uninstallPlugin(plugin.pluginId);
    assert.deepEqual(purgeCalls, [plugin.pluginId]);
  });
});

describe("clipboard host methods", () => {
  function makeServiceWithRealBridge() {
    const { provider } = makeProvider();
    return new PluginService(
      provider,
      null,
      emptyDataLayer(),
      new HiddenFeedItemsStore(),
    );
  }

  function getHandler(service, name) {
    return service.pluginBridge._hostCallHandlers.get(name);
  }

  const grantedPlugin = () => ({
    pluginId: "clipboard-test",
    manifest: { name: "Clipboard Test" },
    permissions: { clipboard: ["write"] },
  });
  const noPermissionPlugin = () => ({
    pluginId: "clipboard-test-no-perm",
    manifest: { name: "Clipboard Test" },
    permissions: {},
  });

  it("copyToClipboard requires clipboard write permission", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "copyToClipboard")(noPermissionPlugin(), {
        text: "hello",
      }),
      /"write" clipboard permission/,
    );
  });

  it("copyToClipboard rejects a missing text argument", async () => {
    const service = makeServiceWithRealBridge();
    await assert.rejects(
      getHandler(service, "copyToClipboard")(grantedPlugin(), {}),
      /text/,
    );
  });

  it("copyToClipboard writes the exact text to navigator.clipboard", async () => {
    const service = makeServiceWithRealBridge();
    const writeCalls = [];
    const originalClipboard = navigator.clipboard;
    navigator.clipboard = {
      writeText: async (text) => writeCalls.push(text),
    };
    try {
      await getHandler(service, "copyToClipboard")(grantedPlugin(), {
        text: "drafted reply text",
      });
    } finally {
      navigator.clipboard = originalClipboard;
    }
    assert.deepEqual(writeCalls, ["drafted reply text"]);
  });
});

describe("getPostComposerInit", () => {
  function addListener(service, pluginId, handler) {
    let listeners = service.registries.eventListeners.get("post-composer-open");
    if (!listeners) {
      listeners = new Map();
      service.registries.eventListeners.set("post-composer-open", listeners);
    }
    listeners.set(pluginId, handler);
  }

  it("returns null when no listeners are registered", async () => {
    const { service } = makeService();
    const result = await service.getPostComposerInit({ kind: "post" });
    assert.deepEqual(result, null);
  });

  it("returns null when listeners contribute no ops and no cursor", async () => {
    const { service } = makeService();
    addListener(service, "noop", async () => ({ ops: [], cursor: null }));
    addListener(service, "alsoNoop", async () => null);
    const result = await service.getPostComposerInit({ kind: "post" });
    assert.deepEqual(result, null);
  });

  it("appends text from a single listener", async () => {
    const { service } = makeService();
    addListener(service, "sig", async () => ({
      ops: [{ op: "append", text: "\n\n— signed" }],
      cursor: null,
    }));
    const result = await service.getPostComposerInit({ kind: "post" });
    assert.deepEqual(result, { text: "\n\n— signed", cursor: null });
  });

  it("composes set/append/prepend across multiple listeners in order", async () => {
    const { service } = makeService();
    addListener(service, "alpha", async () => ({
      ops: [{ op: "set", text: "middle" }],
      cursor: null,
    }));
    addListener(service, "beta", async () => ({
      ops: [{ op: "append", text: " end" }],
      cursor: null,
    }));
    addListener(service, "gamma", async () => ({
      ops: [{ op: "prepend", text: "start " }],
      cursor: null,
    }));
    const result = await service.getPostComposerInit({ kind: "post" });
    assert.deepEqual(result.text, "start middle end");
  });

  it("last setCursor wins; nulls do not clobber prior cursor", async () => {
    const { service } = makeService();
    addListener(service, "alpha", async () => ({
      ops: [{ op: "append", text: "a" }],
      cursor: 0,
    }));
    addListener(service, "beta", async () => ({
      ops: [{ op: "append", text: "b" }],
      cursor: null,
    }));
    addListener(service, "gamma", async () => ({
      ops: [{ op: "append", text: "c" }],
      cursor: -1,
    }));
    const result = await service.getPostComposerInit({ kind: "post" });
    assert.deepEqual(result, { text: "abc", cursor: -1 });
  });

  it("ignores listeners that throw", async () => {
    const { service } = makeService();
    addListener(service, "alpha", async () => {
      throw new Error("boom");
    });
    addListener(service, "beta", async () => ({
      ops: [{ op: "append", text: "ok" }],
      cursor: null,
    }));
    const originalError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await service.getPostComposerInit({ kind: "post" });
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(result, { text: "ok", cursor: null });
  });

  it("passes context through to each listener", async () => {
    const { service } = makeService();
    let captured = null;
    addListener(service, "alpha", async (context) => {
      captured = context;
      return { ops: [], cursor: null };
    });
    const context = { kind: "reply", replyTo: { uri: "at://x" } };
    await service.getPostComposerInit(context);
    // The service normalizes the context, so absent fields arrive as
    // explicit undefined keys
    assert.deepEqual(captured, {
      kind: "reply",
      replyTo: { uri: "at://x" },
      replyRoot: undefined,
      quotedPost: undefined,
    });
  });
});

describe("rich text transform pipeline", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function makeContext({
    uri = "at://did:test/app.bsky.feed.post/1",
    surface = "largePost",
    text = "hello",
    facets = [],
  } = {}) {
    return {
      surface,
      uri,
      did: "did:test",
      numberOfLines: null,
      source: { text, facets },
    };
  }

  function addTransform(service, pluginId, invoke) {
    const entry = { pluginId, invoke };
    service.registries.richTextTransforms.add(entry);
    return entry;
  }

  function silencingErrors(run) {
    const originalError = console.error;
    console.error = () => {};
    return Promise.resolve()
      .then(run)
      .finally(() => {
        console.error = originalError;
      });
  }

  it("resolves null with no transforms registered", async () => {
    const { service } = makeService();
    const tokens = [{ type: "text", value: "hello" }];
    assert.deepEqual(
      await service.transformRichTextTokens(tokens, makeContext()),
      null,
    );
  });

  it("resolves the transformed tokens and caches them per post and surface", async () => {
    const { service } = makeService();
    const batches = [];
    addTransform(service, "alpha", async (batch) => {
      batches.push(batch);
      return batch.map(({ tokens }) => ({
        value: [...tokens, { type: "text", value: "!" }],
      }));
    });
    const tokens = [{ type: "text", value: "hello" }];
    const context = makeContext();

    const transformed = await service.transformRichTextTokens(tokens, context);
    assert.deepEqual(transformed, [
      { type: "text", value: "hello" },
      { type: "text", value: "!" },
    ]);

    // Second request hits the cache: same result, no extra plugin call.
    assert.deepEqual(
      await service.transformRichTextTokens(tokens, context),
      transformed,
    );
    assert.deepEqual(batches.length, 1);
  });

  it("batches all posts of a render burst into one call per plugin", async () => {
    const { service } = makeService();
    const batches = [];
    addTransform(service, "alpha", async (batch) => {
      batches.push(batch);
      return batch.map(({ tokens }) => ({ value: tokens }));
    });

    await Promise.all([
      service.transformRichTextTokens(
        [{ type: "text", value: "one" }],
        makeContext({ uri: "at://post/1", text: "one" }),
      ),
      service.transformRichTextTokens(
        [{ type: "text", value: "two" }],
        makeContext({ uri: "at://post/2", text: "two" }),
      ),
    ]);

    assert.deepEqual(batches.length, 1);
    assert.deepEqual(batches[0].length, 2);
    assert.deepEqual(batches[0][0].tokens, [{ type: "text", value: "one" }]);
    assert.deepEqual(batches[0][1].tokens, [{ type: "text", value: "two" }]);
  });

  it("shares one run between concurrent requests for the same post and surface", async () => {
    const { service } = makeService();
    const batches = [];
    addTransform(service, "alpha", async (batch) => {
      batches.push(batch);
      return batch.map(({ tokens }) => ({ value: tokens }));
    });
    const tokens = [{ type: "text", value: "hello" }];
    const context = makeContext();

    const [first, second] = await Promise.all([
      service.transformRichTextTokens(tokens, context),
      service.transformRichTextTokens(tokens, context),
    ]);

    assert.deepEqual(first, second);
    assert.deepEqual(batches.length, 1);
    assert.deepEqual(batches[0].length, 1);
  });

  it("chains transforms in registration order", async () => {
    const { service } = makeService();
    addTransform(service, "alpha", async (batch) =>
      batch.map(({ tokens }) => ({
        value: [...tokens, { type: "text", value: "A" }],
      })),
    );
    addTransform(service, "beta", async (batch) =>
      batch.map(({ tokens }) => ({
        value: [...tokens, { type: "text", value: "B" }],
      })),
    );

    const transformed = await service.transformRichTextTokens(
      [{ type: "text", value: "hello" }],
      makeContext(),
    );

    assert.deepEqual(
      transformed.map((token) => token.value),
      ["hello", "A", "B"],
    );
  });

  it("fails open when a transform throws", async () => {
    const { service } = makeService();
    addTransform(service, "alpha", async () => {
      throw new Error("boom");
    });
    addTransform(service, "beta", async (batch) =>
      batch.map(({ tokens }) => ({
        value: [...tokens, { type: "text", value: "B" }],
      })),
    );

    const transformed = await silencingErrors(() =>
      service.transformRichTextTokens(
        [{ type: "text", value: "hello" }],
        makeContext(),
      ),
    );

    assert.deepEqual(
      transformed.map((token) => token.value),
      ["hello", "B"],
    );
  });

  it("fails open per item on error entries and malformed tokens", async () => {
    const { service } = makeService();
    addTransform(service, "alpha", async (batch) =>
      batch.map(({ context }) =>
        context.uri.endsWith("/1")
          ? { error: "no thanks" }
          : { value: [{ type: "bogus" }] },
      ),
    );

    const [first, second] = await silencingErrors(() =>
      Promise.all([
        service.transformRichTextTokens(
          [{ type: "text", value: "one" }],
          makeContext({ uri: "at://post/1", text: "one" }),
        ),
        service.transformRichTextTokens(
          [{ type: "text", value: "two" }],
          makeContext({ uri: "at://post/2", text: "two" }),
        ),
      ]),
    );

    assert.deepEqual(first, [{ type: "text", value: "one" }]);
    assert.deepEqual(second, [{ type: "text", value: "two" }]);
  });

  it("re-hydrates returned facet tokens to the host originals", async () => {
    const { service } = makeService();
    const facet = {
      index: { byteStart: 0, byteEnd: 4 },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: "tag" }],
    };
    const facetToken = { type: "facet", facet, text: "#tag" };
    // Simulate the structured-clone boundary: the plugin returns a copy.
    addTransform(service, "alpha", async (batch) =>
      batch.map(({ tokens }) => ({
        value: JSON.parse(JSON.stringify(tokens)),
      })),
    );

    const transformed = await service.transformRichTextTokens(
      [facetToken, { type: "text", value: " in front" }],
      makeContext({ text: "#tag in front", facets: [facet] }),
    );

    assert(
      transformed[0] === facetToken,
      "facet token should be the host object",
    );
  });

  it("rejects a result containing an unrecognized facet", async () => {
    const { service } = makeService();
    addTransform(service, "alpha", async (batch) =>
      batch.map(() => ({
        value: [
          {
            type: "facet",
            facet: { index: { byteStart: 0, byteEnd: 99 }, features: [] },
            text: "forged",
          },
        ],
      })),
    );
    const tokens = [{ type: "text", value: "hello" }];

    const transformed = await silencingErrors(() =>
      service.transformRichTextTokens(tokens, makeContext()),
    );

    assert.deepEqual(transformed, tokens);
  });

  it("stamps inline/block tokens with the emitting transform's pluginId and preserves earlier ids", async () => {
    const { service } = makeService();
    const node = { tag: "code", text: "x" };
    addTransform(service, "alpha", async (batch) =>
      batch.map(() => ({ value: [{ type: "inline", node }] })),
    );
    addTransform(service, "beta", async (batch) =>
      batch.map(({ tokens }) => ({
        value: [...tokens, { type: "block", node }],
      })),
    );

    const transformed = await service.transformRichTextTokens(
      [{ type: "text", value: "hello" }],
      makeContext(),
    );

    assert.deepEqual(
      transformed.map((token) => token.pluginId),
      ["alpha", "beta"],
    );
  });

  it("re-stamps a forged pluginId naming another plugin", async () => {
    const { service } = makeService();
    const node = { tag: "code", text: "x" };
    addTransform(service, "alpha", async (batch) =>
      batch.map(() => ({
        value: [{ type: "inline", pluginId: "victim", node }],
      })),
    );

    const transformed = await service.transformRichTextTokens(
      [{ type: "text", value: "hello" }],
      makeContext(),
    );

    assert.deepEqual(
      transformed.map((token) => token.pluginId),
      ["alpha"],
    );
  });

  it("clears cached results when the transform set changes", async () => {
    const { service } = makeService();
    const batches = [];
    addTransform(service, "alpha", async (batch) => {
      batches.push(batch);
      return batch.map(({ tokens }) => ({ value: tokens }));
    });
    const tokens = [{ type: "text", value: "hello" }];
    const context = makeContext();

    await service.transformRichTextTokens(tokens, context);
    service._invalidateRichTextTransforms();
    await service.transformRichTextTokens(tokens, context);

    assert.deepEqual(batches.length, 2);
  });

  it("resolves in-flight requests with null when transforms change mid-run", async () => {
    const { service } = makeService();
    let releaseTransform;
    const gate = new Promise((resolve) => {
      releaseTransform = resolve;
    });
    addTransform(service, "alpha", async (batch) => {
      await gate;
      return batch.map(({ tokens }) => ({ value: tokens }));
    });
    const request = service.transformRichTextTokens(
      [{ type: "text", value: "hello" }],
      makeContext(),
    );
    await flush();
    service._invalidateRichTextTransforms();
    releaseTransform();

    assert.deepEqual(await request, null);
    assert.deepEqual(service._richTextTokensCache.size, 0);
  });

  it("re-runs when the cached entry no longer matches the source text", async () => {
    const { service } = makeService();
    const batches = [];
    addTransform(service, "alpha", async (batch) => {
      batches.push(batch);
      return batch.map(({ tokens }) => ({ value: tokens }));
    });
    const context = makeContext({ text: "before" });

    await service.transformRichTextTokens(
      [{ type: "text", value: "before" }],
      context,
    );
    const transformed = await service.transformRichTextTokens(
      [{ type: "text", value: "after" }],
      makeContext({ text: "after" }),
    );

    assert.deepEqual(batches.length, 2);
    assert.deepEqual(transformed, [{ type: "text", value: "after" }]);
  });

  it("renderRichTextNodeToken mounts a sanitized element and reuses it per token and host", () => {
    const { service } = makeService();
    const token = {
      type: "inline",
      pluginId: "alpha",
      node: { tag: "code", attrs: {}, text: "x", children: [], events: {} },
    };
    const host = document.createElement("div");

    const element = service.renderRichTextNodeToken(token, host);
    assert.deepEqual(element.localName, "code");
    assert.deepEqual(element.textContent, "x");
    assert(service.renderRichTextNodeToken(token, host) === element);
    const otherHost = document.createElement("div");
    const otherElement = service.renderRichTextNodeToken(token, otherHost);
    assert.deepEqual(otherElement.localName, "code");
    assert(otherElement !== element);
  });
});
