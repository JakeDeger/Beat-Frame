import { app, safeStorage, shell } from 'electron'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { randomBytes, createHash } from 'crypto'
import { createLogger } from '../logger'
import { getSettings } from '../settings'
import { broadcast } from '../events'
import { EVENTS } from '@shared/ipc'

const log = createLogger('yt-auth')

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube']

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

interface StoredTokens {
  refreshToken: string
  accessToken: string
  /** epoch ms */
  accessTokenExpiresAt: number
}

let cached: StoredTokens | null = null

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'youtube-tokens.bin')
}

function saveTokens(tokens: StoredTokens): void {
  cached = tokens
  const json = JSON.stringify(tokens)
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf-8') // dev fallback; production desktops have DPAPI/keychain
  fs.writeFileSync(tokenFile(), data)
}

function loadTokens(): StoredTokens | null {
  if (cached) return cached
  try {
    const data = fs.readFileSync(tokenFile())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf-8')
    cached = JSON.parse(json) as StoredTokens
    return cached
  } catch {
    return null
  }
}

export function isSignedIn(): boolean {
  return loadTokens() !== null
}

export function signOut(): void {
  cached = null
  fs.rmSync(tokenFile(), { force: true })
  broadcast(EVENTS.AUTH_CHANGED)
}

function requireClientCredentials(): { clientId: string; clientSecret: string } {
  const { youtubeClientId, youtubeClientSecret } = getSettings()
  if (!youtubeClientId || !youtubeClientSecret) {
    throw new AuthError(
      'YouTube API credentials are not configured. Add your OAuth Client ID and Secret in Settings → YouTube (see docs/YOUTUBE_SETUP.md).'
    )
  }
  return { clientId: youtubeClientId, clientSecret: youtubeClientSecret }
}

/**
 * OAuth 2.0 authorization-code flow with PKCE over a loopback redirect:
 * opens the user's browser, catches the redirect on 127.0.0.1, exchanges the
 * code for tokens and stores them encrypted with safeStorage.
 */
export async function startSignIn(): Promise<void> {
  const { clientId, clientSecret } = requireClientCredentials()

  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const err = url.searchParams.get('error')
        const returnedState = url.searchParams.get('state')
        const codeParam = url.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          `<html><body style="font-family:system-ui;background:#0b0e17;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;">
             <div style="text-align:center"><h2>${err ? 'Sign-in failed' : 'Signed in!'}</h2><p>You can close this tab and return to BeatFrame Studio.</p></div>
           </body></html>`
        )
        if (err) reject(new AuthError(`Google sign-in was denied: ${err}`))
        else if (returnedState !== state) reject(new AuthError('OAuth state mismatch — please try signing in again.'))
        else if (codeParam) resolve(codeParam)
        else reject(new AuthError('No authorization code received.'))
        setImmediate(() => server.close())
      } catch (e) {
        reject(e)
      }
    })
    server.on('error', (e) => reject(new AuthError(`Could not start the sign-in listener: ${e.message}`)))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new AuthError('Could not determine the callback port.'))
        return
      }
      const redirectUri = `http://127.0.0.1:${address.port}/callback`
      const authUrl = new URL(AUTH_ENDPOINT)
      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', SCOPES.join(' '))
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      // Stash the redirect URI for the token exchange below.
      ;(server as http.Server & { _redirectUri?: string })._redirectUri = redirectUri
      pendingRedirectUri = redirectUri
      void shell.openExternal(authUrl.toString())
    })
    // Give up after 5 minutes.
    setTimeout(() => {
      server.close()
      reject(new AuthError('Sign-in timed out after 5 minutes.'))
    }, 5 * 60 * 1000).unref()
  })

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: pendingRedirectUri
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    throw new AuthError(`Token exchange failed (${res.status}): ${await res.text()}`)
  }
  const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
  if (!tokens.refresh_token) {
    throw new AuthError('Google did not return a refresh token. Remove the app from your Google account permissions and sign in again.')
  }
  saveTokens({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000
  })
  log.info('signed in to YouTube')
  broadcast(EVENTS.AUTH_CHANGED)
}

let pendingRedirectUri = ''

/** Get a valid access token, refreshing when close to expiry. */
export async function getAccessToken(): Promise<string> {
  const tokens = loadTokens()
  if (!tokens) throw new AuthError('Not signed in to YouTube. Connect your account in Settings → YouTube.')
  if (Date.now() < tokens.accessTokenExpiresAt) return tokens.accessToken

  const { clientId, clientSecret } = requireClientCredentials()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token'
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      signOut()
      throw new AuthError('Your YouTube session expired. Please sign in again in Settings → YouTube.')
    }
    throw new AuthError(`Token refresh failed (${res.status})`)
  }
  const refreshed = (await res.json()) as { access_token: string; expires_in: number }
  saveTokens({
    ...tokens,
    accessToken: refreshed.access_token,
    accessTokenExpiresAt: Date.now() + (refreshed.expires_in - 60) * 1000
  })
  return refreshed.access_token
}
