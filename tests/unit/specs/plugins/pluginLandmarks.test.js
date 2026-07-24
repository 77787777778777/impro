import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getLandmarkRects } from "/js/plugins/pluginLandmarks.js";

function addLandmark(name, rect) {
  const el = document.createElement("div");
  el.dataset.pluginLandmark = name;
  el.getBoundingClientRect = () => rect;
  document.body.appendChild(el);
  return el;
}

describe("getLandmarkRects", () => {
  let originalInnerWidth;
  let originalInnerHeight;

  beforeEach(() => {
    document.body.innerHTML = "";
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: originalInnerWidth,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  it("reports all known landmarks as null when nothing is tagged", () => {
    const result = getLandmarkRects();
    assert.deepEqual(result, {
      viewport: { width: 1024, height: 768 },
      landmarks: {
        sidebar: null,
        "footer-nav": null,
        "compose-button": null,
        "nav-home": null,
        "nav-search": null,
        "nav-notifications": null,
        "nav-chat": null,
        "nav-feeds": null,
        "nav-bookmarks": null,
        "nav-profile": null,
        "nav-settings": null,
      },
    });
  });

  it("reports a real rect for a visible landmark", () => {
    addLandmark("compose-button", { x: 20, y: 700, width: 60, height: 60 });
    const result = getLandmarkRects();
    assert.deepEqual(result.landmarks["compose-button"], {
      x: 20,
      y: 700,
      width: 60,
      height: 60,
    });
  });

  it("reports null for a zero-area (display:none) element", () => {
    addLandmark("footer-nav", { x: 0, y: 768, width: 0, height: 0 });
    const result = getLandmarkRects();
    assert.equal(result.landmarks["footer-nav"], null);
  });

  it("reports null for an element positioned entirely off-viewport", () => {
    // e.g. the mobile off-canvas sidebar drawer, translated out of view
    // while still display:block with a real width/height.
    addLandmark("sidebar", { x: -300, y: 0, width: 300, height: 768 });
    const result = getLandmarkRects();
    assert.equal(result.landmarks.sidebar, null);
  });

  it("reports a rect for a landmark straddling the viewport edge", () => {
    addLandmark("sidebar", { x: -100, y: 0, width: 300, height: 768 });
    const result = getLandmarkRects();
    assert.deepEqual(result.landmarks.sidebar, {
      x: -100,
      y: 0,
      width: 300,
      height: 768,
    });
  });

  it("ignores unknown landmark names", () => {
    addLandmark("something-unrelated", { x: 0, y: 0, width: 10, height: 10 });
    const result = getLandmarkRects();
    assert.equal(Object.hasOwn(result.landmarks, "something-unrelated"), false);
  });

  it("picks the first visible match when a name has multiple elements", () => {
    addLandmark("compose-button", { x: 0, y: 0, width: 0, height: 0 }); // hidden
    addLandmark("compose-button", { x: 5, y: 5, width: 60, height: 60 }); // visible
    const result = getLandmarkRects();
    assert.deepEqual(result.landmarks["compose-button"], {
      x: 5,
      y: 5,
      width: 60,
      height: 60,
    });
  });
});
