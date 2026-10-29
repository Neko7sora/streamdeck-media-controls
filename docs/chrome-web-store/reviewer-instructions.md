# Chrome Web Store reviewer instructions

Updated: 2026-10-29. This extension is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/stream-deck-media-metadat/iagfcpchjohmpnnlcgppdcadehinhdpa) and is a Windows companion for Media Controls, available on the [Elgato Marketplace](https://marketplace.elgato.com/product/media-controls-c3009ed3-da9b-44ea-8edb-81db01b81ecc). It performs media observation, image processing, local transfer and supported HTML media playback commands. These instructions support review of future updates.

## Publisher preparation for an update

- Link to the Media Controls [Elgato Marketplace listing](https://marketplace.elgato.com/product/media-controls-c3009ed3-da9b-44ea-8edb-81db01b81ecc) in the dashboard's test instructions. If an extension update requires a companion version that is not yet published, also provide access to the matching `.streamDeckPlugin` package and specify which version to test.
- Verify the steps below on Windows with a physical Stream Deck. Provide any hardware access or demonstration requested by the review team; the automated browser tests stub Native Messaging and do not demonstrate the complete companion workflow.
- Keep the public privacy-policy URL, support contact and Privacy practices current, and confirm the submitted extension version and companion version work together. Use the ID of the extension under review for host registration.
- Update the dashboard instructions with the relevant versions, installation details and test results. Record hardware tests separately from the automated browser tests.

## Requirements and access

Windows 11 or later (x64); Chrome 111 or later; Stream Deck software 7.1 or later; a Stream Deck device and the Media Controls plugin. Now Playing + dial/seek tests require Stream Deck +. macOS is unsupported. The extension needs the companion to display media and receive device commands.

No extension account, subscription, license key or paid website account is required. Stream Deck hardware is a separate prerequisite. Host registration through the plugin uses Stream Deck's bundled Node.js runtime, requires no separate Node.js installation and does not request administrator access. Manual registration from source instead requires Node.js 24 or later.

## Test steps and expected behavior

1. Install Media Controls from the Elgato Marketplace, or use the matching `.streamDeckPlugin` package provided for the update under review. Add a Media Controls **Now Playing** action to a key and start the plugin.
2. Install the extension version under review. The published extension is available on the Chrome Web Store. Open its toolbar popup or options. Sending must be disabled on a fresh installation, and the disclosure must explain the data sent to the local plugin and the external artwork requests. The **Data and privacy** link opens the bundled policy, including Limited Use and deletion instructions.
3. Open `chrome://extensions`, find this extension and copy its 32-character ID. In the Stream Deck action settings, enter that ID and click **Register Chrome integration**. Only that explicitly entered ID is authorized. Registration writes the current user's Native Messaging host entry and local bridge files; no registry editing by the reviewer is needed.
4. Enable **Enable sending from the browser** in the extension and click **Save**. The connection should become **Connected to Stream Deck**. If the companion or registered host is absent, the popup must show a disconnected state; this does not demonstrate a working bridge.
5. Open a normal HTTP/HTTPS page with an accessible HTML `<audio>` or `<video>` element and media metadata, reload it after setup and start playback using the page's controls. No login-only or DRM-protected test service is required. In the Stream Deck action settings, explicitly select the browser media target to distinguish it from Windows-provided media. Available metadata and artwork should appear on the device. Missing site metadata is left unavailable rather than invented.
6. Press the configured Now Playing key to toggle play/pause on that selected page. For Stream Deck +, use Now Playing + and rotate to seek when the media element exposes a seekable timeline. Direct browser next/previous track commands and per-tab volume control are not supported. Windows audio controls are separate plugin features.
7. Open a second media tab and check that commands still target the explicitly selected document. Change tracks in that document and verify the updated media before sending commands. After navigation or loss of the selected target, reselect it in the action settings; a stale selection must not control another session. To test empty media observations, navigate a tab that previously had media to a normal HTTP/HTTPS page with no media elements or Media Session metadata. Confirm its previous media target disappears and the empty observations do not forward page titles or addresses or trigger image requests. Pausing or stopping playback alone does not remove media elements or metadata.
8. Disable sending and click **Save**. The status must show disabled; further media forwarding and new image requests stop. The plugin may keep its last display for about 15 seconds. Existing page scripts can still observe media APIs; restricting Chrome site access or removing the extension and reloading the tabs stops those scripts.
9. Stop/restart the plugin and reopen the extension settings. Verify that sending remains disabled. Enable sending and save, then verify connection recovery and the media target; stop/start the plugin again with sending enabled to verify disconnection and reconnection. Disable sending and save when finished. Repeat in both Japanese and English if reviewing localization.

Artwork requests go to site-selected public HTTPS image hosts without credentials, referrers or redirects. Local media transfers use Chrome Native Messaging and certificate-pinned HTTPS with bearer authentication on `127.0.0.1:39761`. There is no developer-operated media upload endpoint.

To remove local bridge files and the per-user host registration after testing, follow the [privacy and deletion instructions](../marketplace/privacy.md). Removing the extension alone does not remove the separately installed companion.
