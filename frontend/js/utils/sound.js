// frontend/js/utils/sound.js
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export function playBeep(frequency = 800, duration = 150, type = 'sine') {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  
  // Volume control
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + duration / 1000);
}

export function playSuccessSound() {
    // Two-tone success beep
    playBeep(880, 100, 'sine'); // A5
    setTimeout(() => playBeep(1760, 200, 'sine'), 100); // A6
}

export function playErrorSound() {
    // Low buzz for error
    playBeep(150, 400, 'sawtooth');
}

export function playScanSound() {
    // Single short beep for scan
    playBeep(1200, 100, 'sine');
}
