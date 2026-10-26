# Chrome Web Store reviewer instructions

Draft, 2026-10-25. This extension is a Windows companion for Media Controls on Stream Deck. It performs media observation, image processing, local transfer and supported HTML media playback commands; it does not simply launch or link to another application.

## Publisher preparation — complete before submission

- Provide a reachable direct download for the matching, tested Media Controls `.streamDeckPlugin` package in the dashboard's test instructions. A repository source link alone is insufficient for these steps. No released download URL has been confirmed in this repository.
- Verify the steps below on Windows with a physical Stream Deck. Provide any hardware access or demonstration requested by the review team; the automated browser tests stub Native Messaging and do not demonstrate the complete companion workflow.
- Enter the public privacy-policy URL and support contact, complete Privacy practices, and confirm the submitted extension version and companion version work together. Use the ID of the submitted extension for host registration.
- Copy the completed instructions into the dashboard, including the actual download URL and any current installation details. Do not submit this draft with missing prerequisites or claim the hardware test has already passed.

## Requirements and access

Windows 11 or later (x64); Chrome 111 or later; Stream Deck software 7.1 or later; a Stream Deck device and the Media Controls plugin. Now Playing + dial/seek tests require Stream Deck +. macOS is unsupported. The extension needs the companion to display media and receive device commands.

No extension account, subscription, license key or paid website account is required. Stream Deck hardware is a separate prerequisite. Host registration through the plugin uses Stream Deck's bundled Node.js runtime, requires no separate Node.js installation and does not request administrator access. Manual registration from source instead requires Node.js 24 or later.

## Test steps and expected behavior

1. Install the supplied `.streamDeckPlugin` package through Stream Deck and add a Media Controls **Now Playing** action to a key. Start the plugin.
2. Install the submitted extension. Open its toolbar popup or options. Sending must be disabled initially, and the disclosure must explain the data sent to the local plugin and the external artwork requests. The **Data and privacy** link opens the bundled policy, including Limited Use and deletion instructions.
3. Open `chrome://extensions`, find this extension and copy its 32-character ID. In the Stream Deck action settings, enter that ID and click **Register Chrome integration**. Only that explicitly entered ID is authorized. Registration writes the current user's Native Messaging host entry and local bridge files; no registry editing by the reviewer is needed.
4. Enable **Enable sending from the browser** in the extension and click **Save**. The connection should become **Connected to Stream Deck**. If the companion or registered host is absent, the popup must show a disconnected state; this does not demonstrate a working bridge.
5. Open a normal HTTP/HTTPS page with an accessible HTML `<audio>` or `<video>` element and media metadata, reload it after setup and start playback using the page's controls. No login-only or DRM-protected test service is required. In the Stream Deck action settings, explicitly select the browser media target to distinguish it from Windows-provided media. Available metadata and artwork should appear on the device. Missing site metadata is left unavailable rather than invented.
6. Press the configured Now Playing key to toggle play/pause on that selected page. For Stream Deck +, use Now Playing + and rotate to seek when the media element exposes a seekable timeline. Direct browser next/previous track commands and per-tab volume control are not supported. Windows audio controls are separate plugin features.
7. Open a second media tab or change tracks and check that selection and commands continue to target the selected document. Stop all media and confirm empty media observations do not forward page titles or addresses or trigger image requests.
8. Disable sending and click **Save**. The status must show disabled; further media forwarding and new image requests stop. The plugin may keep its last display for about 15 seconds. Existing page scripts can still observe media APIs; restricting Chrome site access or removing the extension and reloading the tabs stops those scripts.
9. Stop/restart the plugin and reopen the extension settings. Verify disconnection and recovery without re-enabling sending after the user disabled it. Repeat in both Japanese and English if reviewing localization.

Artwork requests go to site-selected public HTTPS image hosts without credentials, referrers or redirects. Local media transfers use Chrome Native Messaging and token-authenticated HTTP on `127.0.0.1:39761`. There is no developer-operated media upload endpoint.

To remove local bridge files and the per-user host registration after testing, follow the [privacy and deletion instructions](../marketplace/privacy.md). Removing the extension alone does not remove the separately installed companion.
