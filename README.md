# Nyra Brooks (Personalized Discord Music Bot)

Nyra Brooks is a personalized Discord music bot built with JavaScript, focused on high performance and user experience. She utilizes a custom NodeLink integration for low-latency audio playback and a sophisticated Just-In-Time (JIT) algorithm to deliver personalized music recommendations.

To view the detailed history of updates and architectural changes, see in [Changelog](docs/Changelog.md).

## Feature Highlights
- **High-Performance Audio Engine**: Powered by NodeLink and Moonlink.js for stutter-free, zero-GC-pause audio streaming.
- **Just-In-Time (JIT) Autoplay**: Smart YouTube Music recommendation algorithm with bi-directional seed evolution and adaptive filtering to prevent artist loops and unwanted content.
- **Interactive UI & Dashboards**: Intuitive string select menus, modals, and pagination for `/queue`, `/settings`, and `/favorites`.
- **Persistent Configuration**: SQLite-backed configuration system with instant updates and in-memory caching.
- **Resilient Fallbacks**: Multi-layered search fallbacks and automated database recovery during streaming dead-ends.

## Requirements
- **Node.js**: v22.22.2 or higher (LTS recommended)
- **Discord Bot Token**: A valid bot application token from the Discord Developer Portal.
- **Lavalink / NodeLink Server**: A running NodeLink server instance (port 2333 by default) for handling raw audio extraction and streaming.

## Usage Guidance
1. **Starting the Bot**:
   - Ensure the NodeLink background server is running (`npm start` inside the `nodelink` directory).
   - Start the Discord bot using `npm start` in the main directory.
2. **Settings Configuration**:
   - Server administrators can use `/settings` to access the visual dashboard and configure features like Verbose/Compact mode, Announcement channels, and Max Queue Size.
3. **Music Playback**:
   - Use `/stream <query>` to search and play tracks from YouTube Music.
   - Use `/mix <query>` to start a personalized radio station based on a seed track.

4. **Favorites System**:
   - In Verbose mode, click the "❤️" button on the Now Playing embed to save tracks to your personal database.
   - Use `/favorites` to view or manage your saved tracks.
5. **Playback Controls**:
   - Regular controls: `/skip`, `/stop`, `/leave`, `/queue`.
   - Use `/stopafter` to let the current song finish before gracefully ending the session.