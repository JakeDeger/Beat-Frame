import { describe, expect, it } from 'vitest'
import {
  introCardHtml,
  outroCardHtml,
  shortIntroCardHtml,
  type CardData
} from '../src/main/services/render/cardsHtml'
import { makeTemplate } from './helpers'

const AVATAR = 'data:image/png;base64,QVZBVEFS'
const COVER = 'data:image/jpeg;base64,Q09WRVI='

function data(overrides: Partial<CardData> = {}): CardData {
  return {
    songTitle: 'Beat It <b>&amp;</b>',
    songArtist: 'Michael Jackson',
    mapper: 'GreatYazer',
    difficulty: 'Expert+',
    playerName: 'Jake "J" D',
    coverDataUri: COVER,
    avatarDataUri: AVATAR,
    logoDataUri: '',
    accuracy: null,
    hasVideoBackdrop: true,
    template: makeTemplate({ channelName: 'MyChannel', introLayout: 'split' }),
    ...overrides
  }
}

describe('split-screen intro card', () => {
  it('shows cover art and the player avatar side by side', () => {
    const html = introCardHtml(data())
    expect(html).toContain(COVER)
    expect(html).toContain(AVATAR)
    expect(html).toContain('width:50vw') // split halves
    expect(html).toContain('Now Playing')
    expect(html).toContain('GreatYazer')
    expect(html).toContain('Expert+')
  })

  it('escapes titles and player names', () => {
    const html = introCardHtml(data())
    expect(html).toContain('Beat It &lt;b&gt;&amp;amp;&lt;/b&gt;')
    expect(html).toContain('Jake &quot;J&quot; D')
    expect(html).not.toContain('<b>&amp;</b>')
  })

  it('falls back to a monogram disc when the avatar is missing', () => {
    const html = introCardHtml(data({ avatarDataUri: '', playerName: 'zed' }))
    expect(html).not.toContain(AVATAR)
    expect(html).toContain('>Z</div>') // monogram initial
  })

  it('uses the classic panel when layout is panel', () => {
    const html = introCardHtml(data({ template: makeTemplate({ introLayout: 'panel' }) }))
    expect(html).not.toContain('width:50vw')
    expect(html).toContain('Now Playing')
  })

  it('shows the accuracy chip in both layouts when a score exists', () => {
    expect(introCardHtml(data({ accuracy: '97.42%' }))).toContain('97.42%')
    expect(introCardHtml(data({ accuracy: '97.42%', template: makeTemplate({ introLayout: 'panel' }) }))).toContain('97.42%')
    expect(introCardHtml(data({ accuracy: null }))).not.toContain('🎯')
  })
})

describe('shorts intro card', () => {
  it('shows cover + avatar pair in split layout', () => {
    const html = shortIntroCardHtml(data())
    expect(html).toContain(COVER)
    expect(html).toContain(AVATAR)
  })

  it('keeps the classic single-cover layout when selected', () => {
    const html = shortIntroCardHtml(data({ template: makeTemplate({ introLayout: 'panel' }) }))
    expect(html).toContain(COVER)
  })
})

describe('outro end screen', () => {
  it('is translucent over a video backdrop and opaque without one', () => {
    const withBackdrop = outroCardHtml(data({ hasVideoBackdrop: true }))
    const solid = outroCardHtml(data({ hasVideoBackdrop: false, template: makeTemplate() }))
    expect(withBackdrop).toContain('background: transparent')
    expect(withBackdrop).toContain('rgba(11,14,23,0.78)') // #0b0e17 at 78%
    expect(solid).not.toContain('rgba(11,14,23,0.78)')
  })

  it('keeps headline, placeholders and branding', () => {
    const html = outroCardHtml(data())
    expect(html).toContain('Thanks for watching!')
    expect(html).toContain('Recommended video')
    expect(html).toContain('Subscribe for more')
    expect(html).toContain('MyChannel')
  })
})
