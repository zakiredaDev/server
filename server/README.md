# Kotlen Node.js upload server

This server receives one image or video per request at `POST /api/upload` and stores it in a **private** Supabase Storage bucket. It matches the Android app's multipart upload (`file` field), requires a bearer token, and uses device/media identifiers to overwrite the same stored object on later backups instead of creating another cloud copy.

## Configure Supabase

1. Create a private Storage bucket (default name: `kotlen-backups`). Do not make it public.
2. In Supabase, create a server-side Secret API key. Keep it only in the hosting provider's environment variables; never put it in Android or source control.
3. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET`, and `UPLOAD_API_KEY` in the Node host. Generate `UPLOAD_API_KEY` with a random value, for example `openssl rand -hex 32`. `SUPABASE_TUS_ENDPOINT` is optional; the server derives Supabase's direct Storage hostname from `SUPABASE_URL` by default.
4. Set the same `UPLOAD_API_KEY` as the local Gradle property `kotlenUploadApiKey`, and set `kotlenBackupUrl` to the deployed HTTPS URL ending in `/api/upload`. Rebuild the Android app.
5. Set `MAX_FILE_MB` to 50 or lower. The server enforces a 50 MB maximum even if the environment value is higher. The Supabase bucket limit should be at least as large. The temporary directory on the host must have enough free disk space for one file of that size.

Copy `.env.example` to `.env` for local development, then put the real values in `server/.env`. Do not place credentials in `.env.example` or commit `.env`.

## Store device information in MongoDB

The Android app sends basic device diagnostics once when it opens: manufacturer, model, Android version and security patch, supported CPU architectures and core count, total/available RAM, battery percentage/charging state, and app version. It sends no photos, contacts, location, or account data through this route. The server identifies the app installation with its existing random device ID and updates one MongoDB document per device on each launch.

1. Create a MongoDB Atlas cluster and database user with read/write access to the `studyhub` database. Add the hosting provider's outbound IP to the Atlas network access list.
2. Set `MONGODB_URI` on the Node host to the Atlas connection string. Set `MONGODB_DB_NAME` to the database you created and `MONGODB_COLLECTION=users` (the default collection name).
3. Deploy the updated Node server. The `/api/device-info` endpoint uses the existing `UPLOAD_API_KEY`; no MongoDB credential is put in the APK. The route returns an error if MongoDB is not configured, while photo/video uploads continue to work.

The stored document in the `users` collection is keyed by the app's random `deviceId`; each new launch updates `lastSeenAt` and the latest device values rather than inserting a new history record. The app does not have account login, so this creates or updates a device record, not an authenticated person profile.

## Run

Requires Node.js 22 or later.

```sh
npm install
npm start
```

`GET /health` returns a basic health response. The upload route accepts `multipart/form-data` with one part named `file`, `Authorization: Bearer <UPLOAD_API_KEY>`, and `X-Device-ID` / `X-Media-ID` headers supplied by the Android app. It returns the private bucket name and object path; it does not return a public media URL.

The server writes the incoming multipart file to the host's temporary directory, then sends it to Supabase Storage with resumable TUS chunks and retries. It deletes the temporary copy in a `finally` block. Supabase's secret key remains on the Node server. Supabase recommends resumable uploads for files larger than 6 MB or unreliable networks, and its current TUS setup uses 6 MB chunks.

## Android app key note

The shared upload token is compiled into the first-party Android app so it can authenticate to this server. Treat it as a basic access gate, not an unextractable secret: a distributed APK can be inspected. For public distribution, add per-user authentication and authorization before accepting uploads.
