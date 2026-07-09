# BeatFrame Studio

**Automatically turn Beat Saber gameplay recordings into polished, upload-ready YouTube videos and Shorts.**

Import a recording, enter the BeatSaver map ID (usually auto-detected), pick *Long-form* or *Short*, hit **Render** — BeatFrame does the rest: animated intro card with cover art and player info, untouched gameplay, professional end screen, thumbnail, SEO-friendly metadata, and (optionally) a fully automated upload to your YouTube channel on a daily schedule.

---

## Features

### Editing
- **Long-form videos** — fade in from black, animated title card (song / artist / mapper / cover art / player / difficulty), gameplay kept *exactly* as recorded (no cuts, zooms or effects), then a clean end screen with subscribe & recommended-video placeholders and a fade out.
- **Blurred gameplay backdrops** *(v1.1)* — the intro and end screen play a softly blurred clip of your own gameplay behind the cards, so every video opens with motion instead of a flat background. Toggle in Templates.
- **Split-screen intro** *(v1.1)* — cover art fills one half, the player's avatar and name the other, divided by an accent line. The classic centered panel remains available.
- **Smart highlight detection** *(v1.2)* — Shorts can start at the most intense section automatically, and backdrop clips prefer energetic moments: BeatFrame samples the audio energy across the recording (adds under a second of prep).
- **Your score on the intro card** *(v1.2)* — with a BeatLeader profile connected, your accuracy (and rank) for the map appears on the title card and in the description.
- **Card previews** *(v1.2)* — Templates → "Preview with real data" renders the exact intro/end screen/thumbnail for any map ID without running a full encode.
- **YouTube Shorts** — vertical 9:16 smart crop with adjustable framing, compact animated intro, up to 3 minutes, smooth ending.
- **Single-pass rendering** — intro, outro, fades, scaling and audio conditioning are composited in one FFmpeg filtergraph. The gameplay is encoded exactly once; no intermediate files.
- **Audio** — optional loudness normalization to −14 LUFS (YouTube's playback level) and volume adjustment.
- Optional trim of dead space at the start/end. Nothing else touches your gameplay.

### Metadata & integrations
- **BeatSaver** — song title, artist, mapper, BPM, duration, difficulties and cover art fetched from the map ID. IDs are auto-detected from filenames like `Song [25f].mp4`, `!bsr 25f`, or BeatSaver URLs.
- **BeatLeader / ScoreSaber** — paste either profile link; the player's display name and avatar appear on the intro card and in metadata.
- **Generated YouTube metadata** — natural, searchable titles (< 100 chars), well-formatted descriptions with map/mapper credits, profile links and your custom footer (links/socials), deduplicated relevant tags under the 500-character limit, max 3 hashtags. No clickbait, no tag spam.

### YouTube
- Secure Google sign-in (OAuth 2.0 + PKCE, loopback redirect). Tokens are encrypted with the OS keychain (`safeStorage`).
- Resumable, chunked uploads with automatic retry and progress.
- Visibility control (private/unlisted/public), playlists, scheduled publishing, custom thumbnails, upload history.
- **Upload review dialog** *(v1.2)* — edit the generated title/description/tags, pick visibility and playlist, and optionally schedule the publish time right from the render queue.

### Full automation
- Watch an input folder — new recordings are detected (even ones dropped while the app was closed), rendered with your template, metadata-generated, uploaded, and the originals archived.
- Optional **review gate**: each video pauses for you to approve/edit metadata before upload — or run fully hands-off.
- **Daily schedule**: one long-form video and any number of Shorts at fixed times each day, with queue-empty notifications and restart-safe state.

### Rendering performance
- Hardware encoding: **NVIDIA NVENC**, **AMD AMF**, **Intel QuickSync** with automatic detection and *automatic software fallback* if a GPU encoder fails mid-render.
- H.264, H.265/HEVC and AV1. 1080p, 1440p and 4K output (or match the source). CRF-based quality presets or explicit bitrates.
- Sequential render queue with live progress, ETA, encoder speed and full FFmpeg logs.

### Polish
- Modern dark UI, smooth animations, live template preview, toast + OS notifications, persistent settings, crash-safe queues, rotating file logs, optional update checker.

---

## Getting started

```bash
npm install        # installs deps + bundled FFmpeg binaries
npm run dev        # launch in development
```

Production build & Windows installer:

```bash
npm run dist:win   # → release/BeatFrame Studio-Setup-<version>.exe
```

See **[docs/SETUP.md](docs/SETUP.md)** for the full setup guide, **[docs/YOUTUBE_SETUP.md](docs/YOUTUBE_SETUP.md)** for the one-time YouTube API credential setup (required only for uploading), and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for how the codebase fits together.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Bundle main/preload/renderer to `out/` |
| `npm run typecheck` | Strict TypeScript checks for both processes |
| `npm test` | Unit tests + FFmpeg integration tests (integration auto-skips without FFmpeg) |
| `npm run dist:win` | Build the Windows NSIS installer into `release/` |
| `npm run dist:dir` | Unpacked build for quick smoke-testing |

## Requirements

- Node.js 20+ to build. End users need nothing — FFmpeg is bundled by the installer.
- Windows 10/11 (primary target). macOS and Linux builds are configured but less tested.

## A note on style

The output style is inspired by the general look of community Beat Saber channels — clean title cards, untouched gameplay, branded end screens — but every asset, layout and animation in BeatFrame is original. Customize colors, fonts, logo and wording in **Templates** to make it yours.

## License

MIT — see [LICENSE](LICENSE).
