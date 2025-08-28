(function () {
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  function init() {
    const canvas = document.getElementById("wheel");
    if (!canvas) {
      console.error("[wheel] <canvas id='wheel'> not found.");
      return;
    }
    const ctx = canvas.getContext("2d");
    const spinBtn = document.getElementById("spin");
    const resultEl = document.getElementById("result");

    const size = canvas.width;
    const center = size / 2;
    const TAU = Math.PI * 2;

    let prizes = [];
    let slices = 0;
    let anglePerSlice = 0;
    let baseAtTop = 0;      // angle that places a slice CENTER at 12 o’clock
    let currentAngle = 0;
    let isSpinning = false;

    (async function boot() {
      prizes = await loadPrizesWithFallback("../data/wheel_prizes.json");

      // Arrange to avoid adjacent duplicates (circularly)
      prizes = arrangeCircular(prizes);

      // Random rotate the arrangement so it's not predictable
      prizes = rotateArray(prizes, Math.floor(Math.random() * prizes.length));

      slices = prizes.length;
      anglePerSlice = TAU / slices;
      baseAtTop = -Math.PI / 2 - anglePerSlice / 2; // slice center under pointer
      currentAngle = baseAtTop;

      drawWheel();
      if (spinBtn) spinBtn.addEventListener("click", spin);
    })();

    // ---------- data loading ----------
    async function loadPrizesWithFallback(url) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.warn(`[wheel] JSON fetch failed ${res.status}:`, body);
          return defaultExpanded();
        }
        /** @type {{label:string,count:number}[]} */
        const spec = await res.json();
        return expandSpec(spec);
      } catch (e) {
        console.warn("[wheel] JSON fetch/parse error; using defaults.", e);
        return defaultExpanded();
      }
    }

    function expandSpec(spec) {
      const out = [];
      for (const item of spec) {
        const label = String(item.label ?? "").trim();
        const count = Number(item.count ?? 0) | 0;
        for (let i = 0; i < count; i++) out.push(label);
      }
      if (out.length < 2) throw new Error("Need at least 2 slices");
      return out;
    }

    function defaultExpanded() {
      // Fallback to your new intended mix
      return ["$80", "$64", "$48", "$48", "$32", "$32", "$16", "$16", "$16", "$8"];
    }

    // ---------- arrangement helpers ----------
    function arrangeCircular(items) {
      // Goal: no two identical labels adjacent, including last↔first (circular).
      // Strategy: like "reorganize string" — place most frequent labels at even indices, then fill odds.
      const n = items.length;
      const counts = new Map();
      for (const v of items) counts.set(v, (counts.get(v) || 0) + 1);

      // Shuffle labels for variety, then sort by count desc
      const labels = [...counts.keys()];
      shuffle(labels);
      labels.sort((a, b) => counts.get(b) - counts.get(a));

      const result = new Array(n);
      let idx = 0;

      for (const label of labels) {
        let c = counts.get(label);
        while (c-- > 0) {
          result[idx] = label;
          idx += 2;
          if (idx >= n) idx = 1;
        }
      }

      // If the first and last ended up equal (rare), swap last with next spot that fixes it
      if (n > 2 && result[0] === result[n - 1]) {
        for (let i = 1; i < n - 1; i++) {
          if (result[i] !== result[0] && result[i - 1] !== result[n - 1]) {
            [result[i], result[n - 1]] = [result[n - 1], result[i]];
            break;
          }
        }
      }

      // Final safety check (should be clean for your counts)
      for (let i = 0; i < n; i++) {
        const a = result[i];
        const b = result[(i + 1) % n];
        if (a === b) {
          // Fallback: simple reshuffle+retry (extremely unlikely for your mix)
          return arrangeCircular(simpleShuffle(items));
        }
      }
      return result;
    }

    function rotateArray(arr, k) {
      const n = arr.length;
      const m = ((k % n) + n) % n;
      return arr.slice(m).concat(arr.slice(0, m));
    }

    function shuffle(arr) {
      // in-place Fisher–Yates
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    function simpleShuffle(arr) {
      const copy = arr.slice();
      return shuffle(copy);
    }

    // ---------- drawing ----------
    function drawWheel() {
      ctx.clearRect(0, 0, size, size);

      // Wedges
      for (let i = 0; i < slices; i++) {
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.fillStyle = i % 2 ? "#ffd3ea" : "#ffe9f4";
        ctx.arc(
          center,
          center,
          center - 6,
          currentAngle + i * anglePerSlice,
          currentAngle + (i + 1) * anglePerSlice
        );
        ctx.closePath();
        ctx.fill();
      }

      // Rim
      ctx.beginPath();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#ff4fa3";
      ctx.arc(center, center, center - 6, 0, TAU);
      ctx.stroke();

      // Labels: horizontal relative to page (canvas is CSS-mirrored in your HTML)
      ctx.fillStyle = "#111";
      ctx.font = "bold 64px system-ui, -apple-system, Segoe UI, Arial"; // bigger numbers
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textRadius = center - 32;

      for (let i = 0; i < slices; i++) {
        const midAngle = currentAngle + i * anglePerSlice + anglePerSlice / 2;
        const x = center + textRadius * Math.cos(midAngle);
        const y = center + textRadius * Math.sin(midAngle);
        ctx.fillText(prizes[i], x, y);
      }
    }

    // ---------- effects ----------
    function launchConfetti() {
      if (typeof confetti !== "function") return;
      const duration = 1000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({ particleCount: 35, spread: 55, startVelocity: 28, origin: { y: 0.2 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    }

    // ---------- spin ----------
    function spin() {
      if (isSpinning) return;
      isSpinning = true;
      if (spinBtn) spinBtn.disabled = true;
      if (resultEl) {
        resultEl.textContent = "";
        resultEl.classList.remove("win");
      }

      // normalize
      currentAngle = ((currentAngle % TAU) + TAU) % TAU;

      // pick target slice
      const targetSlice = Math.floor(Math.random() * slices);

      // aim CENTER of chosen slice at pointer (12 o'clock)
      const finalAngle = baseAtTop - targetSlice * anglePerSlice;

      // big spin: 6–8 turns
      const totalTurns = 6 + Math.floor(Math.random() * 3); // 6..8
      const target = finalAngle - totalTurns * TAU;

      // duration scales slightly with distance
      const distance = Math.abs(target - currentAngle);
      const duration = 2800 + (distance / TAU) * 250; // ~2.8–3.4s
      const start = performance.now();
      const startAngle = currentAngle;

      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

      function frame(now) {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / duration);
        const eased = easeOutCubic(t);
        currentAngle = startAngle + (target - startAngle) * eased;
        drawWheel();

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          isSpinning = false;
          if (spinBtn) spinBtn.disabled = false;
          const prize = prizes[targetSlice];
          if (resultEl) {
            resultEl.textContent = `You won: ${prize}!`;
            resultEl.classList.add("win");
          }
          launchConfetti();
        }
      }

      requestAnimationFrame(frame);
    }
  }
})();
