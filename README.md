# egpc — Image Compressor (server-side)

A tiny, colorless (black / white / gray) web app for compressing images —
tuned for **documents, invoices and anything with text**, so the text stays
sharp and readable at the smallest possible size.

## التقنية المستخدمة (اسم كل حاجة في سطر)
- **الضغط:** `sharp` (مبني على **libvips**) + مشفّر **aom** — يشتغل **على السيرفر (server-side)**.
- **صيغة الإخراج:** **AVIF** (مبني على **AV1 intra-frame coding**) — أقوى ضغط للنصوص والحواف.
- **السيرفر:** **Node.js** + **Express** (يقدّم الصفحات + API الضغط)، ورفع الملفات بـ **Multer**.
- **الواجهة:** HTML/CSS/JavaScript عادي (Vanilla) — من غير framework.
- **الأمان:** كلمة مرور للتطبيق (**HTTP Basic Auth**) + ربط على **loopback** + **Cloudflare Tunnel** للوصول من بره.

التفاصيل الكاملة وأسباب كل قرار في [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

## Pages
- **Home** (`/`) — a grid of 8 cards. **Image Compressor** opens the real tool;
  every other card shows a `Coming soon` alert.
- **Image Compressor** (`/compressor.html`) — upload or drag & drop an image.
  It is sent to the server, compressed to AVIF, and shown in a draggable
  **Before / After** slider with before size, after size, and the **% saved**.
  The result is never larger than the original.

## Compression engine (settings)
`sharp` with settings tuned for smallest-size-but-readable in [`server.js`](server.js):
- **AVIF, quality 60, `effort: 9`, `chromaSubsampling: '4:4:4'`** — the strongest
  widely-usable codec for text; 4:4:4 avoids colour bleeding on small fonts.
- **Longest edge capped at 1600px** — resolution is the biggest lever on file size
  (this is why a screenshot is smaller than the original: fewer pixels, not a
  better codec). 1600px keeps documents and fine print readable on screen/phone
  at the smallest size. Configurable via `MAX_DIMENSION`.
- **Auto "document mode":** if an image is nearly colourless (a scan/photo of a
  text page), the server drops colour to grayscale, flattens the paper background
  (`normalise`) and lightly sharpens — smaller **and** crisper text. Colour photos
  are detected and kept in full colour. Threshold via `CHROMA_THRESHOLD`.
- EXIF orientation applied, metadata stripped (privacy + size).

The response reports which mode was used in the `X-Mode` header
(`document` / `photo`), shown in the UI under the slider.

Typical results: a b/w document ~70 KB → ~7 KB (~90% smaller); a colour photo
keeps full colour at ~75% smaller — both with no loss of readable detail.

---

## Run it (you run this in cmd — Claude does not)

Requires Node.js 18+ (already installed). In **Command Prompt (cmd)**:

```bat
cd /d "C:\Users\mv999\OneDrive\Desktop\egpc-claude-image-compression-app-gez8ha"
set APP_PASSWORD=ضع_كلمة_مرور_قوية_هنا
npm start
```

- Server prints `Bound to 127.0.0.1:8080 (loopback only)` and `Password gate: ON`.
- Open on this PC: <http://localhost:8080> (it will ask for user `admin` + your password).
- To also allow other devices on the **same Wi-Fi** directly, start with
  `set HOST=0.0.0.0` before `npm start` (not needed if you use the tunnel below).
- Change the port with `set PORT=9000`.

> Keep this cmd window open and the PC on for the site to stay reachable.
> Stop the server with `Ctrl + C` in that window.

---

## Reach it from OUTSIDE the home (securely) — Cloudflare Tunnel

This is the **safe** way to expose the app to the internet. A tunnel makes an
**outbound-only** connection from your PC to Cloudflare, so:

- **No router port-forwarding and no open inbound ports** → the rest of your PC
  and network is **not** exposed. Only `localhost:8080` (this one app) is reached,
  and only through the tunnel.
- You get a public **HTTPS** URL. Combined with the `APP_PASSWORD`, only people
  you give the password to can actually use it.

Steps (run in a **second** cmd window; the server stays running in the first):

1. Install once (winget): `winget install --id Cloudflare.cloudflared`
2. Start a tunnel to your running server:
   ```bat
   cloudflared tunnel --url http://localhost:8080
   ```
3. cloudflared prints a URL like `https://random-words.trycloudflare.com`.
   Open that from any device, anywhere — it asks for your `admin` + password.

Notes:
- The quick-tunnel URL changes every run. For a **permanent** URL (and even
  stronger auth via Cloudflare Access / Google login), create a **named tunnel**
  with a free Cloudflare account + a domain — see cloudflared docs.
- Alternatives with the same "no open ports" safety: **Tailscale** (private, only
  your own devices) or **ngrok**.

### Why NOT plain router port-forwarding?
Port-forwarding opens an inbound hole to your PC that the whole internet can probe,
and home IPs change. The tunnel avoids all of that — nothing inbound is opened.

---

## Security summary
- **App is isolated:** it only serves the files in `public/` and one endpoint
  (`/api/compress`). Uploads are held in memory (`multer` memoryStorage) — nothing
  is written to disk, and there is no file-browsing or shell access. Max upload 40 MB.
- **Password gate** (`APP_PASSWORD`) protects every page and the API.
- **Loopback binding** by default (`127.0.0.1`) — not exposed on the LAN unless you
  opt in with `HOST=0.0.0.0`.
- **Tunnel** for outside access — no inbound firewall/router changes needed.

> The app is server-side, so it cannot run on GitHub Pages (static hosting only);
> the old Pages workflow was removed.
