import { GAME_CONFIG } from "@stock-arena/game-core";
import type { FlyerState } from "@stock-arena/game-core";
import type { PlatformAdapter } from "../platform/types.js";
/** Audio is constructed/resumed only inside the first deliberate user gesture. */
export function flyerFeedback(
  platform: PlatformAdapter,
  options: { createAudio?: () => AudioContext; reducedMotion?: () => boolean } = {},
) {
  let audio: AudioContext | undefined,
    muted = false,
    lastScore = 0,
    lastCoins = 0,
    lastCountdown = 0,
    hit = false;
  const media =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
  const reduced = options.reducedMotion ?? (() => media?.matches ?? false);
  function tone(frequency: number, duration: number) {
    if (muted || audio?.state !== "running") return;
    try {
      const oscillator = audio.createOscillator(),
        gain = audio.createGain(),
        at = audio.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.035, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + duration);
    } catch {
      /* Optional feedback must never interrupt the simulation. */
    }
  }
  function haptic(kind: "score" | "collision") {
    try {
      if (platform.host === "telegram" && !reduced()) platform.haptic?.(kind);
    } catch {
      /* Optional host feature. */
    }
  }
  return {
    unlock() {
      if (muted) return;
      try {
        audio ??= options.createAudio ? options.createAudio() : new AudioContext();
        void audio.resume().catch(() => {});
      } catch {
        /* Sound is optional on host webviews. */
      }
    },
    mute(value: boolean) {
      muted = value;
      if (muted) void audio?.suspend().catch(() => {});
      else this.unlock();
    },
    reset() {
      lastScore = 0;
      lastCoins = 0;
      lastCountdown = 0;
      hit = false;
    },
    frame(state: FlyerState) {
      const countdown = Math.max(
        0,
        GAME_CONFIG.flyer.countdownSeconds -
          Math.floor(state.tick / GAME_CONFIG.flyer.ticksPerSecond),
      );
      if (countdown !== lastCountdown) {
        lastCountdown = countdown;
        if (countdown && state.started === undefined)
          tone(520 + (GAME_CONFIG.flyer.countdownSeconds - countdown) * 90, 0.065);
      }
      if (state.score > lastScore) {
        lastScore = state.score;
        tone((state.coins ?? 0) > lastCoins ? 1320 : 940, 0.085);
        lastCoins = state.coins ?? 0;
        haptic("score");
      }
      if (state.ended && !hit) {
        hit = true;
        tone(140, 0.12);
        haptic("collision");
      }
    },
    dispose() {
      void audio?.close().catch(() => {});
    },
  };
}
