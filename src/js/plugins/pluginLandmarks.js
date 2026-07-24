// Read-only UI geometry for plugins: a whitelist of real chrome elements
// (see data-plugin-landmark attributes in animated-sidebar.js/
// sidebar.template.js/footer.template.js/floatingComposeButton.template.js),
// measured live rather than hardcoded, so it stays correct across viewport
// sizes, zoom, and future layout changes without any breakpoint-mirroring
// logic here.
//
// "nav-<id>" entries are generated from the sidebar/footer nav item ids
// (sidebar.template.js/footer.template.js's menuItems) — not every id
// exists in both places (e.g. "settings"/"feeds"/"bookmarks" are
// sidebar-only, and the logged-out sidebar only has "home"/"search"), so
// most of these are null on any given screen/viewport, same as any other
// landmark.
const NAV_ITEM_IDS = [
  "home",
  "search",
  "notifications",
  "chat",
  "feeds",
  "bookmarks",
  "profile",
  "settings",
];
const LANDMARK_NAMES = [
  "sidebar",
  "footer-nav",
  "compose-button",
  ...NAV_ITEM_IDS.map((id) => `nav-${id}`),
];

// Some landmarks (e.g. the mobile off-canvas sidebar drawer) are always
// `display:block`/position:fixed, just translated out of the viewport when
// "closed" — a plain zero-area check wouldn't catch that. Checking for
// actual intersection with the viewport handles both that and ordinary
// `display:none`/detached cases uniformly.
function isVisibleInViewport(rect) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width > 0 &&
    rect.x < window.innerWidth &&
    rect.y + rect.height > 0 &&
    rect.y < window.innerHeight
  );
}

export function getLandmarkRects() {
  const landmarks = {};
  for (const name of LANDMARK_NAMES) landmarks[name] = null;
  for (const el of document.querySelectorAll("[data-plugin-landmark]")) {
    const name = el.dataset.pluginLandmark;
    // Not one of the known names, or a visible match was already found for
    // it (first visible match wins over further duplicates/hidden ones).
    if (!Object.hasOwn(landmarks, name) || landmarks[name] != null) continue;
    const rect = el.getBoundingClientRect();
    if (isVisibleInViewport(rect)) {
      landmarks[name] = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    landmarks,
  };
}
