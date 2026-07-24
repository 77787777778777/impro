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
- Add custom feed filters
- Transform rich text in posts
- Make whitelisted network requests (requires permissions)
- Read appview data with the current user as the viewer (profiles, posts, etc.)
- Mute, block, or send feed feedback ("show more/less like this") on the user's behalf (requires permissions)

### Plugins CANNOT:

- Make arbitrary network requests
- Read or modify page HTML directly

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
