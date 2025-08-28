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
      const expanded = await loadPrizesWithFallback("../data/wheel_prizes.json");
      prizes = arrangeNoAdj(expanded);
      // random rotate so the ring doesn't always start the same
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        /** @type {{label:string,count:number}[]} */
        const spec = await res.json();
        return expandSpec(spec);
      } catch (e) {
        console.warn("[wheel] JSON load failed; using defaults.", e);
        // Fallback to your current intended mix
        return ["$80", "$64", "$48", "$48", "$32", "$32", "$16", "$16", "$16", "$8"];
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

    // ---------- arrangement ----------
    function arrangeNoAdj(items) {
      const n = items.length;
      // Count frequencies
      const counts = new Map();
      for (const v of items) counts.set(v, (counts.get(v) || 0) + 1);

      // Quick feasibility check: maxCount <= floor(n/2) for circular no-adj
      const maxCount = Math.max(...counts.values());
      if (maxCount > Math.floor(n / 2)) {
        console.warn("[wheel] High frequency may force adjacency; proceeding best-effort.");
      }

      // 1) Greedy spacing: place most frequent labels at even indices, then fill odds.
      const labels = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
      const result = new Array(n).fill(null);

      let idx = 0;
      for (const label of labels) {
        let c = counts.get(label);
        while (c-- > 0) {
          result[idx] = label;
          idx += 2;
          if (idx >= n) idx = 1;
        }
      }

      // If any nulls remain (shouldn't), fill them randomly with leftover items
      for (let i = 0; i < n; i++) if (result[i] == null) result[i] = items[i % items.length];

      // If still adjacent duplicates (including wrap), patch with randomized retries
      if (!isValidRing(result)) {
        const fixed = tryRandomizeNoAdj(items, 4000);
        if (fixed) return fixed;
      }
      return result;
    }

    function isValidRing(arr) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i], b = arr[(i + 1) % arr.length];
        if (a === b) return false;
      }
      return true;
    }

    function tryRandomizeNoAdj(items, attempts = 2000) {
      const arr = items.slice();
      for (let t = 0; t < attempts; t++) {
        shuffle(arr);
        if (isValidRing(arr)) return arr.slice();
        // small local repair: swap random pair and check
        const i = (Math.random() * arr.length) | 0;
        const j = (Math.random() * arr.length) | 0;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        if (isValidRing(arr)) return arr.slice();
      }
      console.warn("[wheel] Could not find perfect no-adj ring after retries; using best-effort.");
      return arr.slice();
    }

    function rotateArray(arr, k) {
      const n = arr.length;
      const m = ((k % n) + n) % n;
      return arr.slice(m).concat(arr.slice(0, m));
    }

    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
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
      ctx.font = "bold 28px system-ui, -apple-system, Segoe UI, Arial";
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
