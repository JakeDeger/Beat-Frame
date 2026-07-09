# Architecture

BeatFrame Studio is an Electron app with a strict process split: **all** file, network, FFmpeg and YouTube work happens in the main process; the renderer is a pure React UI talking over a typed IPC bridge.

```
src/
├── shared/                 # Types + IPC contract, imported by both sides
│   ├── types.ts            # Single source of truth for the data model
│   ├── ipc.ts              # Channel name constants
│   └── defaults.ts         # Default settings + deep merge (pure, tested)
│
├── main/
│   ├── index.ts            # App bootstrap, window, single-instance lock
│   ├── ipc.ts              # All ipcMain handlers; errors → {ok:false,error}
│   └── services/
│       ├── settings.ts     # Settings persistence (JsonStore + deep merge)
│       ├── store.ts        # Tiny atomic-write JSON store (no deps)
│       ├── logger.ts       # Rotating file logger (<userData>/logs)
│       ├── http.ts         # fetch with timeout + backoff retries
│       ├── events.ts       # broadcast() to windows + notifications
│       ├── beatsaver.ts    # Map lookup, cover download, ID extraction
│       ├── players.ts      # BeatLeader/ScoreSaber URL parsing + lookup
│       ├── metadata.ts     # SEO title/description/tags (pure, tested)
│       ├── automation.ts   # Watch folder → pipeline → daily scheduler
│       ├── updates.ts      # GitHub releases update check
│       ├── ffmpeg/
│       │   ├── paths.ts    # Binary resolution: settings → bundled → PATH
│       │   ├── probe.ts    # ffprobe wrapper with friendly errors
│       │   ├── encoders.ts # -encoders detection + encoder selection
│       │   ├── progress.ts # -progress pipe:1 parser (pure, tested)
│       │   └── run.ts      # Spawn wrapper, cancel, HW-failure detection
│       ├── render/
│       │   ├── plan.ts     # ★ Pure ffmpeg arg/filtergraph builder (tested
│       │   │               #   against real ffmpeg in integration tests)
│       │   ├── cardsHtml.ts# Intro/outro/thumbnail HTML (pure, escaped)
│       │   ├── capture.ts  # Offscreen BrowserWindow → PNG/JPEG capture
│       │   └── renderQueue.ts # Sequential queue, progress, fallback, persist
│       └── youtube/
│           ├── auth.ts     # OAuth 2.0 + PKCE loopback; safeStorage tokens
│           ├── api.ts      # REST client: resumable upload, playlists, thumbs
│           └── uploadQueue.ts # Upload queue, retries, history
│
├── preload/                # contextBridge: typed window.api surface
└── renderer/src/           # React UI (zustand store, pages, components)
```

## The render pipeline

1. **Probe** the source with ffprobe (duration, geometry, fps, audio).
2. **Fetch** BeatSaver map metadata + cover, and optionally the player profile.
3. **Compose title cards**: the intro/outro/thumbnail are HTML/CSS documents rendered in an offscreen `BrowserWindow` at the exact output resolution and captured as PNGs (with alpha). This gives designer-grade typography/gradients/blur without a compositing engine.
4. **Build the plan** (`render/plan.ts`, pure): one FFmpeg invocation whose filtergraph does trim → scale → blurred backdrop overlays → intro overlay (alpha fade + slide/zoom) → outro overlay (PTS-shifted to the tail) → fade to black, plus loudness normalization and audio fades. The gameplay stream is never cut, retimed or effected — by design and by unit test.
   - *Blurred backdrops*: two extra seeked reads of the same source file (random offsets picked once per job by `pickBackdropOffsets`) are downscaled to quarter resolution, gaussian-blurred and upscaled — a cheap full-frame blur — then composited under the cards: the intro backdrop fades out as the real gameplay is revealed, the outro backdrop fades in under the end screen (which turns translucent when a backdrop is present).
5. **Encode** via the selected encoder (`h264_nvenc` / `hevc_amf` / `av1_qsv` / `libx264` …). If a hardware encoder fails at runtime (missing driver, no GPU), the queue detects it from the log tail and transparently re-runs the plan with the software equivalent.
6. **Thumbnail** (long-form): 1280×720 JPEG from the same card renderer.

Everything is a single encode pass — no intermediate files, no double transcoding — which is why renders finish at several × realtime on GPU encoders.

## The automation pipeline

`automation.ts` is a small state machine per detected file:

```
detected → (needs_map_id) → queued → rendering → awaiting_review?
        → ready_to_upload → uploading → uploaded → archived
```

- chokidar watches the input folder (`ignoreInitial:false` so files dropped while the app was closed are picked up; a name+size fingerprint prevents reprocessing).
- Map IDs are auto-extracted from filenames (`[25f]`, `!bsr 25f`, BeatSaver URLs).
- Renders/uploads flow through the same queues the manual UI uses.
- The daily scheduler ticks every 30 s; per-day slot keys are persisted, so restarts never double-fire or skip slots.

## IPC contract

Every handler returns `{ok:true,value}|{ok:false,error}`; the preload bridge rethrows errors so the renderer gets clean, human-readable messages. Push updates (`event:*` channels) drive the UI: render progress (throttled to ~2 Hz), upload progress, automation changes, toasts, auth changes.

## Design decisions

- **Electron over Tauri** — Node-side FFmpeg orchestration, offscreen HTML card capture, googleless OAuth loopback and chokidar all live comfortably in the main process; Rust sidecars would add friction without user-visible gain.
- **No heavyweight deps** — settings store, logger and the YouTube REST client are small hand-rolled modules (~100 lines each) instead of `electron-store`/`googleapis`, keeping the install slim and immune to upstream ESM churn.
- **Pure core** — everything that matters (plan builder, metadata generator, parsers, progress parsing) is a pure function, unit-tested; Electron-facing modules are thin shells. Integration tests execute the real generated FFmpeg commands when FFmpeg is available.
