import { isAcceptableEndpointUrl } from "/js/plugins/pluginPermissions.js";
import { sandboxedFetch } from "/js/plugins/pluginRequests.js";

// Cookie is still always forbidden (it could only ever be an ambient
// browser credential, never something the plugin legitimately owns).
// Authorization is allowed here — unlike ordinary plugin fetch — because
// the header value is the plugin's own credential for a URL a human
// explicitly approved, not anything copied from the browser's ambient
// state.
const FORBIDDEN_HEADERS = ["cookie"];
const MAX_BODY_CHARS = 1_000_000;

// An origin check (protocol+hostname+port), not a prefix/pattern check like
// permissions.fetch — a compromised or malicious plugin update must not be
// able to silently retarget this call to a different host while keeping
// the same path shape. Any change of origin requires the user to approve a
// new URL via requestConfiguredEndpointUrl.
export function isOriginApproved(url, approvedUrl) {
  if (!approvedUrl) return false;
  let parsedUrl = null;
  let parsedApproved = null;
  try {
    parsedUrl = new URL(url);
    parsedApproved = new URL(approvedUrl);
  } catch {
    return false;
  }
  return (
    parsedUrl.protocol === parsedApproved.protocol &&
    parsedUrl.hostname === parsedApproved.hostname &&
    parsedUrl.port === parsedApproved.port
  );
}

export async function pluginConfiguredFetch(
  url,
  init,
  approvedUrl,
  fetchImpl = fetch.bind(globalThis),
) {
  if (!approvedUrl || !isAcceptableEndpointUrl(approvedUrl)) {
    throw new Error("no approved endpoint configured");
  }
  if (!isOriginApproved(url, approvedUrl)) {
    throw new Error(`fetch to "${url}" is not the approved endpoint`);
  }
  return sandboxedFetch(url, init, {
    forbiddenHeaders: FORBIDDEN_HEADERS,
    maxBodyChars: MAX_BODY_CHARS,
    fetchImpl,
  });
}
