# Setup guide

## For users (installer)

1. Download and run `BeatFrame Studio-Setup-<version>.exe`.
2. Launch BeatFrame Studio. FFmpeg is bundled — nothing else to install.
3. On the **Home** page:
   - Choose your gameplay recording (`.mp4`, `.mkv`, `.mov`, `.avi`, `.webm`).
   - The BeatSaver map ID is auto-detected from filenames like `Song [25f].mp4`; otherwise type it (the short code from `beatsaver.com/maps/…`).
   - Optionally paste your BeatLeader or ScoreSaber profile URL — your name and avatar appear on the intro card.
   - Pick **Long-form video** or **YouTube Short** and press **Render**.
4. Watch progress in **Render Queue**; finished files land in your output folder.

### Uploading to YouTube (optional)
Uploading requires free personal API credentials — a one-time 5-minute setup. Follow [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md), then connect your account in **Settings → YouTube**.

### Full automation
1. Open **Automation**.
2. Pick an **input folder** (where your recorder saves files) and an **archive folder**.
3. Enable **folder automation**. Include the map ID in your recording filenames (`[25f]`) for zero-touch operation; otherwise BeatFrame asks for the ID per file.
4. Optional: enable **auto-upload**, choose visibility, keep or disable the **metadata review** gate.
5. Optional: enable the **daily schedule** to publish at fixed times (e.g. long-form at 18:00, a Short at 12:00). Videos wait in the queue until their slot; state survives restarts.

## For developers

```bash
git clone https://github.com/JakeDeger/Beat-Editor
cd Beat-Editor
npm install
npm run dev
```

- `npm install` downloads the platform's FFmpeg/FFprobe binaries (`ffmpeg-static` / `ffprobe-static`, declared as optional dependencies). If that download is blocked in your environment, the app falls back to `ffmpeg` on PATH, or set explicit binary paths in **Settings → Advanced**.
- `npm run typecheck && npm test` before committing. The FFmpeg integration tests run only when `ffmpeg` is on PATH.
- `npm run dist:win` produces the NSIS installer in `release/`. Building the Windows installer on non-Windows hosts requires Wine; building on Windows needs nothing extra.
- To brand the installer, drop `build/icon.ico` (256×256) into the repo.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "FFmpeg binary not found" | Install FFmpeg (`winget install ffmpeg`) or set the path in Settings → Advanced. |
| GPU encoder fails | BeatFrame automatically retries with software encoding. Update GPU drivers to restore NVENC/AMF/QSV. |
| "Map not found on BeatSaver" | Verify the ID at `beatsaver.com/maps/<id>`. IDs are short hex codes like `25f`. |
| Upload fails with quota error | The default YouTube API quota allows ~6 uploads/day. It resets at midnight Pacific Time. |
| Custom thumbnail not applied | YouTube requires a verified account for custom thumbnails (Settings → Channel → Feature eligibility). |
| Sign-in loop / token errors | Settings → YouTube → Disconnect, then connect again. |
| Logs | Settings → Advanced → **Open log folder** (`beatframe.log`). |
