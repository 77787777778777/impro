import fs from "node:fs";
import { test, expect } from "../../base.js";
import { login } from "../../helpers.js";
import { MockServer, TEST_SPRITE_PATH } from "../../mockServer.js";
import {
  TEST_PLUGIN_ID,
  CUSTOM_IMAGE_NAME,
  CUSTOM_IMAGE_PLUGIN_MANIFEST,
  CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST,
  CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST_NO_PERMISSION,
  CUSTOM_IMAGE_OVERRIDE_PLUGIN_MANIFEST,
  CUSTOM_IMAGE_OVERRIDE_PLUGIN_RAW_MANIFEST,
  OVERLAY_SPRITE_FRAME_WIDTH,
  OVERLAY_SPRITE_FRAME_HEIGHT,
  OVERLAY_SPRITE_FRAME_COUNT,
  getCustomImagePluginSource,
  getCustomImageOverridePluginSource,
} from "../../testPlugin.js";

const validPngBuffer = fs.readFileSync(TEST_SPRITE_PATH);

function seedEnabled(mockServer, manifest) {
  mockServer.installedPlugins = [{ ...manifest, enabled: true }];
}

async function gotoDetailView(page) {
  await page.goto(`/settings/plugins/${TEST_PLUGIN_ID}`);
  const view = page.locator("#settings-plugin-detail-view");
  await expect(view.locator(".test-custom-images-root")).toBeAttached({
    timeout: 10000,
  });
  return view;
}

test.describe("Custom image upload", () => {
  test("uploading a valid PNG registers it and renders a real sprite", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CUSTOM_IMAGE_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getCustomImagePluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-file-input").setInputFiles({
      name: "sprite.png",
      mimeType: "image/png",
      buffer: validPngBuffer,
    });

    const root = view.locator(".test-custom-images-root");
    await expect(root).toHaveAttribute("data-register-error", "", {
      timeout: 10000,
    });
    await expect
      .poll(async () => JSON.parse(await root.getAttribute("data-list")), {
        timeout: 10000,
      })
      .toMatchObject([{ name: CUSTOM_IMAGE_NAME }]);

    const sprite = root.locator("plugin-sprite");
    await expect(sprite).toBeAttached({ timeout: 10000 });
    const box = await sprite.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        backgroundImage: style.backgroundImage,
        width: style.width,
        height: style.height,
      };
    });
    expect(box.backgroundImage).toMatch(/^url\("blob:/);
    expect(box.width).toBe(`${OVERLAY_SPRITE_FRAME_WIDTH}px`);
    expect(box.height).toBe(`${OVERLAY_SPRITE_FRAME_HEIGHT}px`);
  });

  test("rejects a file with invalid PNG magic bytes", async ({ page }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CUSTOM_IMAGE_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getCustomImagePluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-file-input").setInputFiles({
      name: "not-a-sprite.png",
      mimeType: "image/png",
      buffer: Buffer.from("this is not a real png file"),
    });

    await expect(view.locator(".test-custom-images-root")).toHaveAttribute(
      "data-register-error",
      /invalid magic bytes/,
      { timeout: 10000 },
    );
    await expect(view.locator("plugin-sprite")).toHaveCount(0);
  });

  test("rejects a file whose real dimensions don't match the declared geometry", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CUSTOM_IMAGE_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST;
    // Declares a frameWidth narrower than the real fixture PNG (128px), so
    // frameWidth*frameCount (64*15=960) won't match the real 1920px width.
    mockServer.localPluginSource = getCustomImagePluginSource({
      frameWidth: 64,
    });
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-file-input").setInputFiles({
      name: "sprite.png",
      mimeType: "image/png",
      buffer: validPngBuffer,
    });

    await expect(view.locator(".test-custom-images-root")).toHaveAttribute(
      "data-register-error",
      new RegExp(
        `expected ${64 * OVERLAY_SPRITE_FRAME_COUNT}x${OVERLAY_SPRITE_FRAME_HEIGHT}`,
      ),
      { timeout: 10000 },
    );
    await expect(view.locator("plugin-sprite")).toHaveCount(0);
  });

  test("delete removes it from the list and un-mounts the sprite", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CUSTOM_IMAGE_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getCustomImagePluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    const root = view.locator(".test-custom-images-root");
    await view.locator(".test-file-input").setInputFiles({
      name: "sprite.png",
      mimeType: "image/png",
      buffer: validPngBuffer,
    });
    await expect(root.locator("plugin-sprite")).toBeAttached({
      timeout: 10000,
    });

    await root.locator(".test-delete-button").click();
    await expect
      .poll(async () => JSON.parse(await root.getAttribute("data-list")), {
        timeout: 10000,
      })
      .toEqual([]);
    await expect(root.locator("plugin-sprite")).toHaveCount(0);
  });

  test("persists across a page reload", async ({ page }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CUSTOM_IMAGE_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getCustomImagePluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-file-input").setInputFiles({
      name: "sprite.png",
      mimeType: "image/png",
      buffer: validPngBuffer,
    });
    await expect(
      view.locator(".test-custom-images-root plugin-sprite"),
    ).toBeAttached({ timeout: 10000 });

    await page.reload();
    const reloadedView = page.locator("#settings-plugin-detail-view");
    await expect(
      reloadedView.locator(".test-custom-images-root plugin-sprite"),
    ).toBeAttached({ timeout: 10000 });
  });
});

test.describe("Custom image upload: overriding a built-in animation", () => {
  test("overrides a bundled image by name, then restores it on delete", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CUSTOM_IMAGE_OVERRIDE_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CUSTOM_IMAGE_OVERRIDE_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getCustomImageOverridePluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    const sprite = view.locator(".test-custom-images-root plugin-sprite");
    await expect(sprite).toBeAttached({ timeout: 10000 });
    const bundledBackground = await sprite.evaluate(
      (el) => getComputedStyle(el).backgroundImage,
    );
    expect(bundledBackground).toMatch(/^url\("blob:/);

    // Upload a custom image sharing the bundled image's name — this used to
    // be rejected outright; now it should register and take over rendering.
    await view.locator(".test-file-input").setInputFiles({
      name: "sprite.png",
      mimeType: "image/png",
      buffer: validPngBuffer,
    });
    const root = view.locator(".test-custom-images-root");
    await expect(root).toHaveAttribute("data-register-error", "", {
      timeout: 10000,
    });
    await expect
      .poll(async () => JSON.parse(await root.getAttribute("data-list")), {
        timeout: 10000,
      })
      .toMatchObject([{ name: "idle_breathe" }]);

    // A distinct object URL from the bundled one proves the override
    // actually took over the mount, not just the registration bookkeeping.
    await expect
      .poll(
        async () =>
          sprite.evaluate((el) => getComputedStyle(el).backgroundImage),
        { timeout: 10000 },
      )
      .not.toBe(bundledBackground);

    await root.locator(".test-delete-button").click();
    await expect
      .poll(async () => JSON.parse(await root.getAttribute("data-list")), {
        timeout: 10000,
      })
      .toEqual([]);

    // The bundled original must be restored, not left unmounted (an
    // unmounted plugin-sprite renders an empty backgroundImage — see
    // plugin-sprite.js).
    await expect
      .poll(
        async () =>
          sprite.evaluate((el) => getComputedStyle(el).backgroundImage),
        { timeout: 10000 },
      )
      .toMatch(/^url\("blob:/);
    const restoredSize = await sprite.evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.width, height: style.height };
    });
    expect(restoredSize.width).toBe(`${OVERLAY_SPRITE_FRAME_WIDTH}px`);
    expect(restoredSize.height).toBe(`${OVERLAY_SPRITE_FRAME_HEIGHT}px`);
  });
});

test.describe("Custom image upload: permission gating", () => {
  test("without the images:upload permission, registration fails", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, {
      ...CUSTOM_IMAGE_PLUGIN_MANIFEST,
      permissions: {},
    });
    mockServer.localPluginManifest =
      CUSTOM_IMAGE_PLUGIN_RAW_MANIFEST_NO_PERMISSION;
    mockServer.localPluginSource = getCustomImagePluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-file-input").setInputFiles({
      name: "sprite.png",
      mimeType: "image/png",
      buffer: validPngBuffer,
    });

    await expect(view.locator(".test-custom-images-root")).toHaveAttribute(
      "data-register-error",
      /"upload" images permission/,
      { timeout: 10000 },
    );
    await expect(view.locator("plugin-sprite")).toHaveCount(0);
  });
});
