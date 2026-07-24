import { test, expect } from "../../base.js";
import { login } from "../../helpers.js";
import { MockServer } from "../../mockServer.js";
import { createPost } from "../../../shared/factories.js";
import {
  OVERLAY_PLUGIN_MANIFEST,
  OVERLAY_PLUGIN_RAW_MANIFEST,
  OVERLAY_PLUGIN_RAW_MANIFEST_NO_PERMISSION,
  OVERLAY_SPRITE_FRAME_WIDTH,
  OVERLAY_SPRITE_FRAME_HEIGHT,
  OVERLAY_SPRITE_FRAME_COUNT,
  getOverlaySpritePluginSource,
  getOverlayReactivePluginSource,
  getOverlayLandmarksPluginSource,
  getOverlayMovementPluginSource,
  getOverlayReducedMotionPluginSource,
  getOverlayPositionPluginSource,
} from "../../testPlugin.js";

async function enablePlugin(page) {
  await page.goto("/settings/plugins");
  const item = page.locator(".plugin-list-item", {
    hasText: "Overlay Test Plugin",
  });
  await expect(item).toBeVisible({ timeout: 10000 });
  await item.locator(".plugin-toggle").click();
}

test.describe("Persistent overlay slot", () => {
  test("renders a plugin-declared sprite and persists across navigation", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getOverlaySpritePluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    const sprite = page.locator(".plugin-overlay-container plugin-sprite");
    await expect(sprite).toBeAttached({ timeout: 10000 });

    const box = await sprite.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        backgroundImage: style.backgroundImage,
        backgroundSize: style.backgroundSize,
        width: style.width,
        height: style.height,
      };
    });
    expect(box.backgroundImage).toMatch(/^url\("blob:/);
    expect(box.backgroundSize).toBe(
      `${OVERLAY_SPRITE_FRAME_WIDTH * OVERLAY_SPRITE_FRAME_COUNT}px ${OVERLAY_SPRITE_FRAME_HEIGHT}px`,
    );
    expect(box.width).toBe(`${OVERLAY_SPRITE_FRAME_WIDTH}px`);
    expect(box.height).toBe(`${OVERLAY_SPRITE_FRAME_HEIGHT}px`);

    // Navigate elsewhere in the app — the overlay is mounted in the app
    // shell (mainLayout.js), not a specific view, so it should stay put.
    await page.goto("/settings");
    await expect(
      page.locator(".plugin-overlay-container plugin-sprite"),
    ).toBeAttached({ timeout: 10000 });
  });

  test("does not register the overlay slot without the ui:overlay permission", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST_NO_PERMISSION;
    mockServer.localPluginSource = getOverlaySpritePluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    // registerSlot("overlay", ...) is refused (missing permission) but
    // onload() otherwise completes fine — wait for the settings link (which
    // addSettingTab always registers in this fixture) as confirmation
    // loading finished, then assert the overlay never appeared.
    const item = page.locator(".plugin-list-item", {
      hasText: "Overlay Test Plugin",
    });
    await expect(item.locator(".plugin-settings-link")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(".plugin-overlay-container plugin-sprite"),
    ).toHaveCount(0);
  });
});

test.describe("Broadcast app-action events", () => {
  test("liking a post fires post-liked and the overlay re-renders via refreshSlot", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    const post = createPost({
      uri: "at://did:plc:author1/app.bsky.feed.post/post1",
      text: "Post worth liking",
      authorHandle: "author1.bsky.social",
      authorDisplayName: "Author One",
    });
    mockServer.addTimelinePosts([post]);
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getOverlayReactivePluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    // Confirm the pre-reaction idle state before touching anything, so the
    // later assertion is a genuine before/after rather than coincidental.
    await expect(
      page.locator(".plugin-overlay-container .test-overlay-idle"),
    ).toBeAttached({ timeout: 10000 });

    await page.goto("/");
    const homeView = page.locator("#home-view");
    const feedItem = homeView.locator('[data-testid="feed-item"]');
    await expect(feedItem).toHaveCount(1, { timeout: 10000 });
    await feedItem.locator('[data-testid="like-button"]').click();
    await expect(
      feedItem.locator('[data-testid="like-button"].active'),
    ).toBeVisible({ timeout: 10000 });

    const reacted = page.locator(
      ".plugin-overlay-container .test-overlay-reacted",
    );
    await expect(reacted).toBeAttached({ timeout: 10000 });
    await expect(reacted).toHaveAttribute("data-liked-uri", post.uri);
  });
});

test.describe("UI geometry", () => {
  test("getLandmarkRects reports real, measured chrome positions", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getOverlayLandmarksPluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    const root = page.locator(".plugin-overlay-container .test-landmarks-root");
    await expect(root).toBeAttached({ timeout: 10000 });

    const viewport = JSON.parse(await root.getAttribute("data-viewport"));
    const realViewportWidth = await page.evaluate(() => window.innerWidth);
    expect(viewport.width).toBe(realViewportWidth);

    // The sidebar landmark should be a real measured rect (this app's
    // default e2e viewport is desktop-width, so the sticky rail is
    // present), not a hardcoded/guessed value.
    const sidebarRect = JSON.parse(
      await root.getAttribute("data-landmark-sidebar"),
    );
    const realSidebarBox = await page
      .locator("animated-sidebar dialog.sidebar")
      .first()
      .boundingBox();
    expect(sidebarRect).not.toBeNull();
    expect(Math.round(sidebarRect.width)).toBe(
      Math.round(realSidebarBox.width),
    );

    // No compose button/footer-nav-based notifications icon exist as a
    // floating-compose-button/footer nav at this (desktop) viewport size —
    // confirms absent landmarks report null rather than being omitted or
    // stale, per plugins.md's documented shape.
    const footerNavRect = JSON.parse(
      await root.getAttribute("data-landmark-footer-nav"),
    );
    expect(footerNavRect).toBeNull();
  });
});

test.describe("Buddy-style movement continuity", () => {
  test("a position change with a transition animates smoothly, but a teleport-flagged change is instant", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    const post = createPost({
      uri: "at://did:plc:author1/app.bsky.feed.post/post1",
      text: "Post to interact with",
      authorHandle: "author1.bsky.social",
      authorDisplayName: "Author One",
    });
    mockServer.addTimelinePosts([post]);
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getOverlayMovementPluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    const moveRoot = page.locator(
      ".plugin-overlay-container .test-movement-root",
    );
    await expect(moveRoot).toBeAttached({ timeout: 10000 });

    await page.goto("/");
    const homeView = page.locator("#home-view");
    const feedItem = homeView.locator('[data-testid="feed-item"]');
    await expect(feedItem).toHaveCount(1, { timeout: 10000 });

    // A transitioned move (mirrors buddy's normal walk): a real CSS
    // transition should actually be running shortly after the change —
    // which only happens if the underlying DOM node persisted across the
    // refreshSlot-triggered re-render (a fresh element has no "previous
    // value" for a transition to interpolate from, so this also indirectly
    // proves the plugin-slot.js replaceChildren fix is in effect). Polled
    // rather than checked once immediately, since the plugin's refreshSlot
    // round-trip (worker -> host -> DOM patch) is async.
    await feedItem.locator('[data-testid="like-button"]').click();
    await expect(
      feedItem.locator('[data-testid="like-button"].active'),
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(() => moveRoot.evaluate((el) => el.getAnimations().length > 0), {
        timeout: 10000,
      })
      .toBe(true);

    // A teleport-flagged move (transition: none): the new position should
    // apply instantly with no animation ever running for it. Poll for the
    // new value to arrive (async round-trip again), then confirm — at that
    // exact moment — nothing is animating; a transition:none change never
    // creates an Animation object in the first place, so this isn't a race
    // once the value itself has been confirmed.
    await feedItem.locator('[data-testid="repost-button"]').click();
    await page.locator('[data-testid="menu-action-repost"]').click();
    await expect(
      feedItem.locator('[data-testid="repost-button"].reposted'),
    ).toBeVisible({ timeout: 10000 });
    await expect
      .poll(() => moveRoot.evaluate((el) => getComputedStyle(el).transform), {
        timeout: 10000,
      })
      // translateX(610px) as a 2D matrix: matrix(1, 0, 0, 1, 610, 0)
      .toContain("610");
    const animatingAfterTeleport = await moveRoot.evaluate(
      (el) => el.getAnimations().length > 0,
    );
    expect(animatingAfterTeleport).toBe(false);
  });
});

test.describe("prefersReducedMotion", () => {
  test("a rescheduled tick loop keeps running across many calls", async ({
    page,
  }) => {
    // Regression test: a plugin (buddy) once called window.matchMedia
    // directly from its own code, which throws "window is not defined" —
    // plugin code always runs in a real Worker, which has no window of its
    // own. With no error handling around the reschedule, that single throw
    // permanently froze the tick loop after its first iteration. This
    // drives many real tick iterations through the actual API
    // (this.app.data.prefersReducedMotion()) and confirms the tick count
    // keeps climbing rather than getting stuck at 1.
    const mockServer = new MockServer();
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getOverlayReducedMotionPluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    const root = page.locator(
      ".plugin-overlay-container .test-reduced-motion-root",
    );
    await expect(root).toBeAttached({ timeout: 10000 });
    await expect(root).toHaveAttribute("data-reduced-motion", "false", {
      timeout: 10000,
    });

    await expect
      .poll(async () => Number(await root.getAttribute("data-tick-count")), {
        timeout: 10000,
      })
      .toBeGreaterThan(5);
  });
});

test.describe("User-action position", () => {
  test("post-liked carries the real, measured position of the clicked like button", async ({
    page,
  }) => {
    const mockServer = new MockServer();
    const post = createPost({
      uri: "at://did:plc:author1/app.bsky.feed.post/post1",
      text: "Post worth liking",
      authorHandle: "author1.bsky.social",
      authorDisplayName: "Author One",
    });
    mockServer.addTimelinePosts([post]);
    mockServer.installedPlugins = [
      { ...OVERLAY_PLUGIN_MANIFEST, enabled: false },
    ];
    mockServer.localPluginManifest = OVERLAY_PLUGIN_RAW_MANIFEST;
    mockServer.localPluginSource = getOverlayPositionPluginSource();
    await mockServer.setup(page);

    await login(page);
    await enablePlugin(page);

    const root = page.locator(".plugin-overlay-container .test-position-root");
    await expect(root).toBeAttached({ timeout: 10000 });
    await expect(root).toHaveAttribute("data-position", "null");

    await page.goto("/");
    const homeView = page.locator("#home-view");
    const feedItem = homeView.locator('[data-testid="feed-item"]');
    await expect(feedItem).toHaveCount(1, { timeout: 10000 });
    const likeButton = feedItem.locator('[data-testid="like-button"]');
    const likeBox = await likeButton.boundingBox();

    await likeButton.click();
    await expect(
      feedItem.locator('[data-testid="like-button"].active'),
    ).toBeVisible({
      timeout: 10000,
    });

    await expect
      .poll(() => root.getAttribute("data-position"), { timeout: 10000 })
      .not.toBe("null");
    const position = JSON.parse(await root.getAttribute("data-position"));
    // The like button is rendered via animated-button.js, which is styled
    // `display: contents` — a wrapper with no box of its own. Comparing
    // against the real button's bounding box (not just "some non-null
    // value") is what would have caught the bug where the reported
    // position landed at (0, 0) for every display:contents-wrapped button.
    expect(Math.abs(position.x - (likeBox.x + likeBox.width / 2))).toBeLessThan(
      2,
    );
    expect(
      Math.abs(position.y - (likeBox.y + likeBox.height / 2)),
    ).toBeLessThan(2);
  });
});
