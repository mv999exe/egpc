// ============================================================
// egpc — Server-side image compressor
// Engine: sharp (libvips) → AVIF, tuned for documents & text.
//
// Why AVIF here (vs the old in-browser WebP):
//   • AVIF (AV1 intra) beats WebP/JPEG at the same visual quality,
//     especially on sharp text/line edges → smaller files that stay
//     readable. libvips/aom runs it server-side at full effort.
//   • chromaSubsampling '4:4:4' keeps colour on text edges from
//     bleeding, so small fonts stay crisp.
//   • effort 9 = maximum encoder search → smallest size for a quality.
// The result is never larger than the original (we fall back to it).
// ============================================================

import express from "express";
import multer from "multer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// HOST: which network interface to bind.
//   • "127.0.0.1" (loopback) = ONLY this PC / the Cloudflare tunnel can reach it —
//     nothing is exposed on the LAN or the internet directly. Safest; recommended
//     when using a tunnel for outside-the-home access.
//   • "0.0.0.0" = reachable by any device on the local network via this PC's IP.
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 8080;

// App password gate (HTTP Basic Auth). When APP_PASSWORD is set, EVERY request
// (pages + API) requires the password, so a public tunnel URL can't be used by
// anyone who doesn't have it. APP_USER is optional (defaults to "admin").
const AUTH_USER = process.env.APP_USER || "admin";
const AUTH_PASS = process.env.APP_PASSWORD || "";

// ---- Compression tuning ------------------------------------------------
// MAX_DIMENSION: cap on the longest edge. The single biggest lever on file
//   size is resolution (this is why a screenshot is smaller than the original
//   — fewer pixels, not a better codec). 1600px keeps documents and fine print
//   readable on screen/phone at the smallest size. Never upscales.
// AVIF_QUALITY: 1–100. 60 keeps text edges clean; the fallback pass drops to
//   46 only if q60 somehow isn't smaller than the original.
const MAX_DIMENSION = Number(process.env.MAX_DIMENSION) || 1600;
const AVIF_QUALITY = Number(process.env.AVIF_QUALITY) || 60;
const AVIF_FALLBACK_QUALITY = 46;
const AVIF_OPTS = { effort: 9, chromaSubsampling: "4:4:4" };

// Auto "document mode": if an image is nearly colourless (a scan/photo of a
// text page), we drop colour and flatten the paper background before encoding.
// That shrinks it further AND makes the text crisper. Colour photos are left
// in full colour. CHROMA_THRESHOLD is the mean per-pixel (max-min) over RGB,
// measured on a small thumbnail; below it → treat as a document.
const CHROMA_THRESHOLD = Number(process.env.CHROMA_THRESHOLD) || 18;

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40 MB

// sharp: cache decoded inputs modestly; use all cores for aom.
sharp.concurrency(0); // 0 = number of CPU cores

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

// ---- Password gate (only active when APP_PASSWORD is set) --------------
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false; // length leak is acceptable here
  return crypto.timingSafeEqual(ab, bb);
}

if (AUTH_PASS) {
  app.use((req, res, next) => {
    const hdr = req.headers.authorization || "";
    const [scheme, encoded] = hdr.split(" ");
    if (scheme === "Basic" && encoded) {
      const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
      if (safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASS)) return next();
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="egpc", charset="UTF-8"');
    return res.status(401).send("Authentication required.");
  });
}

app.use(express.static(join(__dirname, "public")));

// ---- Core compression --------------------------------------------------

// Decide whether the image is a document (near-colourless) by measuring the
// average colourfulness on a tiny thumbnail — cheap and reliable.
async function isDocument(inputBuffer) {
  try {
    const { data, info } = await sharp(inputBuffer, { failOn: "none" })
      .rotate()
      .resize(64, 64, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = info.width * info.height;
    if (!px) return false;
    let sum = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      sum += Math.max(r, g, b) - Math.min(r, g, b); // per-pixel chroma
    }
    return sum / px < CHROMA_THRESHOLD;
  } catch {
    return false; // on any doubt, treat as a colour photo (safe path)
  }
}

// Encode to AVIF. In document mode we drop colour (grayscale), flatten the
// paper background (normalise) and lightly sharpen text edges before encoding.
async function encodeAvif(inputBuffer, quality, doc) {
  let pipeline = sharp(inputBuffer, { failOn: "none" })
    .rotate() // apply EXIF orientation, then drop metadata (default)
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  if (doc) {
    pipeline = pipeline.grayscale().normalise().sharpen({ sigma: 0.6 });
  }
  return pipeline.avif({ quality, ...AVIF_OPTS }).toBuffer();
}

app.post("/api/compress", upload.single("image"), async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: "No image uploaded." });
  }

  const original = req.file.buffer;
  const originalSize = original.length;

  try {
    // Auto-pick the mode, then encode.
    const doc = await isDocument(original);
    const mode = doc ? "document" : "photo";

    let out = await encodeAvif(original, AVIF_QUALITY, doc);

    // Guarantee a real reduction: if q60 didn't beat the original
    // (rare: tiny or already-optimal inputs), try a harder pass.
    if (out.length >= originalSize) {
      const harder = await encodeAvif(original, AVIF_FALLBACK_QUALITY, doc);
      if (harder.length < out.length) out = harder;
    }

    // If even that is not smaller, the input is already optimal — keep it.
    if (out.length >= originalSize) {
      res.setHeader("Content-Type", req.file.mimetype || "application/octet-stream");
      res.setHeader("X-Original-Size", String(originalSize));
      res.setHeader("X-Compressed-Size", String(originalSize));
      res.setHeader("X-Output-Format", "original");
      res.setHeader("X-Mode", mode);
      res.setHeader("X-Kept-Original", "1");
      return res.send(original);
    }

    res.setHeader("Content-Type", "image/avif");
    res.setHeader("X-Original-Size", String(originalSize));
    res.setHeader("X-Compressed-Size", String(out.length));
    res.setHeader("X-Output-Format", "avif");
    res.setHeader("X-Mode", mode);
    res.setHeader("X-Kept-Original", "0");
    return res.send(out);
  } catch (err) {
    console.error("Compression failed:", err);
    return res.status(500).json({ error: "Compression failed: " + err.message });
  }
});

// Simple health check.
app.get("/api/health", (_req, res) => res.json({ ok: true, engine: "sharp", format: "avif" }));

// ---- Start -------------------------------------------------------------
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

app.listen(PORT, HOST, () => {
  console.log("egpc image compressor (server-side, sharp → AVIF)");
  console.log(`  Local:   http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") {
    for (const a of lanAddresses()) console.log(`  Network: http://${a}:${PORT}`);
  }
  console.log(`  Bound to ${HOST}:${PORT}` + (HOST === "127.0.0.1" ? "  (loopback only — reachable via the tunnel)" : ""));
  console.log(`  Password gate: ${AUTH_PASS ? "ON (user \"" + AUTH_USER + "\")" : "OFF"}`);
  if (!AUTH_PASS && HOST !== "127.0.0.1") {
    console.log("  ⚠  Exposed on the network with NO password. Set APP_PASSWORD to protect it.");
  }
});
