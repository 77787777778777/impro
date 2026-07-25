// Device-local storage for a plugin's single approved network endpoint (see
// pluginConfiguredFetch.js). Deliberately not part of loadData/saveData,
// which round-trips through the user's AT-proto preferences record and
// syncs across every device/session on the account — wrong for a URL that
// may be device-specific (e.g. a local Ollama server) and, more
// importantly, wrong for something a compromised/malicious plugin update
// could otherwise silently rewrite. This is only ever written by the
// explicit approval flow in pluginService.js's requestConfiguredEndpointUrl
// host method.

const KEY_PREFIX = "improPluginConfiguredEndpoint:";

export function getConfiguredEndpointUrl(pluginId) {
  return localStorage.getItem(KEY_PREFIX + pluginId);
}

export function setConfiguredEndpointUrl(pluginId, url) {
  localStorage.setItem(KEY_PREFIX + pluginId, url);
}

export function clearConfiguredEndpointUrl(pluginId) {
  localStorage.removeItem(KEY_PREFIX + pluginId);
}
