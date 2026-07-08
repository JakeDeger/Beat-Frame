# YouTube API setup (one-time, ~5 minutes)

BeatFrame uploads through the official **YouTube Data API v3**. Google requires every app that uploads to use OAuth credentials; for a personal tool you create your own free credentials so uploads count against your own (free) quota and no third party ever sees your account.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that owns your channel.
2. Click the project selector → **New project** → name it e.g. `BeatFrame` → **Create**.

## 2. Enable the YouTube Data API

1. **APIs & Services → Library**.
2. Search **YouTube Data API v3** → **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** → **Create**.
3. Fill in the app name (`BeatFrame`) and your email; skip optional fields → **Save**.
4. Under **Test users**, add your own Google account email. (Keeping the app in *Testing* mode is fine for personal use — refresh tokens for test users of a Desktop app do not expire.)

## 4. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name it anything.
3. Copy the **Client ID** and **Client Secret**.

## 5. Connect BeatFrame

1. In BeatFrame: **Settings → YouTube** → paste the Client ID and Client Secret.
2. Click **Connect account** — your browser opens a Google sign-in. Approve the two YouTube permissions.
3. Back in the app you'll see your channel name. Done.

Tokens are stored on your computer encrypted with the operating system's credential store, and are only ever sent to Google.

## Quota notes

- The free daily quota is 10,000 units; one upload costs ~1,600 units → about **6 uploads/day**. The quota resets at midnight Pacific Time.
- Scheduled/daily automation stays well within this.
- Custom thumbnails require a [verified account](https://www.youtube.com/verify).

## Troubleshooting

- **"Access blocked: app not verified"** — add your account under *Test users* (step 3.4) and sign in with that account.
- **"Google did not return a refresh token"** — remove BeatFrame's access at <https://myaccount.google.com/permissions> and connect again.
- **Quota exceeded** — wait for the reset, or request a quota increase in Google Cloud Console.
