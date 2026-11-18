import {
  CutFlowProject,
  MediaAssetRef,
  OverlayLayer,
  TextLayer,
  TimelineClip,
} from '../types/project';
import { evaluateTextLayerMotion, EvaluatedMotionState } from '../utils/motionPhysics';
import {
  computeDrawRect,
  getActiveElementsAtTime,
  mapTimelineTimeToSourceTime,
} from '../utils/timelineMath';
import { mediaUrlRegistry } from './mediaEngine';

export interface LoadedMediaHandle {
  asset: MediaAssetRef;
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  audio?: HTMLAudioElement;
}

let cachedGrainCanvas: HTMLCanvasElement | null = null;
function getGrainTileCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (cachedGrainCanvas) return cachedGrainCanvas;
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  const img = tctx.createImageData(128, 128);
  let seed = 1337;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = (seed >>> 24) & 0xff;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 36;
  }
  tctx.putImageData(img, 0, 0);
  cachedGrainCanvas = tile;
  return tile;
}

export class ProjectMediaPool {
  private handles = new Map<string, LoadedMediaHandle>();
  private loading = new Map<string, Promise<LoadedMediaHandle | null>>();

  async ensureLoaded(asset: MediaAssetRef): Promise<LoadedMediaHandle | null> {
    const existing = this.handles.get(asset.id);
    if (existing) return existing;

    const inflight = this.loading.get(asset.id);
    if (inflight) return inflight;

    const task = (async () => {
      try {
        const url = await mediaUrlRegistry.getUrl(asset);
        if (!url) return null;

        if (asset.type === 'video') {
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Video load timeout')), 12000);
            video.onloadeddata = () => {
              clearTimeout(timeout);
              resolve();
            };
            video.onerror = () => {
              clearTimeout(timeout);
              reject(new Error('Video decode error'));
            };
            video.src = url;
          });
          const handle: LoadedMediaHandle = { asset, video };
          this.handles.set(asset.id, handle);
          return handle;
        }

        if (asset.type === 'image') {
          const image = new Image();
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Image load error'));
            image.src = url;
          });
          const handle: LoadedMediaHandle = { asset, image };
          this.handles.set(asset.id, handle);
          return handle;
        }

        if (asset.type === 'audio') {
          const audio = document.createElement('audio');
          audio.preload = 'auto';
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => resolve(), 5000);
            audio.onloadedmetadata = () => {
              clearTimeout(timeout);
              resolve();
            };
            audio.onerror = () => {
              clearTimeout(timeout);
              resolve();
            };
            audio.src = url;
          });
          const handle: LoadedMediaHandle = { asset, audio };
          this.handles.set(asset.id, handle);
          return handle;
        }

        return null;
      } catch {
        return null;
      } finally {
        this.loading.delete(asset.id);
      }
    })();

    this.loading.set(asset.id, task);
    return task;
  }

  getCached(mediaId: string): LoadedMediaHandle | undefined {
    return this.handles.get(mediaId);
  }

  async preloadProject(project: CutFlowProject): Promise<void> {
    await Promise.all(project.media.map((m) => this.ensureLoaded(m)));
  }

  dispose(): void {
    for (const handle of this.handles.values()) {
      if (handle.video) {
        handle.video.pause();
        handle.video.src = '';
        handle.video.load();
      }
      if (handle.audio) {
        handle.audio.pause();
        handle.audio.src = '';
        handle.audio.load();
      }
    }
    this.handles.clear();
    this.loading.clear();
  }
}

export async function seekVideoElement(video: HTMLVideoElement, targetTime: number): Promise<void> {
  const maxSeekable =
    video.seekable && video.seekable.length > 0
      ? video.seekable.end(video.seekable.length - 1)
      : Number.isFinite(video.duration)
        ? video.duration
        : targetTime;
  const clamped = Math.max(0, Math.min(targetTime, Math.max(0, maxSeekable - 0.02)));
  if (Math.abs(video.currentTime - clamped) < 0.02 && video.readyState >= 2) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const onSeeked = () => {
      finish();
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    const timer = setTimeout(finish, 45);
    video.addEventListener('seeked', onSeeked, { once: true });
    try {
      video.currentTime = clamped;
    } catch {
      finish();
    }
  });
}

function buildFilterString(clip: TimelineClip): string {
  const c = clip.color;
  const exposureMul = Math.pow(2, c.exposure ?? 0) * (c.gain ?? 1);
  const b =
    (100 +
      c.brightness * 80 +
      (c.shadows ?? 0) * 18 +
      (c.whites ?? 0) * 14 -
      (c.blacks ?? 0) * 10 +
      (c.lift ?? 0) * 30) *
    exposureMul;
  const contrastVal =
    100 +
    c.contrast * 80 +
    (c.highlights ?? 0) * 12 +
    (c.sharpen ?? 0) * 8 +
    ((c.gamma ?? 1) - 1) * -28;
  const satVal = 100 + c.saturation * 100 + (c.vibrance ?? 0) * 55;
  const blur = Math.max(0, c.blur);

  const parts: string[] = [];
  if (Math.abs(b - 100) > 0.5) parts.push(`brightness(${Math.max(15, b).toFixed(1)}%)`);
  if (Math.abs(contrastVal - 100) > 0.5) parts.push(`contrast(${Math.max(25, contrastVal).toFixed(1)}%)`);
  if (Math.abs(satVal - 100) > 0.5) parts.push(`saturate(${Math.max(0, satVal).toFixed(1)}%)`);
  if (blur > 0.1) parts.push(`blur(${blur.toFixed(1)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

function applyPostColorPasses(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  canvasWidth: number,
  canvasHeight: number
): void {
  const temp = clip.color.temperature ?? 0;
  const tint = clip.color.tint ?? 0;
  const vignette = clip.color.vignette ?? 0;
  const lift = clip.color.lift ?? 0;
  const grain = clip.color.grain ?? 0;

  if (Math.abs(lift) > 0.015) {
    ctx.save();
    ctx.globalCompositeOperation = lift > 0 ? 'screen' : 'multiply';
    ctx.globalAlpha = Math.min(0.4, Math.abs(lift) * 0.65);
    ctx.fillStyle = lift > 0 ? '#2D3440' : '#060709';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  if (Math.abs(temp) > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.45, Math.abs(temp) * 0.42);
    ctx.fillStyle = temp > 0 ? '#FF9D4D' : '#4D94FF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  if (Math.abs(tint) > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.35, Math.abs(tint) * 0.35);
    ctx.fillStyle = tint > 0 ? '#E852C9' : '#45D17A';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  if (grain > 0.02) {
    const tile = getGrainTileCanvas();
    if (tile) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(0.6, grain * 0.75);
      const pattern = ctx.createPattern(tile, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      ctx.restore();
    }
  }

  if (vignette > 0.01) {
    ctx.save();
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const r = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, vignette * 0.85).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }
}

function drawOverlayLayer(
  ctx: CanvasRenderingContext2D,
  overlay: OverlayLayer,
  canvasWidth: number,
  canvasHeight: number,
  pool: ProjectMediaPool
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, overlay.opacity));
  ctx.translate(canvasWidth / 2 + overlay.x * canvasWidth, canvasHeight / 2 + overlay.y * canvasHeight);
  ctx.rotate((overlay.rotation * Math.PI) / 180);
  ctx.scale(overlay.scale, overlay.scale);

  const w = overlay.width * canvasWidth;
  const h = overlay.height * canvasHeight;

  if (overlay.kind === 'image' && overlay.mediaId) {
    const imgHandle = pool.getCached(overlay.mediaId);
    if (imgHandle?.image) {
      ctx.drawImage(imgHandle.image, -w / 2, -h / 2, w, h);
    }
  } else {
    ctx.fillStyle = overlay.fillColor;
    ctx.strokeStyle = overlay.strokeColor;
    ctx.lineWidth = overlay.strokeWidth;

    if (overlay.shapeType === 'circle') {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (overlay.fillColor !== 'transparent') ctx.fill();
      if (overlay.strokeWidth > 0) ctx.stroke();
    } else if (overlay.shapeType === 'line') {
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.stroke();
    } else {
      const r = overlay.shapeType === 'lower-third' ? 12 : 4;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, r);
      if (overlay.fillColor !== 'transparent') ctx.fill();
      if (overlay.strokeWidth > 0) ctx.stroke();
    }
  }
  ctx.restore();
}

function formatTextWithCase(text: string, textCase?: 'none' | 'upper' | 'title'): string {
  if (textCase === 'upper') return text.toUpperCase();
  if (textCase === 'title') {
    return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return text;
}

function drawTextLayerPass(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  canvasWidth: number,
  canvasHeight: number,
  motion: EvaluatedMotionState,
  extraOffsetX = 0,
  alphaScale = 1
): void {
  if (!layer.text.trim()) return;
  const rawTransformed = formatTextWithCase(layer.text, layer.textCase);

  let displayText = rawTransformed;
  if (motion.visibleWordCount !== null) {
    const tokens = rawTransformed.trim().split(/\s+/);
    displayText = tokens.slice(0, motion.visibleWordCount).join(' ');
    if (!displayText) return;
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * motion.opacityMul * alphaScale));
  if (motion.blurPx > 0.15) {
    ctx.filter = `blur(${motion.blurPx.toFixed(1)}px)`;
  }

  const px = canvasWidth / 2 + (layer.x + motion.xOffset + extraOffsetX) * canvasWidth;
  const py = canvasHeight / 2 + (layer.y + motion.yOffset) * canvasHeight;
  ctx.translate(px, py);
  ctx.rotate(((layer.rotation + motion.rotationDeg) * Math.PI) / 180);
  const finalScale = Math.max(0.05, layer.scale * motion.scaleMul);
  ctx.scale(finalScale, finalScale);

  const scaledFontSize = Math.max(12, Math.round(layer.fontSize * (canvasHeight / 1080)));
  ctx.font = `${layer.fontWeight} ${scaledFontSize}px "${layer.fontFamily}", "Inter", "IBM Plex Sans", sans-serif`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';

  const totalSpacingPx = (layer.letterSpacing ?? 0) + motion.letterSpacingDelta;
  if ('letterSpacing' in ctx && Math.abs(totalSpacingPx) > 0.1) {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${totalSpacingPx.toFixed(1)}px`;
  }

  const maxWidth = canvasWidth * 0.84;
  const rawLines = displayText.split('\n');
  const lines: string[] = [];
  for (const rl of rawLines) {
    if (ctx.measureText(rl).width <= maxWidth) {
      lines.push(rl);
    } else {
      const words = rl.split(/\s+/);
      let current = '';
      for (const w of words) {
        const next = current ? `${current} ${w}` : w;
        if (ctx.measureText(next).width > maxWidth && current) {
          lines.push(current);
          current = w;
        } else {
          current = next;
        }
      }
      if (current) lines.push(current);
    }
  }

  const lineHeight = scaledFontSize * (layer.lineHeight ?? 1.25);
  const totalHeight = lines.length * lineHeight;
  const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const padX = scaledFontSize * 0.48;
  const padY = scaledFontSize * 0.24;
  const boxW = maxLineW + padX * 2;
  const boxH = totalHeight + padY * 2;
  let boxX = -boxW / 2;
  if (layer.align === 'left') boxX = -padX;
  if (layer.align === 'right') boxX = -boxW + padX;
  const boxY = -totalHeight / 2 - padY;

  if (motion.clipRatio < 0.999) {
    ctx.beginPath();
    ctx.rect(boxX - 4, boxY - 4, (boxW + 8) * Math.max(0.02, motion.clipRatio), boxH + 8);
    ctx.clip();
  }

  if (layer.backgroundColor && layer.backgroundColor !== 'transparent') {
    ctx.fillStyle = layer.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, layer.cornerRadius ?? 8);
    ctx.fill();
  }

  if ((layer.shadowBlur ?? 0) > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = layer.shadowBlur ?? 0;
    ctx.shadowOffsetY = 2;
  }

  ctx.fillStyle = layer.color;
  lines.forEach((line, idx) => {
    const yOffset = -totalHeight / 2 + lineHeight * (idx + 0.5);
    if ((layer.strokeWidth ?? 0) > 0 && layer.strokeColor) {
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth ?? 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, 0, yOffset);
    }
    ctx.fillText(line, 0, yOffset);
  });

  ctx.restore();
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  canvasWidth: number,
  canvasHeight: number,
  timeSec: number
): void {
  if (!layer.text.trim()) return;
  const motion = evaluateTextLayerMotion(layer, timeSec);

  if (motion.trailGhosts > 0) {
    for (let g = motion.trailGhosts; g >= 1; g--) {
      drawTextLayerPass(
        ctx,
        layer,
        canvasWidth,
        canvasHeight,
        motion,
        -g * 0.014,
        0.22 / g
      );
    }
  }

  drawTextLayerPass(ctx, layer, canvasWidth, canvasHeight, motion, 0, 1);
}

export function drawPreviewGuides(
  ctx: CanvasRenderingContext2D,
  project: CutFlowProject,
  timeSec: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.strokeRect(canvasWidth * 0.05, canvasHeight * 0.05, canvasWidth * 0.9, canvasHeight * 0.9);
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.35)';
  ctx.strokeRect(canvasWidth * 0.1, canvasHeight * 0.1, canvasWidth * 0.8, canvasHeight * 0.8);

  const scene = project.sceneMap?.scenes.find((s) => timeSec >= s.startSec && timeSec <= s.endSec);
  if (scene) {
    ctx.setLineDash([]);
    for (const face of scene.faceBoxes) {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
      ctx.strokeRect(
        face.x * canvasWidth,
        face.y * canvasHeight,
        face.width * canvasWidth,
        face.height * canvasHeight
      );
    }
    for (const mouth of scene.mouthBoxes) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.fillRect(
        mouth.x * canvasWidth,
        mouth.y * canvasHeight,
        mouth.width * canvasWidth,
        mouth.height * canvasHeight
      );
      ctx.strokeRect(
        mouth.x * canvasWidth,
        mouth.y * canvasHeight,
        mouth.width * canvasWidth,
        mouth.height * canvasHeight
      );
    }
  }
  ctx.restore();
}

export async function renderProjectFrame(params: {
  ctx: CanvasRenderingContext2D;
  project: CutFlowProject;
  timeSec: number;
  pool: ProjectMediaPool;
  canvasWidth: number;
  canvasHeight: number;
  seekVideos: boolean;
  backgroundColor?: string;
  showGuides?: boolean;
}): Promise<void> {
  const {
    ctx,
    project,
    timeSec,
    pool,
    canvasWidth,
    canvasHeight,
    seekVideos,
    backgroundColor,
    showGuides = false,
  } = params;

  ctx.save();
  ctx.fillStyle = backgroundColor ?? '#0B0C0E';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const { clips, texts, overlays } = getActiveElementsAtTime(project, timeSec);

  for (const clip of clips) {
    if (clip.kind === 'audio') continue;
    const asset = project.media.find((m) => m.id === clip.mediaId);
    if (!asset) continue;
    const handle = await pool.ensureLoaded(asset);
    if (!handle) continue;

    let sourceEl: HTMLVideoElement | HTMLImageElement | null = null;
    let srcW = asset.width || 1280;
    let srcH = asset.height || 720;

    if (clip.kind === 'video' && handle.video) {
      if (seekVideos) {
        const sourceTime = mapTimelineTimeToSourceTime(clip, timeSec);
        await seekVideoElement(handle.video, sourceTime);
      }
      sourceEl = handle.video;
      srcW = handle.video.videoWidth || srcW;
      srcH = handle.video.videoHeight || srcH;
    } else if (clip.kind === 'image' && handle.image) {
      sourceEl = handle.image;
      srcW = handle.image.naturalWidth || srcW;
      srcH = handle.image.naturalHeight || srcH;
    }

    if (!sourceEl) continue;

    let transitionOpacity = 1;
    let transitionYOffset = 0;
    if (clip.transitionIn && clip.transitionIn.type !== 'none' && clip.transitionIn.durationSec > 0) {
      const elapsed = timeSec - clip.startTime;
      if (elapsed < clip.transitionIn.durationSec) {
        const p = Math.max(0, Math.min(1, elapsed / clip.transitionIn.durationSec));
        if (clip.transitionIn.type === 'fade') transitionOpacity = p;
        if (clip.transitionIn.type === 'slide-up') {
          transitionOpacity = p;
          transitionYOffset = (1 - p) * 0.08 * canvasHeight;
        }
      }
    }

    const geom = computeDrawRect(srcW, srcH, canvasWidth, canvasHeight, clip.transform);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, clip.transform.opacity * transitionOpacity));
    const filterStr = buildFilterString(clip);
    if (filterStr !== 'none') {
      ctx.filter = filterStr;
    }
    ctx.translate(
      canvasWidth / 2 + clip.transform.x * canvasWidth,
      canvasHeight / 2 + clip.transform.y * canvasHeight + transitionYOffset
    );
    ctx.rotate((clip.transform.rotation * Math.PI) / 180);

    try {
      ctx.drawImage(sourceEl, geom.sx, geom.sy, geom.sw, geom.sh, geom.dx, geom.dy, geom.dw, geom.dh);
    } catch {
      // Ignore frame draw if video frame is not ready yet
    }
    ctx.restore();

    applyPostColorPasses(ctx, clip, canvasWidth, canvasHeight);
  }

  for (const overlay of overlays) {
    if (overlay.kind === 'image' && overlay.mediaId) {
      const asset = project.media.find((m) => m.id === overlay.mediaId);
      if (asset) await pool.ensureLoaded(asset);
    }
    drawOverlayLayer(ctx, overlay, canvasWidth, canvasHeight, pool);
  }

  for (const text of texts) {
    drawTextLayer(ctx, text, canvasWidth, canvasHeight, timeSec);
  }

  if (showGuides) {
    drawPreviewGuides(ctx, project, timeSec, canvasWidth, canvasHeight);
  }

  ctx.restore();
}
