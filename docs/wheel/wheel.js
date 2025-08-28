(async function () {
  // DOM refs
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const spinBtn = document.getElementById("spin");
  const resultEl = document.getElementById("result");

  // ---- Load prizes from JSON (../ because wheel/ is a sibling of data/) ----
  async function loadPrizes() {
    try {
      const res = await fetch("../data/wheel_prizes.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      /** @type {{label:string, count:number}[]} */
      const spec = await res.json();

      // Expand weights into individual slices
      const expanded = [];
      for (const { label, count } of spec) {
        for (let i = 0; i < count; i++) expanded.push(label);
      }
      if (expanded.length < 2) throw new Error("Need at least 2 slices");
      return expanded;
    } catch (e) {
      console.warn("Failed to load wheel_prizes.json, using defaults:", e);
      return ["$80", "$64", "$64", "$48", "$48", "$32", "$32", "$16", "$16", "$16"];
    }
  }

  const prizes = await loadPrizes();

  // ---- Wheel geometry/state ----
  const size = canvas.width;
  const center = size / 2;
  const slices = prizes.length;
  const TAU = Math.PI * 2;
  const anglePerSlice = TAU / slices;

  // Center a slice at the pointer (12 o’clock): base angle at top minus half-slice
  const baseAtTop = -Math.PI / 2 - anglePerSlice / 2;

  // Start so that a slice center is already at the pointer
  let currentAngle = baseAtTop;
  let isSpinning = false;

  // Pretty alternating colors
  const colors = Array.from({ length: slices }, (_, i) => (i % 2 ? "#ffd3ea" : "#ffe9f4"));

  function drawWheel() {
    ctx.clearRect(0, 0, size, size);

    // Wedges
    for (let i = 0; i < slices; i++) {
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.fillStyle = colors[i];
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

    // Labels (canvas is CSS-flipped, so text appears mirrored as desired)
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate(currentAngle);
    for (let i = 0; i < slices; i++) {
      const start = i * anglePerSlice;
      ctx.save();
      ctx.rotate(start + anglePerSlice / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#111";
      ctx.font = "bold 20px system-ui, -apple-system, Segoe UI, Arial";
      ctx.fillText(prizes[i], center - 28, 8);
      ctx.restore();
    }
    ctx.restore();

    // Rim
    ctx.beginPath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ff4fa3";
    ctx.arc(center, center, center - 6, 0, TAU);
    ctx.stroke();
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
    spinBtn.disabled = true;

    // Reset result area (optional big style)
    if (resultEl) {
      resultEl.textContent = "";
      resultEl.classList.remove("win");
    }

    // Normalize current angle to [0, TAU)
    currentAngle = ((currentAngle % TAU) + TAU) % TAU;

    // Pick a target slice index
    const targetSlice = Math.floor(Math.random() * slices);

    // Aim the CENTER of that slice to the pointer at 12 o'clock
    const finalAngle = baseAtTop - targetSlice * anglePerSlice;

    // Force a large spin: 6–8 full rotations
    const MIN_TURNS = 6;
    const EXTRA_TURNS_RANGE = 2; // 0..2 → 6..8 total
    const totalTurns = MIN_TURNS + Math.floor(Math.random() * (EXTRA_TURNS_RANGE + 1));

    // Target angle far behind, so animation will spin forward through many turns
    const target = finalAngle - totalTurns * TAU;

    // Duration scales slightly with distance to feel natural
    const distance = Math.abs(target - currentAngle);
    const duration = 2800 + (distance / TAU) * 250; // ~2.8–3.4s typical
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
        spinBtn.disabled = false;
        const prize = prizes[targetSlice];
        if (resultEl) {
          resultEl.textContent = `You won: ${prize}!`;
          resultEl.classList.add("win"); // make it large/pink if CSS provided
        }
        launchConfetti();
      }
    }

    requestAnimationFrame(frame);
  }

  spinBtn.addEventListener("click", spin);
  drawWheel();
})();
