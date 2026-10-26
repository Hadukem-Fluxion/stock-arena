import { GAME_CONFIG, flyerPipe } from "@stock-arena/game-core";
import type { FlyerCourse, FlyerState } from "@stock-arena/game-core";
import { en } from "../copy/en.js";
import { FLYER_BRAND } from "./brand.js";
const c = GAME_CONFIG.flyer;
export function flyerRenderer(canvas: HTMLCanvasElement, course: FlyerCourse) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");
  const style = getComputedStyle(document.documentElement),
    color = (token: string) => style.getPropertyValue(token).trim();
  const colors = {
    bg: color("--bg"),
    surface: color("--surface-2"),
    line: color("--line"),
    accent: color("--accent"),
    text: color("--text"),
    muted: color("--muted"),
  };
  const bird = new Image();
  bird.src = FLYER_BRAND.birdSrc;
  const badges = new Map<string, HTMLImageElement>();
  for (const segment of course.segments)
    if (!badges.has(segment.asset.provider)) {
      const img = new Image();
      img.src = en.providers[segment.asset.provider].badgeSrc;
      badges.set(segment.asset.provider, img);
    }
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = c.width * ratio;
  canvas.height = c.height * ratio;
  return (state: FlyerState) => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    for (let y = 40; y < c.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = colors.accent;
    ctx.setLineDash([3, 6]);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (let i = Math.max(0, state.score - 1); i <= state.score + 3; i++) {
      const p = flyerPipe(course, i, state.distance);
      if (i === Math.max(0, state.score - 1)) ctx.moveTo(p.x / c.scale, p.center / c.scale);
      else ctx.lineTo(p.x / c.scale, p.center / c.scale);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (let i = Math.max(0, state.score - 1); i <= state.score + 3; i++) {
      const p = flyerPipe(course, i, state.distance),
        x = p.x / c.scale,
        top = (p.center - p.gap / 2) / c.scale,
        bottom = (p.center + p.gap / 2) / c.scale;
      ctx.fillStyle = colors.surface;
      ctx.fillRect(x, 0, c.pipeWidth, top);
      ctx.fillRect(x, bottom, c.pipeWidth, c.height - bottom);
      ctx.strokeStyle = colors.line;
      ctx.strokeRect(x, 0, c.pipeWidth, top);
      ctx.strokeRect(x, bottom, c.pipeWidth, c.height - bottom);
      const badge = badges.get(p.segment.asset.provider);
      if (badge?.complete && badge.naturalWidth) {
        const sy = Math.min(30, Math.max(2, top - 30));
        ctx.drawImage(badge, x + 12, sy, 24, 24);
      }
    }
    ctx.save();
    ctx.translate(c.birdX, state.y / c.scale);
    ctx.rotate(Math.max(-0.35, Math.min(0.45, state.velocity / 10000)));
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(0, 0, c.birdRadius + 3, 0, Math.PI * 2);
    ctx.fill();
    if (bird.complete && bird.naturalWidth)
      ctx.drawImage(bird, -c.birdRadius, -c.birdRadius, 2 * c.birdRadius, 2 * c.birdRadius);
    ctx.restore();
    ctx.fillStyle = colors.muted;
    ctx.font = '12px "IBM Plex Sans",sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(en.flyer.hint, c.width / 2, c.height - 14);
  };
}
