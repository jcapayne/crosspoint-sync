# Personal Team iOS development

User chose a free Personal Team after the official signing team blocked phone installation.
Generate an ignored isolated app build directory with a unique bundle ID and the user's team ID. Remove the WidgetKit extension and restricted App Groups/Associated Domains entitlements in that generated project. Disable Universal Links for this build; connector callbacks requiring them are unavailable. Preserve official app configuration and generated project.

Move App Intents snapshots into main-app Application Support storage (both official and personal builds). The widget continues using its own App Group for official builds; no widget is included in personal builds. Cache schema, dates, account isolation and clearing are unchanged.

Use Tauri build --debug --open to bundle frontend assets and establish an Xcode build session. Xcode Run signs and installs directly instead of IPA export, which is unsuitable for free provisioning. The installed app must launch offline without a Vite server. Provide commands for prepare, interactive Xcode signing, and running on the phone. No device installation without user invoking the run command.

Alternative: mutate and restore the official project during personal builds; rejected because interruptions could leave signing settings changed. Paid membership was considered and the user explicitly chose a free team.
