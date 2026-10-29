# Media Controls setup

Requires Windows 11 or later (x64), and Stream Deck 7.1 or later. Dial actions require Stream Deck +. macOS is not supported.

Install the free plugin from the [Elgato Marketplace](https://marketplace.elgato.com/product/media-controls-c3009ed3-da9b-44ea-8edb-81db01b81ecc) and add a Media Controls action to a key or dial. Start a media app and choose a playback target in the action settings, or leave automatic selection enabled. Choose the system output or an available app as the separate audio target for volume actions. Artwork, metadata and playback controls depend on what the selected app exposes to Windows. Unsupported operations show an alert.

Now Playing displays artwork, track title, artist and playback state. Now Playing + also displays available playback time and progress. Rotate its dial to seek (default: five seconds per tick), or choose volume mode in settings. Press to play/pause, tap the progress bar to seek when supported, or hold the touch strip to cycle sessions. Volume Dial rotates for volume and uses press/tap for mute. Display customization and scrolling settings apply to each action independently.

## Optional Chrome integration

Windows media sessions work without the extension. The optional companion adds browser metadata and direct control of accessible HTML media elements. It requires Chrome 111 or later.

1. Install the companion extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/stream-deck-media-metadat/iagfcpchjohmpnnlcgppdcadehinhdpa). The store extension ID is `iagfcpchjohmpnnlcgppdcadehinhdpa`.
2. In a Media Controls action's settings, open **Setup Chrome integration**, verify the installed extension's source and ID in `chrome://extensions`, enter `iagfcpchjohmpnnlcgppdcadehinhdpa` for the store version, then click **Register Chrome integration**. A matching display name is not proof of identity. Only the entered ID is authorized. This installs a per-user local native host for the companion extension. Use this button for an installed plugin; it uses Stream Deck's bundled Node.js runtime and requires no separate Node.js installation or administrator access. Manual registration from source instead requires Node.js 24 or later; see the project README.
3. Open the extension's options, enable **Enable sending from the browser**, and save. Confirm the connected state, then reload media pages that were already open.
4. Choose the browser session in the action settings. You can restrict the extension's site access using Chrome's controls.

For development, you can instead load this repository's `chrome-extension` folder using **Load unpacked** in `chrome://extensions` with Developer mode enabled. An unpacked extension may have a different ID; register the ID shown for the extension you actually loaded. When switching from an unpacked extension to the store version, disable or remove the unpacked copy and register again using the store ID.

Direct Chrome controls support play/pause, stop and seeking when an accessible media element supports them. Direct previous/next track commands, Web Audio-only players, closed Shadow DOM and inaccessible frames are not supported. Volume actions use Windows audio targets, not individual browser tabs. When a track title is missing, keys and dials display the available page title, or an unavailable label if neither exists. This display fallback does not replace track metadata or identify command targets. Other missing information is displayed as unavailable.

If disconnected, start Stream Deck, register the integration again and reload the extension and media page. Reselect a target if it disappeared or a Windows helper restarted. See [data and privacy](privacy.md) for data flow, disabling and removal instructions, and the [project README](../../README.md) for development and troubleshooting details.

After updating from an older version, register again with the verified ID and fully quit and restart Chrome. Re-registration replaces the old origin allowlist; restarting Chrome ends already running native-host connections.
