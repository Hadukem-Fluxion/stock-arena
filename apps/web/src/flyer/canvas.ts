import {
  GAME_CONFIG,
  flyerPipe,
  flyerCoins,
  flyerCoinGroup,
  isFlapFlyer,
  flyerProgress,
  flyerBirdAngle,
} from "@stock-arena/game-core";
import type { FlyerCourse, FlyerState } from "@stock-arena/game-core";
import { flyerRenderer as legacyRenderer } from "./canvas-v1.js";
import { buildingColor, logoCache } from "./visuals.js";
import { FLYER_BRAND } from "./brand.js";
import { en } from "../copy/en.js";
const c = GAME_CONFIG.flyer,
  ground = 24;
export function flyerRenderer(
  canvas: HTMLCanvasElement,
  course: FlyerCourse,
  options: { discord?: boolean; lobby?: boolean } = {},
) {
  if (course.version === "flyer-1") return legacyRenderer(canvas, course);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable.");
  const ctx = context,
    ratio = Math.min(devicePixelRatio || 1, 2),
    motion = matchMedia("(prefers-reduced-motion: reduce)"),
    logos = logoCache(!!options.discord);
  canvas.width = c.width * ratio;
  canvas.height = (c.height + ground) * ratio;
  const v3 = isFlapFlyer(course);
  const bird = new Image();
  bird.src = v3 ? FLYER_BRAND.v3BirdSrc : FLYER_BRAND.birdSrc;
  const sky = ctx.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, "#76c9fb");
  sky.addColorStop(0.58, "#cbeef5");
  sky.addColorStop(1, "#f4ead8");
  let lastScore = 0,
    lastCoins = 0,
    coinAt = -100,
    scoreAt = -100,
    hitAt = 0;
  const trail: { x: number; y: number }[] = [];
  function rounded(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string,
    stroke?: string,
  ) {
    if (h <= 0 || w <= 0) return;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  function cloud(x: number, y: number, size: number) {
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.beginPath();
    ctx.ellipse(x, y, size * 1.3, size * 0.29, 0, 0, Math.PI * 2);
    ctx.ellipse(x - size * 0.3, y - size * 0.15, size * 0.55, size * 0.35, 0, 0, Math.PI * 2);
    ctx.ellipse(x + size * 0.25, y - size * 0.1, size * 0.55, size * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function direction(x: number, y: number, change: string) {
    const positive = Number(change) > 0,
      negative = Number(change) < 0;
    ctx.strokeStyle = "#193e56";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (!positive && !negative) {
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.stroke();
      return;
    }
    ctx.moveTo(x, positive ? y - 4 : y + 4);
    ctx.lineTo(x - 5, positive ? y + 3 : y - 3);
    ctx.lineTo(x + 5, positive ? y + 3 : y - 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  function building(
    x: number,
    y: number,
    h: number,
    color: string,
    upper: boolean,
    change: string,
  ) {
    if (h <= 0) return;
    rounded(x, y, c.pipeWidth, h, 7, color);
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.fillRect(x + 3, y + 8, 5, Math.max(0, h - 8));
    ctx.fillStyle = "rgba(255,255,255,.62)";
    for (let yy = y + 24; yy < y + h - 14; yy += 24)
      for (let xx = x + 12; xx < x + c.pipeWidth - 7; xx += 17) ctx.fillRect(xx, yy, 5, 8);
    const capY = upper ? y + h - 16 : y;
    rounded(x, capY, c.pipeWidth, 16, 5, color);
    ctx.fillStyle = "rgba(0,0,0,.1)";
    ctx.fillRect(x + 3, capY + 12, c.pipeWidth - 6, 3);
    if (upper) direction(x + c.pipeWidth / 2, capY + 7, change);
  }
  function badge(x: number, y: number, url: string) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#264e64";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();
    const logo = logos.get(url);
    if (logo?.complete && logo.naturalWidth) {
      const side = Math.min(logo.naturalWidth, logo.naturalHeight),
        sx = (logo.naturalWidth - side) / 2,
        sy = (logo.naturalHeight - side) / 2;
      ctx.drawImage(logo, sx, sy, side, side, x - 11, y - 11, 22, 22);
    } else {
      ctx.strokeStyle = "#7c8b9e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 4);
      ctx.lineTo(x - 2, y);
      ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + 7, y - 5);
      ctx.stroke();
    }
    ctx.restore();
  }
  function outlined(text: string, x: number, y: number, size: number, fill = "#fff") {
    ctx.font = `700 ${size}px "Space Grotesk",sans-serif`;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size / 12);
    ctx.strokeStyle = "#214759";
    ctx.fillStyle = fill;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }
  return (state: FlyerState) => {
    const reduced = motion.matches,
      tick = state.tick,
      now = performance.now();
    if ((state.coins ?? 0) > lastCoins) {
      lastCoins = state.coins ?? 0;
      coinAt = tick;
    }
    if (state.score !== lastScore) {
      lastScore = state.score;
      scoreAt = tick;
    }
    if (state.ended && !hitAt) hitAt = now;
    const collision = hitAt ? Math.max(0, 1 - (now - hitAt) / 240) : 0;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height + ground);
    ctx.save();
    if (!reduced && collision)
      ctx.translate(Math.sin(now * 0.13) * 3 * collision, Math.cos(now * 0.11) * 2 * collision);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, c.width, c.height + ground);
    ctx.fillStyle = "#fff4bd";
    ctx.beginPath();
    ctx.arc(282, 85, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,247,206,.22)";
    ctx.beginPath();
    ctx.arc(282, 85, 48, 0, Math.PI * 2);
    ctx.fill();
    const distance = state.distance / c.scale;
    for (let i = 0; i < 5; i++)
      cloud(
        ((((i * 123 + 70 - (reduced ? 0 : distance * 0.09)) % 560) + 560) % 560) - 80,
        70 + (i % 3) * 49,
        22 + (i % 2) * 8,
      );
    for (let i = 0; i < 16; i++) {
      const x = ((((i * 41 - (reduced ? 0 : distance * 0.2)) % 656) + 656) % 656) - 80,
        h = 26 + ((i * 23) % 62);
      ctx.fillStyle = i % 2 ? "#bfcbdc" : "#cdd7e1";
      ctx.fillRect(x, c.height - h, 30, h);
    }
    const progress = flyerProgress(course, state);
    const first = Math.max(0, progress - 1);
    for (let i = first; i <= progress + 3; i++) {
      const pipe = flyerPipe(course, i, state.distance),
        x = pipe.x / c.scale,
        top = (pipe.center - pipe.gap / 2) / c.scale,
        bottom = (pipe.center + pipe.gap / 2) / c.scale;
      if (x > c.width + 30 || x + c.pipeWidth < -30) continue;
      const color = buildingColor(pipe.segment.asset.primaryColor);
      if (!options.lobby) building(x, -12, top + 12, color, true, pipe.segment.changePct);
      building(x, bottom, c.height - bottom, color, false, pipe.segment.changePct);
      if (!options.lobby) badge(x + c.pipeWidth / 2, top - 34, pipe.segment.asset.logo);
      // Legacy decorative coins are preserved only for the old replay.
      const coinX = x + c.pipeSpacing * 0.55,
        coinY = pipe.center / c.scale - 42 + (reduced ? 0 : Math.sin(tick * 0.09 + i) * 3);
      if (!v3 && coinX > c.birdX - 8 && coinX < c.width) {
        ctx.fillStyle = "#ffdf41";
        ctx.strokeStyle = "#d69b13";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(coinX, coinY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fff3b0";
        ctx.fillRect(coinX - 1, coinY - 3, 2, 6);
      }
    }
    if (v3) {
      const group = flyerCoinGroup(course, progress);
      for (let g = Math.max(0, group - 1); g <= group + 1; g++)
        for (const coin of flyerCoins(course, g)) {
          if (state.collected?.includes(coin.id)) continue;
          const x = (coin.x - state.distance) / c.scale,
            y = coin.y / c.scale;
          if (x < -10 || x > c.width + 10) continue;
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(reduced ? 1 : 0.65 + 0.35 * Math.abs(Math.cos(tick * 0.09)), 1);
          ctx.fillStyle = "#ffda43";
          ctx.strokeStyle = "#ad7200";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, c.v3.coinRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fff5bf";
          ctx.fillRect(-1, -4, 2, 8);
          ctx.restore();
        }
    }
    if (!reduced && !state.ended) {
      trail.push({ x: c.birdX, y: state.y / c.scale });
      if (trail.length > 8) trail.shift();
    }
    if (!reduced)
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i]!;
        ctx.fillStyle = `rgba(255,255,255,${(i / trail.length) * 0.32})`;
        ctx.beginPath();
        ctx.arc(p.x - (trail.length - i) * 4, p.y, 2 + i * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    ctx.save();
    ctx.translate(options.lobby ? 145 : c.birdX, state.y / c.scale);
    if (options.lobby) ctx.scale(1.55, 1.55);
    ctx.rotate(
      reduced
        ? 0
        : v3
          ? (flyerBirdAngle(state.velocity) * Math.PI) / 180
          : Math.max(-0.36, Math.min(0.5, state.velocity / 9000)),
    );
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#134d54";
    ctx.fillStyle = v3 ? "#20c997" : "#22cdb0";
    const wing = reduced ? 0 : Math.sin(tick * 0.45) * 4;
    ctx.beginPath();
    ctx.ellipse(-11, wing, 8, 4, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, c.birdRadius + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (bird.complete && bird.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(bird, -9, -9, 18, 18);
      ctx.restore();
    }
    ctx.fillStyle = "#f4fff9";
    ctx.beginPath();
    ctx.ellipse(-3, wing + 4, 6, 3, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (v3) {
      ctx.fillStyle = "#ff9a35";
      ctx.beginPath();
      ctx.moveTo(12, -2);
      ctx.lineTo(23, 3);
      ctx.lineTo(12, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      rounded(3, -14, 15, 8, 4, "#143342", "#10333a");
      rounded(7, -12, 7, 2, 1, "#90ffd7");
    }
    ctx.restore();
    ctx.fillStyle = "#8ad02b";
    ctx.fillRect(0, c.height, c.width, ground);
    ctx.fillStyle = "#60ab1d";
    ctx.fillRect(0, c.height, c.width, 4);
    if (!v3) outlined(String(state.score), c.width / 2, 76, 60);
    if (!reduced && tick - scoreAt < 35) {
      const phase = (tick - scoreAt) / 35;
      ctx.globalAlpha = 1 - phase;
      // Gold identifies a real pickup; legacy pipe points remain white.
      if (v3 && tick - coinAt < 35) ctx.shadowColor = "#ffd342";
      outlined(
        en.flyer.pipePoint,
        c.birdX + 28,
        state.y / c.scale - 25 - phase * 25,
        22,
        v3 && tick - coinAt < 35 ? "#ffda43" : "#fff",
      );
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.fillStyle = i % 2 ? "#ffd84f" : "#fff";
        ctx.beginPath();
        ctx.arc(
          c.birdX + Math.cos(a) * phase * 35,
          state.y / c.scale + Math.sin(a) * phase * 35,
          2 * (1 - phase),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    if (!v3 && tick < c.countdownSeconds * c.ticksPerSecond)
      outlined(
        String(c.countdownSeconds - Math.floor(tick / c.ticksPerSecond)),
        c.width / 2,
        c.height / 2 + 20,
        88,
      );
    if (!v3) {
      rounded(56, c.height - 39, 248, 24, 12, "#163b55");
      ctx.fillStyle = "#fff";
      ctx.font = '600 11px "IBM Plex Sans",sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(en.flyer.daylightHint, c.width / 2, c.height - 23);
    }
    if (!reduced && collision) {
      ctx.fillStyle = `rgba(255,255,255,${collision * 0.45})`;
      ctx.fillRect(0, 0, c.width, c.height + ground);
    }
    ctx.restore();
  };
}
