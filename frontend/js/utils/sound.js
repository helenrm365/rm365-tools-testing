// frontend/js/utils/sound.js
// Lazy-init AudioContext to comply with browser autoplay policy
let audioCtx = null;
let audioUnlocked = false;
let onUnlockCallbacks = [];

console.log('[Sound] Module loaded');

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    console.log('[Sound] AudioContext created, state:', audioCtx.state);
  }
  return audioCtx;
}

// Check if audio is unlocked
export function isAudioUnlocked() {
  return audioUnlocked;
}

// Register a callback for when audio gets unlocked
export function onAudioUnlock(callback) {
  if (audioUnlocked) {
    callback();
  } else {
    onUnlockCallbacks.push(callback);
  }
}

// Unlock audio on first user gesture (required by Chrome, Safari, etc.)
function unlockAudio() {
  console.log('[Sound] User gesture detected, unlocking audio...');
  if (audioUnlocked) {
    console.log('[Sound] Already unlocked');
    return;
  }
  
  const ctx = getAudioContext();
  console.log('[Sound] Context state before resume:', ctx.state);
  
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      audioUnlocked = true;
      console.log('[Sound] ✅ AudioContext resumed successfully, state:', ctx.state);
      // Notify all registered callbacks
      onUnlockCallbacks.forEach(cb => cb());
      onUnlockCallbacks = [];
    }).catch(err => {
      console.warn('[Sound] ❌ Failed to unlock AudioContext:', err);
    });
  } else {
    audioUnlocked = true;
    console.log('[Sound] ✅ AudioContext already running, state:', ctx.state);
    // Notify all registered callbacks
    onUnlockCallbacks.forEach(cb => cb());
    onUnlockCallbacks = [];
  }
}

// Listen for user gestures to unlock audio
['click', 'touchstart', 'keydown'].forEach(event => {
  document.addEventListener(event, unlockAudio, { once: true, passive: true });
});

// Export unlockAudio for explicit calls (e.g., when starting a scanner)
export { unlockAudio };

export function playBeep(frequency = 800, duration = 150, type = 'sine') {
  console.log('[Sound] playBeep called:', { frequency, duration, type });
  
  const ctx = getAudioContext();
  console.log('[Sound] Context state:', ctx.state);
  
  // Try to resume if suspended (user gesture should have unlocked it)
  if (ctx.state === 'suspended') {
    console.log('[Sound] Context suspended, attempting resume...');
    ctx.resume().catch(() => {});
  }
  
  // Don't play if context isn't running (no user gesture yet)
  if (ctx.state !== 'running') {
    console.warn('[Sound] ⚠️ Cannot play - context not running:', ctx.state);
    return;
  }
  
  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    
    // Volume control - INCREASED from 0.1 to 0.3
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + duration / 1000);
    console.log('[Sound] ✅ Beep playing');
  } catch (err) {
    console.error('[Sound] ❌ Error playing beep:', err);
  }
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
