# StudyHub Node server deployment

Upload every file in this folder to the root of the Node service's repository. Keep `server.js`, `package.json`, `.env.example`, and `.gitignore` together.

Use the hosting commands:

- Build: `npm install`
- Start: `node server.js`

Configure these variables in the hosting dashboard; do not put real credentials in the repository:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_BUCKET` (private bucket)
- `UPLOAD_API_KEY` (same value compiled into the APK)
- `MAX_FILE_MB=50`
- `MONGODB_URI` (Atlas connection string)
- `MONGODB_DB_NAME` (your database name)
- `MONGODB_COLLECTION=users`
- `PORT` if the host does not provide it

`SUPABASE_TUS_ENDPOINT` is optional; the server derives it from `SUPABASE_URL` when unset.

`POST /api/upload` stores media with a safe ASCII object name based on device/media IDs and the MIME type, avoiding problems with non-English original filenames. `POST /api/device-info` updates a device record in the MongoDB `users` collection. On app launch it records device model, Android version, CPU, RAM, local storage, battery, media/ring/notification volume, screen brightness, the observed public IP, and last-seen time. The record is keyed by the app's random `deviceId`; there is no person/account login in the app.

The phone must install the updated APK, and this server package must be deployed, before new diagnostics appear. Volume and brightness are sampled on app open, not streamed live. If MongoDB is unavailable, device-info saving returns an error while media uploads remain enabled.

Health check: `GET /health`.
