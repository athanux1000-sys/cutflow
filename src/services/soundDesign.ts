import { SoundCueEvent, SoundEffectType } from '../types/project';

let sharedPreviewAudioCtx: AudioContext | null = null;

function getPreviewAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!sharedPreviewAudioCtx || sharedPreviewAudioCtx.state === 'closed') {
    sharedPreviewAudioCtx = new AudioContext();
  }
  if (sharedPreviewAudioCtx.state === 'suspended') {
    void sharedPreviewAudioCtx.resume().catch(() => {});
  }
  return sharedPreviewAudioCtx;
}

/**
 * Synthesizes clean, procedural, license-free UI/editorial sound cues directly into any BaseAudioContext
 * (works identically for live AudioContext preview and OfflineAudioContext MP4 export).
 */
export function scheduleProceduralSoundCue(
  ctx: BaseAudioContext,
  destination: AudioNode,
  effect: SoundEffectType,
  startTimeSec: number,
  volume = 0.25
): void {
  if (effect === 'none' || volume <= 0) return;

  const t = Math.max(0, startTimeSec);
  const gain = ctx.createGain();
  gain.connect(destination);

  if (effect === 'soft-pop') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(190, t + 0.085);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(volume * 0.7, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);

    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.11);
    return;
  }

  if (effect === 'subtle-tick') {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(650, t + 0.035);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(volume * 0.45, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.055);
    return;
  }

  if (effect === 'impact-hit') {
    // Low punch sine + filtered burst
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.24);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(volume * 0.95, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.3);
    return;
  }

  if (effect === 'whoosh-in') {
    const duration = 0.22;
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.exponentialRampToValueAtTime(2200, t + duration * 0.75);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(volume * 0.6, t + duration * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    noise.start(t);
    noise.stop(t + duration + 0.02);
  }
}

export function playPreviewSoundCue(effect: SoundEffectType, volume = 0.25): void {
  const ctx = getPreviewAudioContext();
  if (!ctx) return;
  scheduleProceduralSoundCue(ctx, ctx.destination, effect, ctx.currentTime + 0.01, volume);
}

export function scheduleSoundCuesInOfflineContext(
  offline: OfflineAudioContext,
  cues: SoundCueEvent[],
  durationSec: number
): boolean {
  let scheduled = false;
  for (const cue of cues) {
    if (cue.effect === 'none' || cue.timeSec < 0 || cue.timeSec >= durationSec) continue;
    scheduleProceduralSoundCue(offline, offline.destination, cue.effect, cue.timeSec, cue.volume);
    scheduled = true;
  }
  return scheduled;
}
