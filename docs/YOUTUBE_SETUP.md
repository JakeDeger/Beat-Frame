# YouTube API setup (one-time, ~5 minutes)

BeatFrame uploads through the official **YouTube Data API v3**. Google requires every app that uploads to use OAuth credentials; for a personal tool you create your own free credentials so uploads count against your own (free) quota and no third party ever sees your account.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that owns your channel.
2. Click the project selector → **New project** → name it e.g. `BeatFrame` → **Create**.

## 2. Enable the YouTube Data API

1. **APIs & Services → Library**.
2. Search **YouTube Data API v3** → **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen** (newer console: **Google Auth Platform → Audience**).
2. User type: **External** → **Create**.
3. Fill in the app name (`BeatFrame`) and your email; skip optional fields → **Save**.
4. Under **Test users**, click **+ Add users** and add the exact Google account email you'll sign in with. Skipping this causes **"Access blocked: BeatFrame has not completed the Google verification process" (Error 403: access_denied)** at sign-in.
5. **Recommended for automation:** set **Publishing status → In production** ("Publish app" button). In *Testing* mode Google expires the sign-in after ~7 days, which breaks unattended daily publishing. Publishing without completing verification is fine for a personal tool — sign-in shows a one-time "Google hasn't verified this app" warning that you bypass with **Advanced → Go to BeatFrame (unsafe)**, and after that the connection doesn't expire.

## 4. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name it anything.
3. Copy the **Client ID** and **Client Secret**.

## 5. Connect BeatFrame

1. In BeatFrame: **Settings → YouTube** → paste the Client ID and Client Secret.
2. Click **Connect account** — your browser opens a Google sign-in. Approve the two YouTube permissions.
3. Back in the app you'll see your channel name. Done.

Tokens are stored on your computer encrypted with the operating system's credential store, and are only ever sent to Google.

## Upgrading from v1.4 or earlier

v1.5 adds the read-only **YouTube Analytics** permission for the Channel insights page. Existing connections keep uploading fine, but insights will ask you to reconnect once: **Settings → YouTube → Disconnect → Connect account**.

## Quota notes

- The free daily quota is 10,000 units; one upload costs ~1,600 units → about **6 uploads/day**. The quota resets at midnight Pacific Time.
- Scheduled/daily automation stays well within this.
- Custom thumbnails require a [verified account](https://www.youtube.com/verify).

## Troubleshooting

- **"Access blocked: BeatFrame has not completed the Google verification process" (403: access_denied)** — the signing-in account isn't on the *Test users* list. Add it (step 3.4), or publish the app (step 3.5), then retry — no waiting period.
- **Sign-in expires every ~7 days** — the app is still in *Testing* mode; publish it (step 3.5).
- **"Google did not return a refresh token"** — remove BeatFrame's access at <https://myaccount.google.com/permissions> and connect again.
- **Quota exceeded** — wait for the reset, or request a quota increase in Google Cloud Console.
