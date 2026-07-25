import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginFileStaging } from "/js/plugins/pluginFileStaging.js";

function fakeFile(name = "sprite.png") {
  return { name, size: 123 };
}

describe("PluginFileStaging", () => {
  it("stages a file and redeems it once with take", () => {
    const staging = new PluginFileStaging();
    const file = fakeFile();
    const token = staging.stage("demo", file);
    assert.deepEqual(staging.take("demo", token), file);
    assert.deepEqual(staging.take("demo", token), null);
  });

  it("scopes tokens per plugin", () => {
    const staging = new PluginFileStaging();
    const file = fakeFile();
    const token = staging.stage("demo", file);
    assert.deepEqual(staging.take("other-plugin", token), null);
    assert.deepEqual(staging.take("demo", token), file);
  });

  it("returns null for an unknown token", () => {
    const staging = new PluginFileStaging();
    assert.deepEqual(staging.take("demo", "nonexistent"), null);
  });

  it("expires entries after the TTL", () => {
    let now = 0;
    const staging = new PluginFileStaging(() => now);
    const file = fakeFile();
    const token = staging.stage("demo", file);
    now = 6 * 60 * 1000; // 6 minutes later, past the 5-minute TTL
    assert.deepEqual(staging.take("demo", token), null);
  });

  it("evicts the oldest entry once a plugin exceeds its staged-file cap", () => {
    const staging = new PluginFileStaging();
    const tokens = [];
    for (let i = 0; i < 6; i++) {
      tokens.push(staging.stage("demo", fakeFile(`file-${i}.png`)));
    }
    // The first staged token should have been evicted to make room.
    assert.deepEqual(staging.take("demo", tokens[0]), null);
    // The most recent one should still be redeemable.
    assert.deepEqual(staging.take("demo", tokens[5])?.name, "file-5.png");
  });
});
