# Media Controls: data and privacy

Updated: 2026-10-29. This notice describes data handling by Media Controls, available on the Elgato Marketplace, and its optional companion extension, available on the Chrome Web Store.

Media Controls processes media information on your Windows PC to display it on Stream Deck and control the targets you choose. It has no analytics, advertising, account system or developer-operated media upload service.

## Information used

The plugin reads media information exposed by Windows, including media session identifiers, app identifiers and icons, titles, artists, albums, artwork, playback state, timeline and available controls. It reads output and audio-session information, including app names, process identifiers, volume and mute state, to offer audio targets. Available fields depend on the app. These live media snapshots and image caches are held in process memory, with bounded caches; they are not saved as a media history.

Stream Deck stores the settings you choose for each action, including selected target identifiers, display options and dial behavior, in its profiles. The plugin and its SDK write local diagnostic logs; errors may include local paths and identifiers. Review logs before sharing them. Stream Deck itself is provided by Elgato and has its own data practices.

## Optional Chrome bridge

Media Bridge's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. See the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies#limited-use).

Media Bridge による Chrome API から受け取った情報の利用は、Limited Use 要件を含む Chrome Web Store User Data Policy に準拠します。

The companion extension is optional. Sending is off by default. You enable it in the extension settings and save; you can disable it there at any time. Chrome also lets you limit the extension's site access. Its declared HTTP/HTTPS access supports media pages and artwork hosts; it does not request history, cookies, audio capture or webRequest permissions.

Chrome user data is used and transferred only as needed for the extension's single purpose: displaying media and providing supported controls through the local Media Controls plugin. It is not sold, used for advertising, tracking, credit or lending decisions, or repurposed for unrelated features. The developer has no media-data endpoint or access to the live media stream. Support information is read only when the user chooses to submit it for help; do not submit personal data through public issues.

When sending is enabled, the extension transfers available Media Session and accessible HTML media element information, artwork and favicons, page titles, sanitized page URLs, and tab/frame/document identifiers to the local plugin. URL credentials, queries and fragments are removed from page URLs before transfer. A random local bridge identifier distinguishes Chrome instances; it is stored in the extension's local storage with your settings. It is not an analytics identifier. Even with sending disabled, the installed page scripts may observe media API calls within the page; disabling sending prevents forwarding media information and fetching artwork. Remove the extension or restrict its site access, then reload the affected tabs or restart Chrome to unload scripts already running on those pages.

Empty observations clear an earlier media target without sending page titles, page addresses or arbitrary page fields. They do not fetch images.

Communication uses Chrome Native Messaging and authenticated HTTP bound to `127.0.0.1:39761`. A random bridge token and native host files are stored under `%LOCALAPPDATA%\StreamDeckMediaControls`. Registration requires the user to verify and enter the extension ID from `chrome://extensions`, and adds a per-user native host registry entry for that one ID. It does not select extensions by reading Chrome profile settings. The token is not sent to web pages or stored in the extension.

Artwork and favicon fetching can contact the original website or an image host over HTTPS. These servers receive ordinary request information, such as your IP address and the requested image URL. Unlike page addresses, image URLs may retain site-provided query parameters. Requests omit credentials, do not follow redirects and send no referrer. This is separate from the local transfer of media information. The plugin does not collect audio/video streams or DRM data.

## Stopping use and deleting local data

1. Disable sending and save in the Chrome extension settings. Remove the extension through `chrome://extensions` to remove its local settings and bridge identifier. Restart Chrome to unload page scripts from existing tabs.
2. Stop Stream Deck before deleting bridge files. Remove the registry entry `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\dev.n7s.media_controls` and the directory `%LOCALAPPDATA%\StreamDeckMediaControls` if you no longer use the bridge. The directory contains the token and native host files; the plugin can recreate them if restarted or registered again.
3. Remove the plugin's actions from Stream Deck profiles and uninstall the plugin through Stream Deck. Local diagnostic logs are in the plugin's `logs` directory. Delete residual plugin files if they remain after uninstalling. Profile backups may retain action settings until you delete those backups.
4. Exit the plugin and Chrome to clear their in-memory media caches. The developer does not store a remote copy of this local media data.

For questions and support, use [GitHub Issues](https://github.com/Neko7sora/streamdeck-media-controls/issues). Issues are public: do not post personal information, tokens, private media details or unreviewed logs. Media information, settings and caches are removed on your PC using the local steps above. The developer does not store a remote copy of that data. Opening GitHub support is optional and is subject to GitHub's own privacy practices.

お問い合わせは [GitHub Issues](https://github.com/Neko7sora/streamdeck-media-controls/issues) へお願いします。Issue は公開されます。個人情報・トークン・非公開の再生情報・未確認のログを投稿しないでください。再生情報・設定・キャッシュは、上記の手順で利用者自身がPC内から削除できます。開発者はそのコピーをサーバーに保存していません。GitHub への問い合わせは任意で、GitHub 自身のプライバシーポリシーが適用されます。
