(async function () {
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const spinBtn = document.getElementById("spin");
  const resultEl = document.getElementById("result");

  // ---- Load prizes from JSON ----
  async function loadPrizes() {
    try {
      const res = await fetch("./data/wheel_prizes.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      /** @type {{label:string, count:number}[]} */
      const spec = await res.json();

      // Expand weighted entries into individual slices
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

  // ---- Wheel drawing state ----
  const size = canvas.width;
  const center = size / 2;
  const slices = prizes.length;
  const anglePerSlice = (Math.PI * 2) / slices;
  const colors = Array.from({ length: slices }, (_, i) => (i % 2 ? "#ffd3ea" : "#ffe9f4"));

  // Start with pointer pointing "up"
  let currentAngle = -Math.PI / 2;
  let isSpinning = false;

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

    // Labels (will appear mirrored because the entire canvas is CSS-flipped)
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
    ctx.arc(center, center, center - 6, 0, Math.PI * 2);
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
    resultEl.textContent = "";

    const extraTurns = 4 + Math.floor(Math.random() * 3); // 4–6 turns
    const targetSlice = Math.floor(Math.random() * slices);
    const finalAngle = -Math.PI / 2 - targetSlice * anglePerSlice; // pointer at top

    const target = finalAngle - extraTurns * Math.PI * 2;
    const duration = 3200;
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
        resultEl.textContent = `You won: ${prize}!`;
        launchConfetti();
      }
    }
    requestAnimationFrame(frame);
  }

  spinBtn.addEventListener("click", spin);
  drawWheel();
})();
