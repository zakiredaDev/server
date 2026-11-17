# Kotlen upload server - deployment

Upload the files in this folder directly into the root of the Git repository used by the hosting provider. The files must be side by side: `server.js`, `package.json`, `.env.example`, and `.gitignore`.

Use these hosting commands:

- Build: `npm install`
- Start: `node server.js`

Set these environment variables in the hosting dashboard (do not commit real keys):

- `SUPABASE_URL`: your Supabase project URL, such as `https://PROJECT_REF.supabase.co`
- `SUPABASE_SECRET_KEY`: a server-side Supabase Secret API key; keep it on the server only
- `SUPABASE_BUCKET`: the name of a private Storage bucket you created
- `UPLOAD_API_KEY`: a random value of at least 32 bytes; use the same value as Android's `kotlenUploadApiKey`
- `MAX_FILE_MB`: maximum accepted media size in MB; the server caps it at 50 MB
- `PORT`: usually supplied automatically by the host; otherwise the server defaults to 3000
- `SUPABASE_TUS_ENDPOINT`: optional; leave it unset for standard Supabase projects, and the server derives it from `SUPABASE_URL`

The upload endpoint is `https://YOUR_HOST/api/upload`. Health check: `https://YOUR_HOST/health`.

Create the Storage bucket as private. The server accepts one image or video per request in multipart field `file`, then uploads it to Supabase Storage using resumable TUS chunks.
