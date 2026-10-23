# Media Controls: data and privacy

Updated: 2026-10-23. This notice describes the code in this repository. The publisher must review it and publish a reachable version before listing the product.

Media Controls processes media information on your Windows PC to display it on Stream Deck and control the targets you choose. It has no analytics, advertising, account system or developer-operated media upload service.

## Information used

The plugin reads media information exposed by Windows, including media session identifiers, app identifiers and icons, titles, artists, albums, artwork, playback state, timeline and available controls. It reads output and audio-session information, including app names, process identifiers, volume and mute state, to offer audio targets. Available fields depend on the app. These live media snapshots and image caches are held in process memory, with bounded caches; they are not saved as a media history.

Stream Deck stores the settings you choose for each action, including selected target identifiers, display options and dial behavior, in its profiles. The plugin and its SDK write local diagnostic logs; errors may include local paths and identifiers. Review logs before sharing them. Stream Deck itself is provided by Elgato and has its own data practices.

## Optional Chrome bridge

The companion extension is optional. Sending is off by default. You enable it in the extension settings and save; you can disable it there at any time. Chrome also lets you limit the extension's site access. Its declared HTTP/HTTPS access supports media pages and artwork hosts; it does not request history, cookies, audio capture or webRequest permissions.

When sending is enabled, the extension transfers available Media Session and accessible HTML media element information, artwork and favicons, page titles, sanitized page URLs, and tab/frame/document identifiers to the local plugin. URL credentials, queries and fragments are removed from page URLs before transfer. A random local bridge identifier distinguishes Chrome instances; it is stored in the extension's local storage with your settings. It is not an analytics identifier. Even with sending disabled, the installed page scripts may observe media API calls within the page; disabling sending prevents forwarding media information and fetching artwork. Remove the extension or restrict its site access to stop those page scripts from running on a site.

Communication uses Chrome Native Messaging and authenticated HTTP bound to `127.0.0.1:39761`. A random bridge token and native host files are stored under `%LOCALAPPDATA%\StreamDeckMediaControls`. Registration reads Chrome extension settings to identify the companion extension and adds a per-user native host registry entry. The token is not sent to web pages or stored in the extension.

Artwork and favicon fetching can contact the original website or an image host over HTTPS. These servers receive ordinary request information, such as your IP address and the requested image URL. Requests omit credentials, do not follow redirects and send no referrer. This is separate from the local transfer of media information. The plugin does not collect audio/video streams or DRM data.

## Stopping use and deleting local data

1. Disable sending and save in the Chrome extension settings. Remove the extension through `chrome://extensions` to remove its local settings and bridge identifier. Restart Chrome to unload page scripts from existing tabs.
2. Stop Stream Deck before deleting bridge files. Remove the registry entry `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\dev.n7s.media_controls` and the directory `%LOCALAPPDATA%\StreamDeckMediaControls` if you no longer use the bridge. The directory contains the token and native host files; the plugin can recreate them if restarted or registered again.
3. Remove the plugin's actions from Stream Deck profiles and uninstall the plugin through Stream Deck. Local diagnostic logs are in the plugin's `logs` directory. Delete residual plugin files if they remain after uninstalling. Profile backups may retain action settings until you delete those backups.
4. Exit the plugin and Chrome to clear their in-memory media caches. The plugin has no remote media database from which to request deletion.

For questions, use the repository's [support page](https://github.com/Neko7sora/streamdeck-media-controls/issues). Do not post tokens, private media details or unreviewed logs in a public issue. Before publication, the publisher must also provide a private contact route for privacy or deletion requests involving information voluntarily sent for support. Do not submit personal data through a public issue.
