import { unique } from "/js/utils.js";

const ACTION_SCOPES = [
  "mute",
  "block",
  "feedFeedback",
  "like",
  "repost",
  "follow",
  "bookmark",
];
const UI_SCOPES = ["overlay"];
const NETWORK_SCOPES = ["configuredEndpoint"];
const IMAGE_SCOPES = ["upload"];
const CLIPBOARD_SCOPES = ["write"];

export function getPermissionsFromManifest(manifest) {
  return parsePermissions(manifest.permissions ?? {});
}

export function parsePermissions(permissions) {
  const parsed = {};
  if (permissions.fetch) {
    const fetchArray = Array.isArray(permissions.fetch)
      ? permissions.fetch
      : [permissions.fetch];
    const fetchPatterns = unique(
      fetchArray.filter((entry) => typeof entry === "string"),
    );
    if (fetchPatterns.length > 0) parsed.fetch = fetchPatterns;
  }
  if (permissions.actions) {
    const actionsArray = Array.isArray(permissions.actions)
      ? permissions.actions
      : [permissions.actions];
    const actionScopes = unique(
      actionsArray.filter((entry) => ACTION_SCOPES.includes(entry)),
    );
    if (actionScopes.length > 0) parsed.actions = actionScopes;
  }
  if (permissions.ui) {
    const uiArray = Array.isArray(permissions.ui)
      ? permissions.ui
      : [permissions.ui];
    const uiScopes = unique(
      uiArray.filter((entry) => UI_SCOPES.includes(entry)),
    );
    if (uiScopes.length > 0) parsed.ui = uiScopes;
  }
  if (permissions.network) {
    const networkArray = Array.isArray(permissions.network)
      ? permissions.network
      : [permissions.network];
    const networkScopes = unique(
      networkArray.filter((entry) => NETWORK_SCOPES.includes(entry)),
    );
    if (networkScopes.length > 0) parsed.network = networkScopes;
  }
  if (permissions.images) {
    const imagesArray = Array.isArray(permissions.images)
      ? permissions.images
      : [permissions.images];
    const imageScopes = unique(
      imagesArray.filter((entry) => IMAGE_SCOPES.includes(entry)),
    );
    if (imageScopes.length > 0) parsed.images = imageScopes;
  }
  if (permissions.clipboard) {
    const clipboardArray = Array.isArray(permissions.clipboard)
      ? permissions.clipboard
      : [permissions.clipboard];
    const clipboardScopes = unique(
      clipboardArray.filter((entry) => CLIPBOARD_SCOPES.includes(entry)),
    );
    if (clipboardScopes.length > 0) parsed.clipboard = clipboardScopes;
  }
  return parsed;
}

// action is one of "mute", "block", "feedFeedback" (the "show fewer/more
// like this" feed-interaction signal), "like", "repost", "follow", or
// "bookmark"
export function isActionAllowed(action, permissions) {
  return (permissions.actions ?? []).includes(action);
}

// scope is one of UI_SCOPES (currently just "overlay" — a persistent,
// route-independent widget mounted in the app shell, see OVERLAY_SLOT_NAME)
export function isUiAllowed(scope, permissions) {
  return (permissions.ui ?? []).includes(scope);
}

// scope is one of NETWORK_SCOPES (currently just "configuredEndpoint" — lets
// a plugin send requests to the single URL a human has personally entered
// into that plugin's own settings, see pluginConfiguredFetch.js. This is
// deliberately *not* a manifest-declared allowlist like permissions.fetch;
// the manifest only grants the *capability*, not any particular host).
export function isNetworkAllowed(scope, permissions) {
  return (permissions.network ?? []).includes(scope);
}

// Currently just "upload" — lets a plugin store user-uploaded spritesheet
// images locally (see pluginCustomImages.js) instead of only shipping
// images bundled into the plugin's own repo.
export function isImageUploadAllowed(permissions) {
  return (permissions.images ?? []).includes("upload");
}

// Currently just "write" — lets a plugin write text to the system
// clipboard (see pluginService.js's copyToClipboard host method). There is
// no read counterpart: a plugin can hand the user text to paste somewhere,
// never read what's already on their clipboard.
export function isClipboardWriteAllowed(permissions) {
  return (permissions.clipboard ?? []).includes("write");
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Is this URL even eligible to be approved as a plugin's configured
// endpoint? https is always fine; plain http is only fine for loopback
// addresses, since that's how local model servers (e.g. Ollama) default to
// running and there's no network-level MITM risk to a request that never
// leaves the machine.
export function isAcceptableEndpointUrl(url) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }
  if (parsedUrl.protocol === "https:") return true;
  if (parsedUrl.protocol === "http:") {
    return LOOPBACK_HOSTNAMES.has(parsedUrl.hostname.toLowerCase());
  }
  return false;
}

export function diffPermissions(current, next) {
  const diff = {};
  let hasAny = false;
  for (const key of Object.keys(next)) {
    const have = new Set(current[key] ?? []);
    const added = (next[key] ?? []).filter((entry) => !have.has(entry));
    if (added.length > 0) {
      diff[key] = added;
      hasAny = true;
    }
  }
  return hasAny ? diff : null;
}

export function isEmptyPermissions(obj) {
  return Object.values(obj).every(
    (entries) => !Array.isArray(entries) || entries.length === 0,
  );
}

export function isFetchAllowed(url, permissions) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== "https:") return false;
  return (permissions.fetch ?? []).some((pattern) =>
    matchesPattern(parsedUrl, pattern),
  );
}

// Permission pattern matching:
//   https://example.com/path        — exact host, exact path
//   https://example.com/path/*      — exact host, path prefix
//   https://*.example.com/*         — example.com and any subdomain
//   https://example.com/*           — exact host, any path

function matchesPattern(parsedUrl, pattern) {
  let parsedPattern = null;
  try {
    parsedPattern = parsePattern(pattern);
  } catch (e) {
    console.error(e);
    console.warn(`invalid permission: ${pattern}`);
    return false;
  }
  const { host, path } = parsedPattern;
  if (!hostMatches(parsedUrl.hostname, host)) return false;
  if (!pathMatches(parsedUrl.pathname, path)) return false;
  return true;
}

function parsePattern(pattern) {
  if (typeof pattern !== "string") throw new Error("must be a string");
  const schemeSep = pattern.indexOf("://");
  if (schemeSep === -1) throw new Error("no protocol found");
  const scheme = pattern.slice(0, schemeSep);
  if (scheme !== "https") throw new Error("https required");
  const rest = pattern.slice(schemeSep + 3);
  const pathStart = rest.indexOf("/");
  const host = (
    pathStart === -1 ? rest : rest.slice(0, pathStart)
  ).toLowerCase();
  const path = pathStart === -1 ? "/*" : rest.slice(pathStart);
  if (!host) throw new Error("no host found");
  return { host, path };
}

function hostMatches(actualHost, patternHost) {
  const actual = actualHost.toLowerCase();
  if (patternHost.startsWith("*.")) {
    const suffix = patternHost.slice(2);
    if (!suffix || suffix.includes("*")) return false;
    if (actual === suffix) return true;
    return actual.endsWith("." + suffix);
  }
  if (patternHost.includes("*")) return false;
  return actual === patternHost;
}

function pathMatches(actualPath, patternPath) {
  if (patternPath.endsWith("*")) {
    const prefix = patternPath.slice(0, -1);
    return actualPath.startsWith(prefix);
  }
  return actualPath === patternPath;
}
