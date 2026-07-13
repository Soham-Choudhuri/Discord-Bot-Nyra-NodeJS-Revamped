# Changelog for Nyra Brooks

## Update 1: The Configuration Update

I have implemented a complete persistent configuration system for Nyra. Server administrators can now customize the bot's behavior in real-time using a visual dashboard.

### 1. High-Performance Database Foundation
- **SQLite Engine**: Integrated `better-sqlite3` for synchronous, low-latency configuration storage.
- **ConfigManager Service**: A singleton service that caches all guild settings in memory. Lookups during playback are near-instant and do not block the event loop.

### 2. Interactive Settings Dashboard
- **`/settings` Command**: A beautiful admin-only dashboard showing the current server configuration.
- **Dynamic UI**: Uses Discord **String Select Menus** and **Modals** (forms) to update settings without needing to type complex commands.
- **Instant Updates**: Settings are applied immediately to all active players without requiring a bot restart.

### 3. Smart Configuration Logic
- **Verbose vs. Compact Mode**:
    - **Verbose (Default)**: Sends the detailed "Now Playing" embeds with artwork and duration.
    - **Compact**: Sends a simple text line (`🎵 Now playing: Artist - Title`) to save screen space and reduce clutter.
- **Announcement Channel Binding**: Admins can force "Now Playing" messages to a specific channel (e.g., `#now-playing`) instead of where the command was run.
- **Max Queue Enforcement**: The `/stream` command now checks the server's `max_queue_size` setting and blocks users if the limit is reached.
- **Custom Autoplay Seeds**: You can now set a permanent YouTube Video ID or URL to act as the primary seed for the autoplay algorithm in your server.

## Update 2: Real-Time Persistence & Cleanliness

### 1. Persistent "Now Playing" System
- Nyra now edits the **same message** for every new track, keeping your chat clean.
- If the message is deleted, the bot automatically sends a new one and updates the database.
- **Bonus**: When the queue ends, the message is edited to `🏁 Queue finished! I'm still in the voice channel.`
- **New Playback Controls**:
    - **`/stop`**: Stops playback immediately and clears the queue, but the bot **stays** in the voice channel.
    - **`/leave`**: Performs a full stop, clears the queue, and **disconnects** the bot.
    - **`/stopafter` (Lazy Stop)**: Clears the upcoming queue and disables autoplay, but allows the **current song to finish** naturally before stopping.
- **Stay-in-Channel Behavior**:
    - By default, Nyra will now remain in the voice channel even after the queue is empty or playback is stopped, ensuring she's always ready for the next song.
- **Command Channel Restriction**:
    - Admins can lock Nyra to a specific channel (e.g., `#bot-commands`). 
    - **Strict Enforcement**: Commands run elsewhere will be blocked for **all users**, including administrators and server owners, to ensure the designated "Now Playing" channel remains clean.
- **Auto-Delete Timer**:
    - Configure a global timer (e.g., 10 seconds) for all bot command replies. This ensures the channel stays tidy while still providing necessary feedback.
- **Investigation: Auto-Delete Fix**:
    - **Issue**: The auto-delete system wasn't clearing command replies because it only supported standard `Message` objects.
    - **Fix**: Refactored the utility to support `Interaction` objects. It now uses `deleteReply()` to cleanly remove slash command responses after the set delay.

## Update 3: Engine Improvements & Variety
- **Artist Loop Prevention**:
    - Implemented a rolling `artistHistory` (configurable depth) to prevent the bot from repeating the same artist during long autoplay sessions.
- **Regex-Powered Content Filtering**:
    - Replaced static blacklists with dynamic, guild-configurable **JavaScript Regular Expressions**. This allows for precise filtering of unofficial content like `(Slowed + Reverb)`, `Nightcore`, or `8D Audio`.
- **Just-In-Time (JIT) Autoplay**:
    - Refactored the recommendation engine to perform resolution only when the queue is dry, maximizing network stability during active playback.

## Update 4: Next-Gen Audio Engine & Personalized Favorites
- **NodeLink & Lavalink-Client Migration**:
    - Replaced Java Lavalink and Shoukaku with a lightweight V8 NodeLink engine and Lavalink-Client wrapper. This entirely eliminates JVM garbage-collection micro-stutters, drastically reduces RAM consumption, and ensures flawless high-fidelity audio routing.
- **Interactive User Favorites**:
    - Introduced a global, cross-server SQLite `user_favorites` database. Users can instantly toggle quick-saves for tracks via a UI "❤️" Button (Verbose Mode) or an interactive message reaction (Compact Mode).
    - Includes a full `/favorites` command suite with custom embeds and a clean, dropdown-based removal system.
- **JIT Favorites Playlist**:
    - Engineered a secondary Just-In-Time (JIT) resolution queue for streaming favorite tracks. It initiates instant playback of the first track while intelligently resolving the remaining playlist in the background to completely bypass YouTube's SABR anti-bot throttles.
- **Real-Time Activity Syncing**:
    - The bot's Discord Presence now automatically updates to display the currently playing `Artist - Title`, and gracefully clears itself when all active music sessions end.

## Update 5: The Personalized Update

## 1. The Expanded Favorites System (Vibe Categorization)
The standard "❤️" save feature has been rebuilt into a relational categorization engine.

* **SQLite Database Migration:** Upgraded the `user_favorites` table with a new `tag` column via a safe `ALTER TABLE` migration, ensuring zero data loss for existing users.
* **Interactive Ephemeral UI:** Intercepting the "❤️" button now deploys a private `StringSelectMenu`. Users no longer dump tracks into a flat list; they actively categorize their music into specific "Vibes":
    * 🎸 Heavy / Metalcore
    * 🌙 Late Night / Chill
    * 🔥 High Energy
    * 📁 Uncategorized
* **Smart Upserts:** The database logic automatically checks for duplicate track URLs and updates the existing tag rather than creating duplicate entries.

## 2. The `/blend` Command (Personalized Autoplay)
A brand new architectural bridge between localized SQLite data and the Just-In-Time (JIT) Autoplay engine.

* **Algorithmic Seeding:** Users can execute `/blend vibe:heavy`. Nyra queries the database, extracts a random track from that specific category, and uses it as the absolute initial seed for the session.
* **Seamless JIT Integration:** Once the seeded track finishes, the Autoplay engine natively analyzes the sonic profile of that specific song and continues generating a flawlessly curated radio station without requiring any external DSP or filtering.
* **Failsafes:** Built-in guards prevent blending if the user lacks sufficient saved tracks in a specific vibe, prompting them to use the interactive UI first.

## 3. Premium Paginated Queue UI
The `/queue` command was rewritten from the ground up to prevent text-wall spam and improve interaction flow.

* **Interactive Pagination:** Chunks the upcoming queue into pages of 10 tracks, presented via a clean embed. Includes dynamic "Next ▶" and "◀ Previous" buttons.
* **Advanced Math Engine:** Calculates and displays the *Total Queue Time* for the entire session. Safely handles Lavalink's max-integer signatures for Live Streams (displaying `🔴 LIVE` instead of breaking the math).
* **Memory-Safe Collectors:** The button interaction collector is strictly bound to the requester's User ID (preventing other users from hijacking the UI) and automatically self-destructs after 60 seconds, stripping the buttons from the embed to keep Discord API memory clean.

## Update 6: The Background Update

This update introduces major enhancements to the YouTube Music integration, completely optimizing search logic and algorithmic recommendations while reinforcing the engine's technical stability.

### 1. Optimized Search Accuracy
- **Levenshtein Matching Engine**: Built a mathematical string-matching utility that intelligently pairs your text searches to the closest official track.
- **Explicit Filtering**: `/stream` and `/mix` commands now perform explicit queries against the YouTube Music API to filter out covers, remixes, and unrelated video content, ensuring the exact track requested is the one queued.

### 2. Advanced Autoplay Engine
- **Bi-directional Seed Evolution**: The autoplay buffer now generates its algorithmic "Up Next" tracks by pulling from a dynamic "cluster" of the last 3 played songs rather than a single static seed, vastly improving musical variety and stability.
- **Advanced ATV Isolation**: Modified the recommendation heuristics to prioritize `MUSIC_VIDEO_TYPE_ATV` (Official Studio Audio) while allowing safe fallbacks to `MUSIC_VIDEO_TYPE_OMV` (Official Music Videos). This guarantees pristine sound quality whenever available.

### 3. NodeLink Multi-Client Optimization
- **YouTube Client Prioritization**: Reconfigured the embedded NodeLink server to explicitly prioritize `ANDROID_MUSIC` and `WEB_REMIX` clients during the metadata resolution and search phases. This guarantees YouTube Music specific tags are fetched accurately, improving the metadata quality displayed in Discord.

### 4. Multi-Layered Resilience

This update hardens the core search and Autoplay systems to handle strict filtering failures, API throttling, and regional metadata mismatches without interrupting the music session.

#### Autoplay Filtering Resilience
- **Tiered Filtering (Soft-Fails)**: Replaced the strict, single-pass recommendation filter with a 3-tier fallback system. If the algorithm cannot find a strict Official Audio track that passes the Regex blacklist, it gracefully drops the Regex check, and eventually the VideoType check, to guarantee continuous playback rather than failing entirely.
- **SQLite Database Recovery**: If the Autoplay seed reaches a complete dead-end (e.g., deleted video or heavily restricted metadata), the bot will now query the user's `user_favorites` database to pull a completely new, human-curated track as the new seed to break the chain.

#### Search & Command Resilience
- **Diversified Prefix Rotation**: NodeLink metadata fetching is highly dependent on the YouTube client. If a strict YouTube Music search (`ytmsearch:`) fails to resolve a track, `/stream` and `/mix` commands will now instantly catch the failure and dynamically rotate the query prefix to a standard `ytsearch:`. This leverages different indexing and licensing pools to find tracks that might be "hidden" on specific clients.

## Update 7: The Moonlink Update

This update introduces a complete architectural migration to Moonlink.js to maximize synergy with the V8-engine NodeLink server, completely replacing the generalist `lavalink-client` with a hyper-specialized audio bridging system.

### 1. Moonlink v5 Migration
- **Library Replacement**: Fully uninstalled `lavalink-client` and implemented `moonlink.js` v5.
- **Gateway Interception**: Re-architected `src/index.js` to hook into Discord's raw `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` events, passing packets directly into the `Moonlink.Manager` instance for near-zero latency routing.
- **Native Data Structures**: Refactored the entire codebase to adopt Moonlink's modern flat `Track` structure (e.g., migrating `track.info.title` to `track.title` and `track.info.length` to `track.duration`), eliminating nested object parsing overhead.

### 2. Command Suite Overhaul
- **Strict API Validation**: Upgraded search payloads in all music commands (`/stream`, `/mix`) to include proper `requester` objects, satisfying Moonlink's strict internal validation requirements.
- **Player & Queue API Alignment**: Migrated all command and playback logic from `client.lavalink.getPlayer()` to `client.moonlink.players.get()` and modernized queue manipulation strategies.

### 3. Feature Pruning & Stability
- **Command Deprecation**: Cleanly and gracefully removed the `/blend` command as requested, streamlining the command pool and reducing UI confusion regarding the "Vibe" tagging system.
- **Event Parity**: Updated `src/lavalink/playerEvents.js` and `src/lavalink/lavalinkEvents.js` to correctly map to Moonlink's specific event signatures (`trackException`, `nodeCreate`, `nodeRaw`), restoring real-time console logging and UI updates.
