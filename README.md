# egpc — Minimal Image Tools

A tiny, colorless (black / white / gray only) web app.

## Pages
- **Home** (`index.html`) — a grid of 8 cards. **Image Compressor** opens the
  real tool; every other card shows a `Coming soon` alert.
- **Image Compressor** (`compressor.html`) — upload or drag & drop an image.
  It is compressed in the browser and shown in a draggable **Before / After**
  comparison slider (left = Before, right = After), with the before size,
  after size, and the **% saved**. You can download the compressed result.

## Compression library
Uses [`browser-image-compression`](https://github.com/Donaldcwl/browser-image-compression)
(vendored at `vendor/browser-image-compression.js`, v2.0.2). It runs fully in
the browser via a Web Worker. The output is **WebP**, and compression is driven
by a size target (`maxSizeMB`) plus a resolution cap (`maxWidthOrHeight: 1600`)
and quality (`initialQuality: 0.75`), so every image is meaningfully smaller
while documents and invoices stay readable. The result is never larger than the
original. See `docs/TECHNICAL.md` for the full design.

## Run
No build step. Open `index.html` in a browser, or serve locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
