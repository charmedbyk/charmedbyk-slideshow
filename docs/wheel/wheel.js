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
    let baseAtTop = 0;      // angle that puts a slice CENTER at 12 o’clock
    let currentAngle = 0;
    let isSpinning = false;

    (async function boot() {
      prizes = await loadPrizesWithFallback("../data/wheel_prizes.json");
      slices = prizes.length;
      anglePerSlice = TAU / slices;
      baseAtTop = -Math.PI / 2 - anglePerSlice / 2; // slice center under pointer
      currentAngle = baseAtTop;                      // start centered
      drawWheel();
      if (spinBtn) spinBtn.addEventListener("click", spin);
    })();

    async function loadPrizesWithFallback(url) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          const body = await safeText(res);
          console.warn(`[wheel] JSON fetch failed ${res.status}:`, body);
          return defaultPrizes();
        }
        const json = await res.json();
        const expanded = expandSpec(json);
        console.log("[wheel] Loaded prizes:", expanded);
        return expanded;
      } catch (e) {
        console.warn("[wheel] JSON fetch/parse error; using defaults.", e);
        return defaultPrizes();
      }
    }

    function safeText(res) {
      return res.text().catch(() => "(no body)");
    }

    function expandSpec(spec) {
      // spec: [{label, count}, ...]
      const out = [];
      for (const item of spec) {
        const label = String(item.label ?? "").trim();
        const count = Number(item.count ?? 0) | 0;
        for (let i = 0; i < count; i++) out.push(label);
      }
      if (out.length < 2) throw new Error("Need at least 2 slices");
      return out;
    }

    function defaultPrizes() {
      return ["$80", "$64", "$64", "$48", "$48", "$32", "$32", "$16", "$16", "$16"];
    }

    function drawWheel() {
      ctx.clearRect(0, 0, size, size);

      // Alternating wedge colors
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

      // Labels: keep them horizontal relative to the page
      ctx.fillStyle = "#111";
      ctx.font = "bold 32px system-ui, -apple-system, Segoe UI, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textRadius = center - 32;

      for (let i = 0; i < slices; i++) {
        const midAngle = currentAngle + i * anglePerSlice + anglePerSlice / 2;
        const x = center + textRadius * Math.cos(midAngle);
        const y = center + textRadius * Math.sin(midAngle);
        ctx.fillText(prizes[i], x, y); // canvas is CSS-flipped, so this renders mirrored as you wanted
      }
    }

    function launchConfetti() {
      if (typeof confetti !== "function") return;
      const duration = 1000;
      const end = Date.now() + duration;
      (function frame() {
        confetti({ particleCount: 35, spread: 55, startVelocity: 28, origin: { y: 0.2 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    }

    function spin() {
      if (isSpinning) return;
      isSpinning = true;
      if (spinBtn) spinBtn.disabled = true;
      if (resultEl) {
        resultEl.textContent = "";
        resultEl.classList.remove("win");
      }

      // normalize angle to [0, TAU)
      currentAngle = ((currentAngle % TAU) + TAU) % TAU;

      // pick target slice
      const targetSlice = Math.floor(Math.random() * slices);

      // center chosen slice under pointer
      const finalAngle = baseAtTop - targetSlice * anglePerSlice;

      // big spin: 6–8 full turns
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
            resultEl.classList.add("win"); // add CSS for .result.win in your HTML if you want it larger/pink
          }
          launchConfetti();
        }
      }

      requestAnimationFrame(frame);
    }
  }
})();
