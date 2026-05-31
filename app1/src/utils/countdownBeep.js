/** Short beep for countdown ticks (matches data-collection start cue style). */
export function playCountdownBeep({ final = false } = {}) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = final ? "sine" : "square";
    osc.frequency.setValueAtTime(final ? 1000 : 660, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(final ? 0.35 : 0.28, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (final ? 0.45 : 0.22));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (final ? 0.5 : 0.25));
    osc.onended = () => void ctx.close();
  } catch {
    /* ignore audio errors */
  }
}
