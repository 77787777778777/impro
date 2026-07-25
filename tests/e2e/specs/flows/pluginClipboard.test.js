import { test, expect } from "../../base.js";
import { login } from "../../helpers.js";
import { MockServer } from "../../mockServer.js";
import {
  TEST_PLUGIN_ID,
  CLIPBOARD_PLUGIN_MANIFEST,
  CLIPBOARD_PLUGIN_RAW_MANIFEST,
  CLIPBOARD_PLUGIN_RAW_MANIFEST_NO_PERMISSION,
  getClipboardPluginSource,
} from "../../testPlugin.js";

const CLIPBOARD_TEST_TEXT = "drafted reply text from the test plugin";

function seedEnabled(mockServer, manifest) {
  mockServer.installedPlugins = [{ ...manifest, enabled: true }];
}

async function gotoDetailView(page) {
  await page.goto(`/settings/plugins/${TEST_PLUGIN_ID}`);
  const view = page.locator("#settings-plugin-detail-view");
  await expect(view.locator(".test-clipboard-root")).toBeAttached({
    timeout: 10000,
  });
  return view;
}

test.describe("Clipboard write", () => {
  test("writes the exact text to the real system clipboard", async ({
    page,
    browserName,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CLIPBOARD_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CLIPBOARD_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getClipboardPluginSource();
    await mockServer.setup(page);

    if (browserName === "chromium") {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
    }

    await login(page);
    const view = await gotoDetailView(page);
    await view.locator(".test-copy-button").click();

    await expect(view.locator(".test-clipboard-root")).toHaveAttribute(
      "data-copy-done",
      "true",
      { timeout: 10000 },
    );

    if (browserName === "chromium") {
      const clipboardText = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(clipboardText).toBe(CLIPBOARD_TEST_TEXT);
    }
  });
});

test.describe("Clipboard write: permission gating", () => {
  test("without the clipboard:write permission, the write is rejected", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, { ...CLIPBOARD_PLUGIN_MANIFEST, permissions: {} });
    mockServer.localPluginManifest =
      CLIPBOARD_PLUGIN_RAW_MANIFEST_NO_PERMISSION;
    mockServer.localPluginSource = getClipboardPluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-copy-button").click();

    await expect(view.locator(".test-clipboard-root")).toHaveAttribute(
      "data-copy-error",
      /"write" clipboard permission/,
      { timeout: 10000 },
    );
  });
});
