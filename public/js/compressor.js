// ============================================================
// Image Compressor — frontend.
// Compression happens SERVER-SIDE: we POST the file to /api/compress,
// where sharp (libvips) re-encodes it to AVIF tuned for documents/text,
// and we render the returned image in the Before/After slider.
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
    statusText.textContent = "Compressing on the server…";

    compressOnServer(file)
      .then(function (out) {
        renderResult(file, out.blob, out.keptOriginal, out.format, out.mode);
      })
      .catch(function (err) {
        console.error(err);
        hide(statusEl);
        show(dropzone);
        alert("Sorry, compression failed: " + (err && err.message ? err.message : err));
      });
  }

  // POST the raw file to the server. The server returns the compressed
  // image bytes plus size/format metadata in response headers.
  function compressOnServer(file) {
    var form = new FormData();
    form.append("image", file, file.name || "image");

    return fetch("/api/compress", { method: "POST", body: form }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return { error: "Server error " + res.status };
          })
          .then(function (j) {
            throw new Error(j.error || "Server error " + res.status);
          });
      }
      var compressedSize = Number(res.headers.get("X-Compressed-Size")) || 0;
      var format = res.headers.get("X-Output-Format") || "avif";
      var keptOriginal = res.headers.get("X-Kept-Original") === "1";
      var mode = res.headers.get("X-Mode") || "";
      return res.blob().then(function (blob) {
        return {
          blob: blob,
          size: compressedSize || blob.size,
          format: format,
          keptOriginal: keptOriginal,
          mode: mode,
        };
      });
    });
  }

  function renderResult(originalFile, resultBlob, keptOriginal, format, mode) {
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
    var saved = beforeSize > 0 ? Math.max(0, (1 - afterSize / beforeSize) * 100) : 0;

    statBefore.textContent = formatBytes(beforeSize);
    statAfter.textContent = formatBytes(afterSize);
    statSaved.textContent = saved.toFixed(1) + "%";

    var base = (originalFile.name || "image").replace(/\.[^.]+$/, "");

    if (!keptOriginal && format === "avif") {
      // Show which mode the server picked, so it's clear what happened.
      if (mode === "document") {
        resultNote.textContent = "Document mode: converted to grayscale and cleaned up for the sharpest text at the smallest size.";
        show(resultNote);
      } else if (mode === "photo") {
        resultNote.textContent = "Photo mode: kept in full colour (AVIF 4:4:4).";
        show(resultNote);
      } else {
        hide(resultNote);
      }
      downloadBtn.textContent = "Download AVIF";
      downloadBtn.href = afterUrl;
      downloadBtn.download = base + "-compressed.avif";
    } else {
      // Server determined the input is already optimal and returned it as-is.
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
