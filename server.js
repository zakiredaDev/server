import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import * as tus from "tus-js-client";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_TUS_ENDPOINT = process.env.SUPABASE_TUS_ENDPOINT;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "kotlen-backups";
const UPLOAD_API_KEY = process.env.UPLOAD_API_KEY ?? "";
const MAX_FILE_MB = Math.min(Number.parseInt(process.env.MAX_FILE_MB ?? "50", 10), 50);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const SUPABASE_AUTH_HEADERS = SUPABASE_SECRET_KEY?.startsWith("sb_secret_")
  ? { apikey: SUPABASE_SECRET_KEY }
  : {
      apikey: SUPABASE_SECRET_KEY,
      authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    };

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured.");
}
if (new URL(SUPABASE_URL).protocol !== "https:" && process.env.NODE_ENV !== "development") {
  throw new Error("SUPABASE_URL must use HTTPS outside development.");
}
if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (!Number.isSafeInteger(MAX_FILE_MB) || MAX_FILE_MB < 1) {
  throw new Error("MAX_FILE_MB must be a positive whole number.");
}
if (Buffer.byteLength(UPLOAD_API_KEY, "utf8") < 32) {
  throw new Error("UPLOAD_API_KEY must be a random secret with at least 32 bytes.");
}
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const TUS_ENDPOINT = SUPABASE_TUS_ENDPOINT ||
  `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
if (new URL(TUS_ENDPOINT).protocol !== "https:" && process.env.NODE_ENV !== "development") {
  throw new Error("SUPABASE_TUS_ENDPOINT must use HTTPS outside development.");
}

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

const tempStorage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, _file, callback) => callback(null, `kotlen-${crypto.randomUUID()}.upload`),
});

const receiveMedia = multer({
  storage: tempStorage,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (/^(image|video)\//i.test(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("Only image and video files are accepted."));
  },
});

function requireUploadKey(req, res, next) {
  const authorization = req.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  const supplied = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(UPLOAD_API_KEY, "utf8");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    res.status(401).json({ error: "Invalid bearer token." });
    return;
  }
  next();
}

function safeFilename(input) {
  const basename = path.basename(input || "media").normalize("NFKC");
  const cleaned = basename
    .replace(/[^\p{L}\p{N}._()-]+/gu, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "media";
}

function uploadToSupabaseTus({ localPath, objectPath, size, contentType }) {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(createReadStream(localPath), {
      endpoint: TUS_ENDPOINT,
      uploadSize: size,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        ...SUPABASE_AUTH_HEADERS,
        "x-upsert": "true",
      },
      metadata: {
        bucketName: SUPABASE_BUCKET,
        objectName: objectPath,
        contentType,
        cacheControl: "0",
      },
      onError: reject,
      onSuccess: resolve,
    });
    upload.start();
  });
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/upload", requireUploadKey, receiveMedia.single("file"), async (req, res, next) => {
  const localPath = req.file?.path;
  if (!req.file || !localPath) {
    res.status(400).json({ error: "Send exactly one image or video in multipart field 'file'." });
    return;
  }

  try {
    const deviceId = req.get("x-device-id") ?? "";
    const mediaId = req.get("x-media-id") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
      res.status(400).json({ error: "Missing or invalid X-Device-ID." });
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(mediaId)) {
      res.status(400).json({ error: "Missing or invalid X-Media-ID." });
      return;
    }

    const objectPath = `backups/${deviceId}/${mediaId}-${safeFilename(req.file.originalname)}`;
    await uploadToSupabaseTus({
      localPath,
      objectPath,
      size: req.file.size,
      contentType: req.file.mimetype,
    });

    res.status(201).json({
      bucket: SUPABASE_BUCKET,
      path: objectPath,
      size: req.file.size,
      contentType: req.file.mimetype,
    });
  } catch (error) {
    console.error("Supabase Storage upload failed:", error.message);
    if (res.headersSent) return next(error);
    res.status(502).json({ error: "Supabase Storage could not save this file." });
  } finally {
    await fs.promises.rm(localPath, { force: true }).catch(() => {});
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? `File exceeds the ${MAX_FILE_MB} MB upload limit.`
        : "Invalid multipart upload.",
    });
    return;
  }
  if (error.message === "Only image and video files are accepted.") {
    res.status(415).json({ error: error.message });
    return;
  }
  console.error("Upload request failed:", error.message);
  res.status(500).json({ error: "Upload failed." });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Kotlen upload server listening on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; closing server.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
