import type { TemplateConfig } from '@shared/types'

/**
 * HTML generators for intro/outro cards and thumbnails. These are rendered in
 * an offscreen BrowserWindow at the exact output resolution and captured to
 * PNG, then composited by ffmpeg. All sizing uses viewport units so the same
 * markup produces crisp cards at 1080p and 4K.
 *
 * All dynamic strings pass through escapeHtml — song titles regularly contain
 * angle brackets, quotes and emoji.
 */

export interface CardData {
  songTitle: string
  songArtist: string
  mapper: string
  difficulty: string | null
  playerName: string
  /** data: URI or empty */
  coverDataUri: string
  /** data: URI or empty */
  avatarDataUri: string
  /** data: URI or empty */
  logoDataUri: string
  template: TemplateConfig
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function baseCss(t: TemplateConfig, transparentBg: boolean): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100vw; height: 100vh; overflow: hidden;
    background: ${transparentBg ? 'transparent' : t.backgroundColor};
    font-family: ${t.fontFamily};
    color: #f4f6fb;
    -webkit-font-smoothing: antialiased;
  }
  .accent-text {
    background: linear-gradient(90deg, ${t.accentColor}, ${t.accentColorB});
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }`
}

function chip(content: string): string {
  return `<span style="display:inline-flex;align-items:center;gap:0.5em;padding:0.38em 0.95em;border-radius:99em;background:rgba(255,255,255,0.09);border:0.08em solid rgba(255,255,255,0.14);backdrop-filter:blur(4px);">${content}</span>`
}

// ---------------------------------------------------------------------------
// Long-form intro card (transparent overlay, 16:9)
// ---------------------------------------------------------------------------

export function introCardHtml(d: CardData): string {
  const t = d.template
  const cover = d.coverDataUri
    ? `<img src="${d.coverDataUri}" alt="" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${t.accentColor},${t.accentColorB});"></div>`
  const difficulty = t.showDifficulty && d.difficulty ? chip(escapeHtml(d.difficulty)) : ''
  const player = d.playerName
    ? chip(
        `${d.avatarDataUri ? `<img src="${d.avatarDataUri}" style="width:1.5em;height:1.5em;border-radius:50%;object-fit:cover;">` : ''}<span>${escapeHtml(d.playerName)}</span>`
      )
    : ''
  const brand = t.channelName
    ? `<div style="position:absolute;bottom:4.5vh;left:0;right:0;text-align:center;font-size:1.9vh;letter-spacing:0.35em;text-transform:uppercase;color:rgba(255,255,255,0.55);">${escapeHtml(t.channelName)}</div>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t, true)}</style></head>
<body>
  <div style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;
              background:linear-gradient(180deg, rgba(5,7,12,0.82) 0%, rgba(5,7,12,0.62) 55%, rgba(5,7,12,0.82) 100%);position:relative;">
    <div style="display:flex;align-items:center;gap:5vh;max-width:82vw;padding:6vh 7vh;border-radius:3.2vh;
                background:rgba(10,13,22,0.58);border:0.22vh solid rgba(255,255,255,0.10);
                box-shadow:0 4vh 12vh rgba(0,0,0,0.55);backdrop-filter:blur(14px);">
      <div style="width:34vh;height:34vh;flex:none;border-radius:2.4vh;overflow:hidden;
                  box-shadow:0 2.5vh 7vh rgba(0,0,0,0.6);border:0.22vh solid rgba(255,255,255,0.12);">${cover}</div>
      <div style="min-width:0;">
        <div style="font-size:2.1vh;font-weight:700;letter-spacing:0.4em;text-transform:uppercase;" class="accent-text">Now Playing</div>
        <div style="font-size:7vh;font-weight:800;line-height:1.08;margin-top:1.6vh;max-width:52vw;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHtml(d.songTitle)}</div>
        <div style="font-size:3.4vh;font-weight:500;color:rgba(255,255,255,0.82);margin-top:1.4vh;">${escapeHtml(d.songArtist)}</div>
        <div style="font-size:2.4vh;color:rgba(255,255,255,0.6);margin-top:2.6vh;">Mapped by <b style="color:rgba(255,255,255,0.85);">${escapeHtml(d.mapper)}</b></div>
        <div style="display:flex;gap:1.6vh;margin-top:3vh;font-size:2.5vh;font-weight:600;">${player}${difficulty}</div>
      </div>
    </div>
    <div style="position:absolute;left:0;right:0;top:0;height:0.8vh;background:linear-gradient(90deg,${t.accentColor},${t.accentColorB});"></div>
    ${brand}
  </div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Shorts intro card (transparent overlay, 9:16) — info at the top third
// ---------------------------------------------------------------------------

export function shortIntroCardHtml(d: CardData): string {
  const t = d.template
  const cover = d.coverDataUri
    ? `<img src="${d.coverDataUri}" alt="" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${t.accentColor},${t.accentColorB});"></div>`
  const player = d.playerName
    ? `<div style="display:flex;align-items:center;justify-content:center;gap:0.6em;font-size:2vh;font-weight:600;margin-top:1.4vh;color:rgba(255,255,255,0.85);">
         ${d.avatarDataUri ? `<img src="${d.avatarDataUri}" style="width:1.6em;height:1.6em;border-radius:50%;object-fit:cover;">` : ''}${escapeHtml(d.playerName)}</div>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t, true)}</style></head>
<body>
  <div style="width:100vw;height:100vh;position:relative;">
    <div style="position:absolute;top:6vh;left:5vw;right:5vw;padding:2.6vh 3vh;border-radius:2.6vh;text-align:center;
                background:rgba(10,13,22,0.72);border:0.18vh solid rgba(255,255,255,0.12);
                box-shadow:0 2vh 6vh rgba(0,0,0,0.55);backdrop-filter:blur(12px);">
      <div style="width:11vh;height:11vh;margin:0 auto;border-radius:2vh;overflow:hidden;border:0.18vh solid rgba(255,255,255,0.15);box-shadow:0 1.4vh 4vh rgba(0,0,0,0.5);">${cover}</div>
      <div style="font-size:3.1vh;font-weight:800;line-height:1.15;margin-top:1.8vh;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHtml(d.songTitle)}</div>
      <div style="font-size:2.1vh;color:rgba(255,255,255,0.75);margin-top:0.8vh;">${escapeHtml(d.songArtist)}</div>
      ${player}
      <div style="height:0.5vh;width:34%;margin:2vh auto 0;border-radius:99em;background:linear-gradient(90deg,${t.accentColor},${t.accentColorB});"></div>
    </div>
  </div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Long-form outro end screen (opaque)
// ---------------------------------------------------------------------------

export function outroCardHtml(d: CardData): string {
  const t = d.template
  const logo = d.logoDataUri
    ? `<img src="${d.logoDataUri}" style="height:7vh;object-fit:contain;">`
    : t.channelName
      ? `<div style="font-size:3.4vh;font-weight:800;letter-spacing:0.12em;">${escapeHtml(t.channelName)}</div>`
      : ''
  const placeholder = (label: string): string => `
    <div style="width:38vw;aspect-ratio:16/9;border-radius:1.8vh;border:0.3vh dashed rgba(255,255,255,0.28);
                background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;
                font-size:2.3vh;font-weight:600;color:rgba(255,255,255,0.55);">${label}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t, false)}</style></head>
<body>
  <div style="width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4vh;position:relative;
              background:radial-gradient(120vh 90vh at 50% -20%, ${hexWithAlpha(t.accentColor, 0.18)}, transparent 60%), ${t.backgroundColor};">
    <div style="text-align:center;">
      <div style="font-size:6.4vh;font-weight:800;">${escapeHtml(t.outroHeadline)}</div>
      <div style="font-size:2.7vh;color:rgba(255,255,255,0.7);margin-top:1.2vh;">${escapeHtml(t.outroSubline)}</div>
    </div>
    <div style="display:flex;gap:3vw;align-items:center;">
      ${placeholder('Recommended video')}
      ${placeholder('Recommended video')}
    </div>
    <div style="display:flex;align-items:center;gap:2.5vh;">
      <div style="width:9vh;height:9vh;border-radius:50%;border:0.3vh dashed rgba(255,255,255,0.28);background:rgba(255,255,255,0.05);
                  display:flex;align-items:center;justify-content:center;font-size:1.7vh;font-weight:700;color:rgba(255,255,255,0.55);text-align:center;">SUB</div>
      <div style="font-size:2.5vh;font-weight:600;color:rgba(255,255,255,0.85);">Subscribe for more</div>
    </div>
    <div style="position:absolute;bottom:5vh;display:flex;align-items:center;gap:2vh;">${logo}</div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:0.8vh;background:linear-gradient(90deg,${t.accentColor},${t.accentColorB});"></div>
  </div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Thumbnail (opaque, 1280x720)
// ---------------------------------------------------------------------------

export function thumbnailHtml(d: CardData): string {
  const t = d.template
  const bg = d.coverDataUri
    ? `<img src="${d.coverDataUri}" style="position:absolute;inset:-5%;width:110%;height:110%;object-fit:cover;filter:blur(28px) brightness(0.45) saturate(1.3);">`
    : ''
  const cover = d.coverDataUri
    ? `<img src="${d.coverDataUri}" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="width:100%;height:100%;background:linear-gradient(135deg,${t.accentColor},${t.accentColorB});"></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(t, false)}</style></head>
<body>
  <div style="width:100vw;height:100vh;position:relative;overflow:hidden;background:${t.backgroundColor};">
    ${bg}
    <div style="position:absolute;inset:0;display:flex;align-items:center;gap:6vh;padding:0 7vh;">
      <div style="width:52vh;height:52vh;flex:none;border-radius:3vh;overflow:hidden;border:0.5vh solid rgba(255,255,255,0.85);box-shadow:0 3vh 9vh rgba(0,0,0,0.6);">${cover}</div>
      <div style="min-width:0;">
        <div style="font-size:9.2vh;font-weight:900;line-height:1.02;text-shadow:0 0.8vh 3vh rgba(0,0,0,0.8);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">${escapeHtml(d.songTitle)}</div>
        <div style="display:inline-block;margin-top:2.6vh;padding:1vh 2.6vh;border-radius:99em;font-size:3.4vh;font-weight:800;
                    background:linear-gradient(90deg,${t.accentColor},${t.accentColorB});color:#fff;box-shadow:0 1.5vh 4vh rgba(0,0,0,0.5);">
          ${escapeHtml(d.difficulty ?? 'Beat Saber')}</div>
        ${d.playerName ? `<div style="font-size:3.6vh;font-weight:700;margin-top:2.4vh;color:rgba(255,255,255,0.92);text-shadow:0 0.5vh 2vh rgba(0,0,0,0.8);">${escapeHtml(d.playerName)}</div>` : ''}
      </div>
    </div>
  </div>
</body></html>`
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return `rgba(255,45,120,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}
