function spin() {
  if (isSpinning) return;
  isSpinning = true;
  spinBtn.disabled = true;
  resultEl.textContent = "";
  resultEl.classList.remove("win"); // if you added the big-text style

  const TAU = Math.PI * 2;

  // Always normalize so angle growth doesn't accumulate over time
  currentAngle = ((currentAngle % TAU) + TAU) % TAU;

  // Pick a target slice as you already do
  const targetSlice = Math.floor(Math.random() * slices);

  // Choose a final angle so the CENTER of that slice lands at the pointer (12 o'clock)
  // If you already use baseAtTop, keep it. Otherwise define it here:
  const baseAtTop = -Math.PI / 2 - anglePerSlice / 2;
  const finalAngle = baseAtTop - targetSlice * anglePerSlice;

  // 🔑 Force a big spin: at least 6 full turns, up to 8
  const MIN_TURNS = 6;
  const EXTRA_TURNS_RANGE = 3; // 0..2 → total 6..8 turns
  const totalTurns = MIN_TURNS + Math.floor(Math.random() * (EXTRA_TURNS_RANGE + 1));

  // Compute target angle far “behind” the final angle so we must spin forward through many turns
  const target = finalAngle - totalTurns * TAU;

  // Make duration scale a bit with distance so long spins don’t feel too fast
  const distance = Math.abs(target - currentAngle);
  const duration = 2800 + (distance / TAU) * 250; // ~2800–3400ms typical

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
      resultEl.classList.add("win"); // optional big/pink style
      launchConfetti();
    }
  }
  requestAnimationFrame(frame);
}
