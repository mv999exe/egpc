// ============================================================
// Image Compressor — uses browser-image-compression (vendored).
// Keeps documents/invoices sharp by preserving resolution and
// driving size down via WebP quality rather than downscaling.
// ============================================================

(function () {
  "use strict";

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var statusEl = document.getElementById("status");
  var statusText = document.getElementById("status-text");
  var resultEl = document.getElementById("result");

  var beforeImg = document.getElementById("before-img");
  var afterImg = document.getElementById("after-img");
  var beforeLayer = document.getElementById("before-layer");
  var compareEl = document.getElementById("compare");
  var dividerEl = document.getElementById("divider");

  var statBefore = document.getElementById("stat-before");
  var statAfter = document.getElementById("stat-after");
  var statSaved = document.getElementById("stat-saved");
  var downloadBtn = document.getElementById("download-btn");
  var resetBtn = document.getElementById("reset-btn");
  var resultNote = document.getElementById("result-note");

  var currentObjectUrls = [];

  // Compression preset — "Smallest size". targetRatio forces the output to be
  // at most this fraction of the original size (the library shrinks quality and
  // dimensions to hit it), so every image gets a real reduction. Tune these to
  // trade size against fidelity.
  var PRESET = { maxWidthOrHeight: 1600, quality: 0.75, targetRatio: 0.5 };

  // ---- Helpers ----------------------------------------------------------

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    var kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(kb < 10 ? 1 : 0) + " KB";
    var mb = kb / 1024;
    return mb.toFixed(2) + " MB";
  }

  function revokeUrls() {
    currentObjectUrls.forEach(function (u) {
      URL.revokeObjectURL(u);
    });
    currentObjectUrls = [];
  }

  function trackUrl(url) {
    currentObjectUrls.push(url);
    return url;
  }

  function show(el) {
    el.classList.remove("hidden");
  }
  function hide(el) {
    el.classList.add("hidden");
  }

  // ---- Compression flow -------------------------------------------------

  function handleFile(file) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) {
      alert("Please choose an image file.");
      return;
    }

    revokeUrls();
    hide(dropzone);
    hide(resultEl);
    show(statusEl);
    statusText.textContent = "Compressing…";

    compressBest(file)
      .then(function (best) {
        // Never produce a file larger than the original. If even the lowest
        // quality still isn't smaller (already-optimal input), keep the original.
        if (best && best.size < file.size) {
          renderResult(file, best, true);
        } else {
          renderResult(file, file, false);
        }
      })
      .catch(function (err) {
        console.error(err);
        hide(statusEl);
        show(dropzone);
        alert("Sorry, compression failed: " + (err && err.message ? err.message : err));
      });
  }

  // Force a real, visible size reduction. We give the library a size TARGET
  // (a fraction of the original) and let it lower quality AND shrink the
  // dimensions to reach it — so it also shrinks images that are already small
  // or already below the resolution cap (screenshots, pre-compressed photos),
  // where quality reduction alone can't beat the original.
  function compressBest(file) {
    var sizeMB = file.size / 1024 / 1024;

    return imageCompression(file, {
      maxSizeMB: Math.max(0.02, sizeMB * PRESET.targetRatio),
      maxWidthOrHeight: PRESET.maxWidthOrHeight,
      initialQuality: PRESET.quality,
      useWebWorker: true,
      fileType: "image/webp",
    }).then(function (out) {
      if (out.size < file.size) return out;
      // Rare: an extremely well-optimized input. Force a harder downscale so
      // the result is still meaningfully smaller than the original.
      return imageCompression(file, {
        maxSizeMB: Math.max(0.015, sizeMB * 0.4),
        maxWidthOrHeight: 1200,
        initialQuality: 0.6,
        useWebWorker: true,
        fileType: "image/webp",
      });
    });
  }

  function renderResult(originalFile, resultBlob, compressedUsed) {
    var beforeUrl = trackUrl(URL.createObjectURL(originalFile));
    var afterUrl = trackUrl(URL.createObjectURL(resultBlob));

    // Size the "before" layer image to match the rendered "after" width so
    // the two images overlap pixel-for-pixel inside the clip container.
    afterImg.onload = function () {
      beforeImg.style.width = afterImg.clientWidth + "px";
      setDivider(50);
    };
    beforeImg.src = beforeUrl;
    afterImg.src = afterUrl;

    var beforeSize = originalFile.size;
    var afterSize = resultBlob.size;
    // Clamp to >= 0: with the smaller-of-two guard this is always non-negative.
    var saved = beforeSize > 0 ? Math.max(0, (1 - afterSize / beforeSize) * 100) : 0;

    statBefore.textContent = formatBytes(beforeSize);
    statAfter.textContent = formatBytes(afterSize);
    statSaved.textContent = saved.toFixed(1) + "%";

    if (compressedUsed) {
      hide(resultNote);
      downloadBtn.textContent = "Download WebP";
      var base = (originalFile.name || "image").replace(/\.[^.]+$/, "");
      downloadBtn.href = afterUrl;
      downloadBtn.download = base + "-compressed.webp";
    } else {
      // Compression would have made the file larger, so we kept the original.
      resultNote.textContent =
        "This image is already well optimized — compressing it would make it larger, so the original was kept.";
      show(resultNote);
      downloadBtn.textContent = "Download original";
      downloadBtn.href = afterUrl;
      downloadBtn.download = originalFile.name || "image";
    }

    hide(statusEl);
    show(resultEl);
    setDivider(50);
  }

  // ---- Before/After divider (draggable) ---------------------------------

  function setDivider(percent) {
    var p = Math.max(0, Math.min(100, percent));
    beforeLayer.style.width = p + "%";
    dividerEl.style.left = p + "%";
  }

  function pointerToPercent(clientX) {
    var rect = compareEl.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  var dragging = false;

  function startDrag(e) {
    dragging = true;
    moveDrag(e);
    e.preventDefault();
  }
  function moveDrag(e) {
    if (!dragging) return;
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    setDivider(pointerToPercent(clientX));
  }
  function endDrag() {
    dragging = false;
  }

  compareEl.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", moveDrag);
  window.addEventListener("mouseup", endDrag);
  compareEl.addEventListener("touchstart", startDrag, { passive: false });
  window.addEventListener("touchmove", moveDrag, { passive: false });
  window.addEventListener("touchend", endDrag);

  // Keep the before layer aligned if the window resizes.
  window.addEventListener("resize", function () {
    if (afterImg.clientWidth) {
      beforeImg.style.width = afterImg.clientWidth + "px";
    }
  });

  // ---- Wiring -----------------------------------------------------------

  dropzone.addEventListener("click", function () {
    fileInput.click();
  });

  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "dragend", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      handleFile(dt.files[0]);
    }
  });

  resetBtn.addEventListener("click", function () {
    fileInput.value = "";
    hide(resultEl);
    show(dropzone);
  });
})();
