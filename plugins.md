# Impro Plugins

Impro includes an Obsidian-style plugin system to enable extra functionality. You can find an example plugin here: https://github.com/improsocial/impro-sample-plugin.

## Local development

To develop a plugin locally:

1. Clone and run Impro locally
2. Fork the sample plugin (linked above) and clone it locally
3. Symlink your plugin directory into the local plugins directory:

```
ln -s /path/to/my_plugin_dir /path/to/impro/plugins-local/my_plugin_dir
```

Your plugin should now appear in the "Community Plugins" page: `http://localhost:8080/settings/plugins/community`

4. Watch for changes with `npm start`

## Publishing a plugin

To publish a plugin version, tag a commit with the version number (e.g. "0.1.0", no v) and push it to a public GitHub or Tangled repository. To include your plugin in the Community Plugins listing, make a pull request to https://github.com/improsocial/impro-releases with the plugin info.

## API surface

Plugins are currently in **beta** as the API surface is being expanded. However, here are some basic guidelines about what plugins can do:

### Plugins CAN:

- Inject custom CSS
- Add context menu and sidebar items
- Open modals and toasts with custom content
- Add a settings panel to manage their settings
- Store settings on a user account
- Override component rendering with custom HTML (e.g. posts, profiles, buttons etc) [in-progress]
- Add a full page with custom HTML content [in-progress]
- Ship bundled bitmap images (e.g. spritesheets) via `manifest.json`'s `images`
  array, and render a frame of one with `createSprite()` — see "Images" below
- Show a persistent widget on top of every screen, regardless of route, via
  the `"overlay"` slot (requires the `ui: ["overlay"]` permission) — see
  "Persistent overlay" below
- React to actions the user takes (liking/reposting a post, following a
  profile, publishing a post) via `this.app.on(event, listener)`, and to
  what's currently on screen via the overlay slot's `context.page`/
  `context.notifications` — see "Reacting to app activity" below
- Add custom feed filters
- Transform rich text in posts
- Make whitelisted network requests (requires permissions)
- Send requests to a single network address a user has personally typed into
  the plugin's own settings and approved (requires permissions) — see
  "Network requests to a configured endpoint" below
- Let a user upload their own spritesheet images at runtime, rendered the
  same way as bundled ones — optionally replacing one of your bundled
  animations by name (requires permissions) — see "Custom uploaded images"
  below
- Read appview data with the current user as the viewer (profiles, posts, etc.)
- Mute, block, send feed feedback ("show more/less like this"), like,
  repost, follow, or bookmark on the user's behalf (requires permissions,
  and never publishing a post/reply on their behalf) — see "Acting on the
  user's behalf" below
- Copy generated text (e.g. a drafted reply) to the user's clipboard
  (requires permissions) — see "Clipboard" below

### Plugins CANNOT:

- Make arbitrary network requests — either the destination has to be
  declared and consented to up front (`permissions.fetch`), or it has to be
  a single address the user personally typed in and approved themselves
  (`permissions.network`, see below); a plugin can never reach an address
  nobody but its own author chose
- Read or modify page HTML directly
- Publish a post or reply on the user's behalf, or read what's currently on
  their clipboard — drafting text for the user to review and send/copy
  themselves is the supported path (see "Acting on the user's behalf" and
  "Clipboard" below)

If there's a use case you'd like Impro to support that it doesn't currently, please open an issue in this repository to discuss!

### Images

Plugins can't reference arbitrary image URLs (no `<img>` tag, and `url()` is
rejected everywhere in plugin CSS). Instead, declare bundled PNG spritesheets
statically in `manifest.json`, the same way `fonts` works:

```json
"images": [
  {
    "name": "idle_breathe",
    "file": "assets/001_idle_breathe.png",
    "frameWidth": 128,
    "frameHeight": 128,
    "frameCount": 15
  }
]
```

The file must be a single horizontal strip of `frameCount` frames, each
`frameWidth`x`frameHeight`, so the PNG's total size is exactly
`frameWidth * frameCount` by `frameHeight` (validated at load time) — and no
larger than 2MB. Render a frame with:

```js
containerEl.createSprite((sprite) => sprite.setImage("idle_breathe"));
```

Animating between frames is done entirely with your own CSS
`@keyframes`/`steps()` targeting `background-position-x` (both are allowed —
only `url()`-family functions are rejected). Consider wrapping the animation in
`@media (prefers-reduced-motion: reduce)`, since the host has no way to
enforce this on your behalf.

### Persistent overlay

Most plugin UI (sidebar items, modals, toasts, `registerSlot` inside a
specific view) only appears in response to user action or on one page. To
show something on every screen regardless of navigation — e.g. a screen
companion — register the reserved `"overlay"` slot name instead:

```js
this.registerSlot("overlay", () => {
  const el = new VirtualEl("div");
  el.addClass("my-overlay-root");
  el.createSprite((sprite) => sprite.setImage("idle_breathe"));
  return el;
});
```

This requires declaring `"permissions": { "ui": ["overlay"] }` in
`manifest.json`, shown to the user as a consent prompt at install/update time
— a permanent full-viewport overlay is a more invasive capability than
anything else available to plugins today. Without the permission, registration
silently no-ops (a console warning, no thrown error).

The overlay container itself is `pointer-events: none` so a purely decorative
widget doesn't block clicks elsewhere in the app; opt individual interactive
elements back in with your own CSS (`pointer-events: auto`). If multiple
plugins register the overlay slot, they're simply stacked as siblings in
registration order — pick an unobtrusive corner and keep your footprint small.

### Reacting to app activity

**Actions the user takes** are delivered as one-way events via
`this.app.on(event, listener)` — the listener receives a plain payload object
and its return value is ignored (unlike `post-context-menu`/
`profile-context-menu`/`post-composer-open`, which expect a menu/composer
back). Available events:

| Event                | Payload                      |
| -------------------- | ---------------------------- |
| `post-liked`         | `{ uri, position }`          |
| `post-unliked`       | `{ uri, position }`          |
| `post-reposted`      | `{ uri, position }`          |
| `post-unreposted`    | `{ uri, position }`          |
| `profile-followed`   | `{ did, position }`          |
| `profile-unfollowed` | `{ did, position }`          |
| `post-created`       | `{ uri, isReply, position }` |
| `feed-refreshed`     | `{ feedUri, newPostCount }`  |

`position` is `{ x, y }` (viewport-relative, like `getLandmarkRects()`) when
the action was taken by clicking/tapping/activating a specific control the
host could measure at that moment — e.g. the actual like button that was
pressed — and `undefined` otherwise (e.g. no reliable originating element,
or the action came from somewhere not yet wired up to report one). Treat it
as an occasional bonus, not something every event reliably has. `feed-refreshed`
has no `position` at all — it isn't tied to any one clicked element; it
fires whenever the user reloads a feed (e.g. tapping the active nav item
again), with `newPostCount` counting how many of the reloaded posts weren't
present before:

```js
this.app.on("post-liked", ({ uri, position }) => {
  // e.g. move your overlay widget to `position` and react there, falling
  // back to something generic when it's undefined
});
```

**What's on screen** is available to the overlay slot's callback as its
`context` argument, refreshed automatically whenever it changes:
`context.page` (a coarse category — `"home"`, `"notifications"`, `"chat"`,
`"thread"`, `"profile"`, `"settings"`, `"discover"`, or `"other"`),
`context.notifications` (the current unread-notifications count, as a
string — parse with `Number()`), and `context.profileActor` (only set when
`context.page === "profile"` — the handle or DID of whichever profile is
being viewed, straight from the URL, suitable for passing directly to
`app.data.getProfile`/`getDetailedProfile`, which already accept either;
empty string on every other page).

**Re-rendering on your own schedule**: `registerSlot`'s callback is normally
only re-invoked when the slot's registration set changes, or (for the
overlay slot) when `context.page`/`context.notifications` change. To update
what's showing at any other time — e.g. an ambient idle animation, or a
timed reaction to one of the events above — call `this.refreshSlot(name)`,
which forces every plugin currently registered for that slot to re-invoke
its callback:

```js
this._mood = "happy";
this.refreshSlot("overlay");
```

### UI geometry

Plugins can't read the page's real DOM, but a widget that moves around the
screen (e.g. in the overlay slot) often needs to know where the app's own
chrome actually is, so it can avoid overlapping it or move toward something
meaningful. `this.app.data.getLandmarkRects()` returns a one-time snapshot
of real, measured positions for a small whitelist of elements — never
structure or content, just numbers:

```js
const { viewport, landmarks } = await this.app.data.getLandmarkRects();
// viewport: { width, height }
// Each of the following is { x, y, width, height } | null:
// landmarks.sidebar
// landmarks["footer-nav"]
// landmarks["compose-button"]
// landmarks["nav-home"] / landmarks["nav-search"] / landmarks["nav-notifications"] /
//   landmarks["nav-chat"] / landmarks["nav-feeds"] / landmarks["nav-bookmarks"] /
//   landmarks["nav-profile"] / landmarks["nav-settings"]
```

The `nav-*` entries are the individual sidebar/footer navigation items (home,
search, notifications, chat, feeds, bookmarks, profile, settings) — not every
one exists on every screen (e.g. "feeds"/"bookmarks"/"settings" only appear
in the desktop sidebar, not the mobile footer nav, and a logged-out sidebar
only has "home"/"search"), so most of these are `null` on any given
viewport, same as any other landmark.

A landmark is `null` when it isn't currently present or visible — e.g. no
compose button on the current view, or the mobile sidebar drawer is closed.
This isn't push-based: layout can change (resize, navigation, opening the
mobile sidebar), so call it again whenever you need fresh values rather
than caching the result.

### Reduced motion

**Plugin code always runs in a real Worker — even a "sandboxed" plugin,
which just relays messages through an iframe into a nested Worker it
creates — so `window`, `document`, and browser APIs tied to a rendering
viewport (like `matchMedia`) are never available inside your plugin,
regardless of what you name the global.** If your plugin animates or moves
something and wants to respect the user's OS-level reduced-motion
preference, ask the host instead of trying `window.matchMedia` yourself:

```js
if (await this.app.data.prefersReducedMotion()) {
  // skip/simplify movement
}
```

Like `getLandmarkRects()`, this isn't push-based — call it again if you
need to notice a live change rather than caching the result.

### Network requests to a configured endpoint

`permissions.fetch` is a static allowlist declared in `manifest.json` and
consented to once, at install/update time — a good fit when your plugin
always talks to the same handful of known hosts. It's the wrong fit when the
_user_ needs to point your plugin at an address of their own choosing (a
locally-run model server, a self-hosted proxy, their own API key against a
provider you can't predict at publish time) — there's no way to declare that
address ahead of time, and a static wildcard broad enough to cover "whatever
the user picks" would grant far more than intended.

For that case, declare `"permissions": { "network": ["configuredEndpoint"] }`
instead, and use `this.app.configuredEndpoint`:

```js
// Prompts the user with the exact address, host-rendered so your plugin
// can't spoof what they're approving. Resolves once they respond.
const { accepted, url } = await this.app.configuredEndpoint.requestUrl(
  "https://api.example.com/v1/chat/completions",
);

// The currently-approved address, or null if none has been approved yet.
const current = await this.app.configuredEndpoint.getUrl();

// Only ever succeeds against that one approved address (same-origin check:
// protocol + hostname + port) — a request to anywhere else throws.
const response = await this.app.configuredEndpoint.fetch(url, {
  method: "POST",
  headers: { Authorization: "Bearer " + apiKey },
  body: JSON.stringify({ ... }),
});
```

A few things that make this different from ordinary `fetch()`:

- The approved address is stored on the user's device, not in your plugin's
  synced settings — it's not something a plugin update can silently change
  out from under the user. Approving a new address always requires calling
  `requestUrl()` again and getting a fresh "Allow" from the user.
- `http://` is accepted, but only for `localhost`/`127.0.0.1`/`::1` — a
  carve-out for local model servers (e.g. Ollama), which typically don't run
  behind HTTPS. Everything else still requires `https://`.
- Unlike ordinary `fetch()`, an `Authorization` header is allowed through —
  it's your plugin's own credential for an address the user chose, not an
  ambient one. `Cookie` is still always stripped.

If you're pointing this at a local Ollama server, remember it's a real
browser-context request (not proxied through anything server-side), so
Ollama needs to be started with `OLLAMA_ORIGINS` set to allow Impro's origin
or the request will be blocked by CORS before it ever reaches your code.

### Custom uploaded images

`manifest.json`'s `images` array (see "Images" above) is for spritesheets
bundled into your plugin's own repo at publish time. To let a user add their
_own_ images at runtime — e.g. custom animations for a screen companion —
declare `"permissions": { "images": ["upload"] }` and use
`this.app.customImages`:

```js
// Render a real file picker — no special component needed.
containerEl
  .createEl("input", { attr: { type: "file", accept: "image/png" } })
  .onChange(async (event) => {
    // event.target.value is an opaque, single-use token standing in for
    // the picked file — the host reads the actual bytes itself and never
    // hands them to your plugin, the same way it never hands you a raw
    // font/image URL.
    await this.app.customImages.register({
      name: "my_custom_dance",
      frameWidth: 128,
      frameHeight: 128,
      frameCount: 15,
      fileToken: event.target.value,
    });
  });

const images = await this.app.customImages.list();
// [{ name, frameWidth, frameHeight, frameCount, size }, ...]

await this.app.customImages.delete("my_custom_dance");
```

The uploaded file is validated with the exact same rules as bundled images
(must be a real PNG, no larger than 2MB, dimensions must equal
`frameWidth * frameCount` by `frameHeight`) and is stored locally on the
user's device (not synced to their account, not routed through your
plugin's settings data). Once registered, render it exactly like a bundled
image — `createSprite()` doesn't distinguish between the two:

```js
containerEl.createSprite((sprite) => sprite.setImage("my_custom_dance"));
```

A custom image's name _can_ collide with one already declared in your
manifest's `images` array — on purpose, so a user can replace one of your
bundled animations with their own upload. The custom one takes over
rendering immediately (any already-showing `<plugin-sprite>` for that name
updates without a reload); deleting it restores your bundled original. There
is a per-plugin cap (20 images, 20MB total) to keep this from growing
unbounded.

### Acting on the user's behalf

Each of the following requires its own scope declared in
`"permissions": { "actions": [...] }`, granted by the user at install/update
time — a plugin can never do any of this silently:

| Scope            | Methods                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `"mute"`         | `this.app.muteActor(did)` / `unmuteActor(did)`                                       |
| `"block"`        | `this.app.blockActor(did)` / `unblockActor(did)`                                     |
| `"feedFeedback"` | `this.app.showLessLikeThis(postUri, feedUri)` / `showMoreLikeThis(postUri, feedUri)` |
| `"like"`         | `this.app.likePost(uri)` / `unlikePost(uri)`                                         |
| `"repost"`       | `this.app.repostPost(uri)` / `unrepostPost(uri)`                                     |
| `"follow"`       | `this.app.followActor(did)` / `unfollowActor(did)`                                   |
| `"bookmark"`     | `this.app.bookmarkPost(uri)` / `unbookmarkPost(uri)`                                 |

```js
"permissions": { "actions": ["like", "follow"] }
```

```js
await this.app.likePost("at://did:plc:author/app.bsky.feed.post/abc123");
await this.app.followActor("did:plc:someone");
```

Liking/reposting/following/bookmarking fire the same `post-liked`/
`post-reposted`/`profile-followed`/`post-created`-style events documented in
"Reacting to app activity" above, indistinguishable from the user having
clicked the button themselves — including in your own plugin's listeners.
There is deliberately no way for a plugin to publish a post or reply on the
user's behalf; drafting text for the user to review and send themselves is
the supported path (see the composer example under "Reacting to app
activity"'s `post-composer-open` docs, and "Clipboard" below).

### Clipboard

Declare `"permissions": { "clipboard": ["write"] }` and use
`this.app.clipboard` to let the user copy text your plugin generated — e.g.
a drafted reply — without granting your plugin any read access to whatever's
already on their clipboard (there is no read counterpart):

```js
await this.app.clipboard.write("Here's a reply I drafted for you!");
```
