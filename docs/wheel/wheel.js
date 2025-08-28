(function () {
  // Ensure DOM is ready
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  function init() {
    try {
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

      let prizes = null;
      let slices = 0;
      let anglePerSlice = 0;
      let currentAngle = 0;
      let isSpinning = false;

      // Load prizes, then draw
      loadPrizes()
        .then((expanded) => {
          prizes = expanded;
          slices = prizes.length;
          anglePerSlice = TAU / slices;

          // center a slice under the pointer at 12 o’clock
          const baseAtTop = -Math.PI / 2 - anglePerSlice / 2;
          currentAngle = baseAtTop;

          drawWheel();
          if (spinBtn) spinBtn.addEventListener("click", () => spin(baseAtTop));
        })
        .catch((e) => {
          console.error("[wheel] Unexpected init error:", e);
        });

      // ---------- helpers ----------
      async function loadPrizes() {
        // Try JSON first
        try {
          const res = await fetch("../data/wheel_prizes.json", { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          /** @type {{label:string,count:number}[]} */
          const spec = await res.json();

          const expanded = [];
          for (const { label, count } of spec) {
            for (let i = 0; i < count; i++) expanded.push(label);
          }
          if (expanded.length < 2) throw new Error("Need at least 2 slices");
          console.log("[wheel] Loaded prizes:", expanded);
          return expanded;
        } catch (e) {
          console.warn("[wheel] Failed to load ../data/wheel_prizes.json; using defaults.", e);
          return ["$80", "$64", "$64", "$48", "$48", "$32", "$32", "$16", "$16", "$16"];
        }
      }

      const colors = () =>
        Array.from({ length: slices }, (_, i) => (i % 2 ? "#ffd3ea" : "#ffe9f4"));

      function drawWheel() {
        ctx.clearRect(0, 0, size, size);

        // Wedges
        const cols = colors();
        for (let i = 0; i < slices; i++) {
          ctx.beginPath();
          ctx.moveTo(center, center);
          ctx.fillStyle = cols[i];
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

        // Labels horizontal on page
        ctx.fillStyle = "#111";
        ctx.font = "bold 20px system-ui, -apple-system, Segoe UI, Arial";
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

      function launchConfetti() {
        // Optional: confetti lib via CDN
        if (typeof confetti !== "function") return;
        const duration = 1000;
        const end = Date.now() + duration;
        (function frame() {
          confetti({ particleCount: 35, spread: 55, startVelocity: 28, origin: { y: 0.2 } });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();
      }

      function spin(baseAtTop) {
        if (isSpinning) return;
        isSpinning = true;
        if (spinBtn) spinBtn.disabled = true;
        if (resultEl) {
          resultEl.textContent = "";
          resultEl.classList.remove("win");
        }

        // Normalize angle
        currentAngle = ((currentAngle % TAU) + TAU) % TAU;

        // Pick target slice
        const targetSlice = Math.floor(Math.random() * slices);

        // Center target slice under pointer (12 o’clock)
        const finalAngle = baseAtTop - targetSlice * anglePerSlice;

        // Big spin 6–8 turns
        const totalTurns = 6 + Math.floor(Math.random() * 3); // 6..8
        const target = finalAngle - totalTurns * TAU;

        // Duration scales slightly with distance
        const distance = Math.abs(target - currentAngle);
        const duration = 2800 + (distance / TAU) * 250;
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
    } catch (e) {
      console.error("[wheel] Fatal init error:", e);
    }
  }
})();
