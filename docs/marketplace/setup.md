# Media Controls setup

Requires Windows 10 version 1809 or later (x64) or Windows 11 (x64), and Stream Deck 7.1 or later. Dial actions require Stream Deck +. macOS is not supported.

Install the plugin and add a Media Controls action to a key or dial. Start a media app and choose a playback target in the action settings, or leave automatic selection enabled. Choose the system output or an available app as the separate audio target for volume actions. Artwork, metadata and playback controls depend on what the selected app exposes to Windows. Unsupported operations show an alert.

Now Playing displays artwork, track title, artist and playback state. Now Playing + also displays available playback time and progress. Rotate its dial to seek (default: five seconds per tick), or choose volume mode in settings. Press to play/pause, tap the progress bar to seek when supported, or hold the touch strip to cycle sessions. Volume Dial rotates for volume and uses press/tap for mute. Display customization and scrolling settings apply to each action independently.

## Optional Chrome integration

Windows media sessions work without the extension. The optional companion adds browser metadata and direct control of accessible HTML media elements. It requires Chrome 111 or later.

1. Obtain the `chrome-extension` folder from this repository's source download and keep it in a stable location. In `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that folder. This is a manual setup; there is currently no Chrome Web Store listing.
2. In a Media Controls action's settings, open **Setup Chrome integration**, enter the ID from the intended extension in `chrome://extensions`, then click **Register Chrome integration**. Verify that it is the extension you loaded from this repository; a matching display name is not proof of identity. Only this ID is authorized. This installs a local native host for the companion extension. Use this button for an installed plugin; it uses Stream Deck's bundled Node.js runtime.
3. Open the extension's options, enable **Enable sending from the browser**, and save. Confirm the connected state, then reload media pages that were already open.
4. Choose the browser session in the action settings. You can restrict the extension's site access using Chrome's controls.

Direct Chrome controls support play/pause, stop and seeking when an accessible media element supports them. Direct previous/next track commands, Web Audio-only players, closed Shadow DOM and inaccessible frames are not supported. Volume actions use Windows audio targets, not individual browser tabs. Missing information is displayed as unavailable rather than inferred from the page title.

If disconnected, start Stream Deck, register the integration again and reload the extension and media page. Reselect a target if it disappeared or a Windows helper restarted. See [data and privacy](privacy.md) for data flow, disabling and removal instructions, and the [project README](../../README.md) for development and troubleshooting details.

After updating from an older version, register again with the verified ID and fully quit and restart Chrome. Re-registration replaces the old origin allowlist; restarting Chrome ends already running native-host connections.
