import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginCustomImages } from "/js/plugins/pluginCustomImages.js";

// A minimal in-memory stand-in for IndexedDbCustomImageStore, since
// indexedDB isn't available in this project's node-based unit test
// environment. PluginCustomImages only ever talks to its store through
// list/put/remove, so this is a faithful substitute.
function makeFakeStore() {
  const records = new Map(); // "pluginId::name" -> record
  return {
    records,
    async list(pluginId) {
      return [...records.values()].filter((r) => r.pluginId === pluginId);
    },
    async put(pluginId, name, record) {
      records.set(`${pluginId}::${name}`, record);
    },
    async remove(pluginId, name) {
      records.delete(`${pluginId}::${name}`);
    },
  };
}

function makeFakeValidator({ blobSize } = {}) {
  const calls = [];
  const validateImage = async (bytes, geometry, label) => {
    calls.push({ bytes, geometry, label });
    return { size: blobSize ?? bytes.byteLength, _fakeBlob: true };
  };
  return { validateImage, calls };
}

function bytesOfLength(n) {
  return new ArrayBuffer(n);
}

describe("PluginCustomImages.register", () => {
  it("validates and stores a new image, returning the full record", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    const record = await images.register(
      "buddy",
      { name: "my_dance", frameWidth: 64, frameHeight: 64, frameCount: 8 },
      bytesOfLength(1000),
    );
    assert.deepEqual(record.name, "my_dance");
    assert.deepEqual(record.frameWidth, 64);
    assert.deepEqual(record.size, 1000);
    assert.deepEqual(store.records.size, 1);
  });

  it("rejects an invalid name", async () => {
    const images = new PluginCustomImages({
      store: makeFakeStore(),
      validateImage: makeFakeValidator().validateImage,
    });
    await assert.rejects(
      images.register(
        "buddy",
        { name: "has a space", frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(10),
      ),
      /1-64 characters/,
    );
    await assert.rejects(
      images.register(
        "buddy",
        { name: "", frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(10),
      ),
      /1-64 characters/,
    );
  });

  it("allows a name that collides with a bundled manifest image, to override it", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    const record = await images.register(
      "buddy",
      { name: "idle_breathe", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(10),
    );
    assert.deepEqual(record.name, "idle_breathe");
  });

  it("rejects non-positive-integer geometry", async () => {
    const images = new PluginCustomImages({
      store: makeFakeStore(),
      validateImage: makeFakeValidator().validateImage,
    });
    for (const bad of [
      { frameWidth: 0, frameHeight: 1, frameCount: 1 },
      { frameWidth: 1, frameHeight: -1, frameCount: 1 },
      { frameWidth: 1, frameHeight: 1, frameCount: 1.5 },
      { frameWidth: 1, frameHeight: 1, frameCount: "3" },
    ]) {
      await assert.rejects(
        images.register("buddy", { name: "x", ...bad }, bytesOfLength(10)),
        /positive integers/,
      );
    }
  });

  it("enforces the per-plugin image count cap", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    for (let i = 0; i < 20; i++) {
      await images.register(
        "buddy",
        { name: `img_${i}`, frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(1),
      );
    }
    await assert.rejects(
      images.register(
        "buddy",
        { name: "one_too_many", frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(1),
      ),
      /maximum of 20/,
    );
  });

  it("does not count replacing an existing name against the count cap", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    for (let i = 0; i < 20; i++) {
      await images.register(
        "buddy",
        { name: `img_${i}`, frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(1),
      );
    }
    // Re-registering an existing name (replacing it) must not trip the cap.
    const record = await images.register(
      "buddy",
      { name: "img_0", frameWidth: 2, frameHeight: 2, frameCount: 2 },
      bytesOfLength(1),
    );
    assert.deepEqual(record.frameWidth, 2);
  });

  it("enforces the per-plugin total byte cap", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator({
      blobSize: 15 * 1024 * 1024,
    });
    const images = new PluginCustomImages({ store, validateImage });
    await images.register(
      "buddy",
      { name: "big_one", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(15 * 1024 * 1024),
    );
    await assert.rejects(
      images.register(
        "buddy",
        { name: "big_two", frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(10 * 1024 * 1024),
      ),
      /byte limit/,
    );
  });

  it("scopes quota checks per plugin", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    for (let i = 0; i < 20; i++) {
      await images.register(
        "buddy",
        { name: `img_${i}`, frameWidth: 1, frameHeight: 1, frameCount: 1 },
        bytesOfLength(1),
      );
    }
    // A different plugin's quota is untouched by buddy's 20 images.
    const record = await images.register(
      "other-plugin",
      { name: "img_0", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(1),
    );
    assert.deepEqual(record.name, "img_0");
  });
});

describe("PluginCustomImages.list/delete/loadDescriptorsForMount", () => {
  it("list returns public summaries without blobs, sorted by name", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    await images.register(
      "buddy",
      { name: "zebra", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(5),
    );
    await images.register(
      "buddy",
      { name: "apple", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(5),
    );
    const list = await images.list("buddy");
    assert.deepEqual(
      list.map((entry) => entry.name),
      ["apple", "zebra"],
    );
    assert.deepEqual(list[0].blob, undefined);
  });

  it("delete removes an image so it no longer counts against quota", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    await images.register(
      "buddy",
      { name: "temp", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(1),
    );
    await images.delete("buddy", "temp");
    assert.deepEqual(await images.list("buddy"), []);
  });

  it("loadDescriptorsForMount includes the blob for PluginAssetsLoader", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    await images.register(
      "buddy",
      { name: "dance", frameWidth: 32, frameHeight: 32, frameCount: 4 },
      bytesOfLength(5),
    );
    const descriptors = await images.loadDescriptorsForMount("buddy");
    assert.deepEqual(descriptors.length, 1);
    assert.deepEqual(descriptors[0].name, "dance");
    assert(descriptors[0].blob);
  });

  it("purgeForPlugin removes every image for that plugin only", async () => {
    const store = makeFakeStore();
    const { validateImage } = makeFakeValidator();
    const images = new PluginCustomImages({ store, validateImage });
    await images.register(
      "buddy",
      { name: "a", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(1),
    );
    await images.register(
      "other-plugin",
      { name: "b", frameWidth: 1, frameHeight: 1, frameCount: 1 },
      bytesOfLength(1),
    );
    await images.purgeForPlugin("buddy");
    assert.deepEqual(await images.list("buddy"), []);
    assert.deepEqual((await images.list("other-plugin")).length, 1);
  });
});
