import { test, expect } from "../../base.js";
import { login } from "../../helpers.js";
import { MockServer } from "../../mockServer.js";
import {
  TEST_PLUGIN_ID,
  CONFIGURED_FETCH_PLUGIN_MANIFEST,
  CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST,
  CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST_NO_PERMISSION,
  CONFIGURED_FETCH_TEST_URL,
  getConfiguredFetchPluginSource,
} from "../../testPlugin.js";

function seedEnabled(mockServer, manifest) {
  mockServer.installedPlugins = [{ ...manifest, enabled: true }];
}

async function gotoDetailView(page) {
  await page.goto(`/settings/plugins/${TEST_PLUGIN_ID}`);
  const view = page.locator("#settings-plugin-detail-view");
  await expect(view.locator(".test-configured-fetch-root")).toBeAttached({
    timeout: 10000,
  });
  return view;
}

test.describe("Configured-endpoint fetch: approval modal", () => {
  test("shows the exact URL and only persists the endpoint on Allow", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CONFIGURED_FETCH_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getConfiguredFetchPluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-request-url-button").click();

    const dialog = page.locator("dialog.confirm-modal");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.locator(".modal-dialog-message")).toContainText(
      CONFIGURED_FETCH_TEST_URL,
    );

    // Declining leaves nothing approved.
    await dialog.locator(".cancel-button").click();
    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-request-result",
      JSON.stringify({ accepted: false, url: null }),
    );

    // Approving persists it.
    await view.locator(".test-request-url-button").click();
    await expect(page.locator("dialog.confirm-modal")).toBeVisible({
      timeout: 10000,
    });
    await page.locator("dialog.confirm-modal .confirm-button").click();
    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-request-result",
      JSON.stringify({ accepted: true, url: CONFIGURED_FETCH_TEST_URL }),
    );
  });

  test("rejects a non-loopback http address before ever showing a modal", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CONFIGURED_FETCH_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getConfiguredFetchPluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-request-bad-url-button").click();

    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-request-error",
      /not an allowed endpoint address/,
      { timeout: 10000 },
    );
    await expect(page.locator("dialog.confirm-modal")).toHaveCount(0);
  });
});

test.describe("Configured-endpoint fetch: permission gating", () => {
  test("without the configuredEndpoint permission, requestUrl fails and no modal appears", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, {
      ...CONFIGURED_FETCH_PLUGIN_MANIFEST,
      permissions: {},
    });
    mockServer.localPluginManifest =
      CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST_NO_PERMISSION;
    mockServer.localPluginSource = getConfiguredFetchPluginSource();
    await mockServer.setup(page);
    await login(page);

    const view = await gotoDetailView(page);
    await view.locator(".test-request-url-button").click();

    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-request-error",
      /"configuredEndpoint" network permission/,
      { timeout: 10000 },
    );
    await expect(page.locator("dialog.confirm-modal")).toHaveCount(0);
  });
});

test.describe("Configured-endpoint fetch: outbound requests", () => {
  test("reaches the approved origin with the Authorization header, and rejects other origins", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    seedEnabled(mockServer, CONFIGURED_FETCH_PLUGIN_MANIFEST);
    mockServer.localPluginManifest = CONFIGURED_FETCH_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getConfiguredFetchPluginSource();
    await mockServer.setup(page);
    await login(page);

    const capturedRequests = [];
    await page.route(CONFIGURED_FETCH_TEST_URL, (route) => {
      capturedRequests.push({
        method: route.request().method(),
        headers: route.request().headers(),
        postData: route.request().postData(),
      });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    const view = await gotoDetailView(page);
    await view.locator(".test-request-url-button").click();
    await expect(page.locator("dialog.confirm-modal")).toBeVisible({
      timeout: 10000,
    });
    await page.locator("dialog.confirm-modal .confirm-button").click();
    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-request-result",
      JSON.stringify({ accepted: true, url: CONFIGURED_FETCH_TEST_URL }),
    );

    await view.locator(".test-fetch-approved-button").click();
    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-fetch-result",
      JSON.stringify({ status: 200, body: JSON.stringify({ ok: true }) }),
      { timeout: 10000 },
    );
    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0].method).toBe("POST");
    expect(capturedRequests[0].headers.authorization).toBe("Bearer sk-test");
    expect(capturedRequests[0].postData).toBe(JSON.stringify({ ping: true }));

    // A different origin than the one approved is rejected client-side —
    // no network request is ever attempted for it.
    await view.locator(".test-fetch-other-button").click();
    await expect(view.locator(".test-configured-fetch-root")).toHaveAttribute(
      "data-fetch-error",
      /not the approved endpoint/,
      { timeout: 10000 },
    );
  });
});
