import { useEffect, useRef } from 'react';
import { CutFlowTemplateManifest, TemplateDefinition } from '../types/project';
import { templateDefinitionToManifest } from '../services/templateSchema';

interface TemplatePreviewRendererProps {
  template?: TemplateDefinition;
  manifest?: CutFlowTemplateManifest;
  className?: string;
}

/**
 * Live-renders the composition layout, matte inset, framing border, colour grade mood,
 * kicker badge, and paired typography onto an HTML5 canvas. Never uses stock photography.
 */
export function TemplatePreviewRenderer({
  template,
  manifest: explicitManifest,
  className = 'w-full h-full',
}: TemplatePreviewRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const manifest = explicitManifest ?? (template ? templateDefinitionToManifest(template) : null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 360;
    const h = 480;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Matte background
    ctx.fillStyle = manifest.designSystem.backgroundColor || '#0B0C0E';
    ctx.fillRect(0, 0, w, h);

    // 2. Determine inner video frame rect according to aspect & frameInset
    const inset = Math.max(0.01, Math.min(0.22, manifest.designSystem.frameInset));
    let frameW = w * (1 - inset * 2);
    let frameH = h * (1 - inset * 2);
    if (manifest.defaultAspectRatio === '16:9') {
      frameH = Math.min(frameH, frameW * (9 / 16));
    } else if (manifest.defaultAspectRatio === '1:1') {
      const sq = Math.min(frameW, frameH * 0.78);
      frameW = sq;
      frameH = sq;
    }
    const frameX = (w - frameW) / 2;
    const frameY = (h - frameH) / 2;
    const radius = Math.min(24, manifest.designSystem.frameRadius);

    // 3. Draw abstract studio stage gradient representing graded footage inside frame
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(frameX, frameY, frameW, frameH, radius);
    ctx.clip();

    const temp = manifest.colour.temperature ?? 0;
    const contrastBoost = manifest.colour.contrast ?? 0;
    const stageGrad = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
    stageGrad.addColorStop(
      0,
      temp > 0.05 ? '#2B2118' : temp < -0.05 ? '#152232' : '#1B1F27'
    );
    stageGrad.addColorStop(
      0.55,
      contrastBoost > 0.12 ? '#12151C' : '#222834'
    );
    stageGrad.addColorStop(1, '#0D0F13');
    ctx.fillStyle = stageGrad;
    ctx.fillRect(frameX, frameY, frameW, frameH);

    // Subtle studio key-light orb + abstract speaker silhouette
    const glowGrad = ctx.createRadialGradient(
      frameX + frameW * 0.5,
      frameY + frameH * 0.36,
      10,
      frameX + frameW * 0.5,
      frameY + frameH * 0.36,
      frameW * 0.65
    );
    glowGrad.addColorStop(0, `${manifest.designSystem.accentColor}26`);
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(frameX, frameY, frameW, frameH);

    // Minimalist geometric subject silhouette (for spatial composition preview)
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(frameX + frameW * 0.5, frameY + frameH * 0.34, Math.min(frameW, frameH) * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      frameX + frameW * 0.5,
      frameY + frameH * 0.63,
      frameW * 0.25,
      frameH * 0.19,
      0,
      Math.PI,
      Math.PI * 2
    );
    ctx.fill();

    // Simulated vignette
    if (manifest.designSystem.vignetteStrength > 0.05) {
      const vig = ctx.createRadialGradient(
        frameX + frameW / 2,
        frameY + frameH / 2,
        frameW * 0.25,
        frameX + frameW / 2,
        frameY + frameH / 2,
        Math.max(frameW, frameH) * 0.72
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(
        1,
        `rgba(0,0,0,${Math.min(0.75, manifest.designSystem.vignetteStrength * 0.85)})`
      );
      ctx.fillStyle = vig;
      ctx.fillRect(frameX, frameY, frameW, frameH);
    }

    ctx.restore();

    // 4. Frame stroke border
    if ((manifest.designSystem.borderWidth ?? 0) > 0) {
      ctx.save();
      ctx.strokeStyle = manifest.designSystem.borderColor || 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(1, manifest.designSystem.borderWidth ?? 1);
      ctx.beginPath();
      ctx.roundRect(frameX, frameY, frameW, frameH, radius);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Optional Accent Shape
    if (manifest.layout.accentShape?.enabled) {
      const s = manifest.layout.accentShape;
      ctx.save();
      ctx.translate(w / 2 + s.x * w, h / 2 + s.y * h);
      const sw = s.width * w;
      const sh = s.height * h;
      ctx.fillStyle = s.fillColor;
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth;
      if (s.shapeType === 'line') {
        ctx.beginPath();
        ctx.moveTo(-sw / 2, 0);
        ctx.lineTo(sw / 2, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.roundRect(-sw / 2, -sh / 2, sw, sh, 8);
        if (s.fillColor !== 'transparent') ctx.fill();
        if (s.strokeWidth > 0) ctx.stroke();
      }
      ctx.restore();
    }

    // 6. Kicker / Top Title Overlay
    const kickerText = manifest.layout.titleOverlay?.enabled
      ? manifest.layout.titleOverlay.defaultText
      : manifest.preview.sampleKicker;
    const kickerRule = manifest.typography.kicker;
    if (kickerText) {
      ctx.save();
      const kY = manifest.layout.titleOverlay?.enabled
        ? h / 2 + manifest.layout.titleOverlay.y * h
        : h * 0.16;
      const kSize = Math.max(11, Math.round(13 * kickerRule.sizeRatio));
      ctx.font = `${kickerRule.fontWeight} ${kSize}px "${kickerRule.fontFamily}", "IBM Plex Mono", sans-serif`;
      const formattedKicker =
        kickerRule.textCase === 'upper' ? kickerText.toUpperCase() : kickerText;
      const kW = ctx.measureText(formattedKicker).width + 18;
      if (kickerRule.backgroundColor && kickerRule.backgroundColor !== 'transparent') {
        ctx.fillStyle = kickerRule.backgroundColor;
        ctx.beginPath();
        ctx.roundRect(w / 2 - kW / 2, kY - 12, kW, 24, 5);
        ctx.fill();
      }
      ctx.fillStyle = kickerRule.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(formattedKicker, w / 2, kY);
      ctx.restore();
    }

    // 7. Supporting & Hero Typography Block
    const heroRule = manifest.typography.hero;
    const suppRule = manifest.typography.supporting;
    const anchorY = manifest.layout.preferredAnchors[0]?.includes('top') ? h * 0.27 : h * 0.72;

    const heroSize = Math.round(24 * heroRule.sizeRatio);
    const heroWord =
      heroRule.textCase === 'upper'
        ? manifest.preview.sampleHeroWord.toUpperCase()
        : manifest.preview.sampleHeroWord;

    ctx.save();
    ctx.font = `${heroRule.fontWeight} ${heroSize}px "${heroRule.fontFamily}", "Inter", sans-serif`;
    const heroW = ctx.measureText(heroWord).width + 24;
    if (heroRule.backgroundColor && heroRule.backgroundColor !== 'transparent') {
      ctx.fillStyle = heroRule.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(w / 2 - heroW / 2, anchorY - heroSize * 0.65, heroW, heroSize * 1.3, 8);
      ctx.fill();
    }
    ctx.fillStyle = heroRule.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(heroWord, w / 2, anchorY);
    ctx.restore();

    ctx.save();
    const suppSize = Math.round(14 * suppRule.sizeRatio);
    ctx.font = `${suppRule.fontWeight} ${suppSize}px "${suppRule.fontFamily}", "Inter", sans-serif`;
    const suppY = anchorY + heroSize * 0.95;
    const cap = manifest.preview.sampleCaption;
    const capW = Math.min(w * 0.86, ctx.measureText(cap).width + 20);
    if (suppRule.backgroundColor && suppRule.backgroundColor !== 'transparent') {
      ctx.fillStyle = suppRule.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(w / 2 - capW / 2, suppY - suppSize * 0.72, capW, suppSize * 1.44, 6);
      ctx.fill();
    }
    ctx.fillStyle = suppRule.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cap, w / 2, suppY, w * 0.84);
    ctx.restore();
  }, [JSON.stringify(manifest)]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={manifest?.name ?? 'Template live preview'}
      className={className}
    />
  );
}
