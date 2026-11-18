import {
  AspectRatio,
  LayoutAnchorId,
  TEMPLATE_SCHEMA_VERSION,
  TemplateDefinition,
} from '../../types/project';
import { createId, defaultColorAdjustments } from '../../utils/timelineMath';
import { seekVideoElement } from '../compositor';
import { resourceGovernor } from './resourceGovernor';

export interface ClonedTemplateMeasurement {
  property: string;
  value: string;
  confidence: 'Measured' | 'Estimated';
}

export interface ClonedTemplateResult {
  template: TemplateDefinition;
  measurements: ClonedTemplateMeasurement[];
}

function closestAspectRatio(w: number, h: number): AspectRatio {
  const ratio = w / Math.max(1, h);
  if (Math.abs(ratio - 9 / 16) < 0.2) return '9:16';
  if (Math.abs(ratio - 1) < 0.2) return '1:1';
  return '16:9';
}

/**
 * Inspects a user-imported reference video locally to extract measurable visual style characteristics
 * (aspect ratio, dark border/letterbox insets, luminance contrast, warmth tint, cut cadence, and
 * calmer text anchor zones) and builds an editable CutFlow TemplateDefinition.
 */
export async function cloneTemplateFromReferenceVideo(params: {
  file: File;
  templateName?: string;
  onProgress?: (progress: number, stage: string) => void;
}): Promise<ClonedTemplateResult> {
  const { file, templateName, onProgress } = params;

  return resourceGovernor.runExclusiveTask({
    name: `Clone Style from ${file.name}`,
    kind: 'template-clone',
    backend: 'Canvas Vision',
    fn: async () => {
      onProgress?.(0.08, 'Decoding reference video metadata');
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Reference video load timed out.')), 10000);
          video.onloadeddata = () => {
            clearTimeout(timer);
            resolve();
          };
          video.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Unsupported reference video format.'));
          };
          video.src = url;
        });

        const srcW = video.videoWidth || 1080;
        const srcH = video.videoHeight || 1920;
        const aspectRatio = closestAspectRatio(srcW, srcH);
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4;

        const w = 240;
        const h = Math.max(120, Math.round((w * srcH) / Math.max(1, srcW)));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D unavailable.');

        const sampleCount = 8;
        let lumSum = 0;
        let satSum = 0;
        let warmthSum = 0;
        let contrastSpread = 0;
        let borderDarkCount = 0;
        let cutCount = 0;
        let topActivity = 0;
        let bottomActivity = 0;
        let bgSampleR = 16;
        let bgSampleG = 18;
        let bgSampleB = 22;

        let prevData: Uint8ClampedArray | null = null;
        let posterDataUrl = '';

        for (let i = 0; i < sampleCount; i++) {
          const t = Math.min(duration - 0.05, (i / (sampleCount - 1)) * Math.max(0.1, duration - 0.05));
          await seekVideoElement(video, Math.max(0, t));
          ctx.drawImage(video, 0, 0, w, h);

          if (i === 1) {
            posterDataUrl = canvas.toDataURL('image/jpeg', 0.78);
          }

          const { data } = ctx.getImageData(0, 0, w, h);
          let fLumSum = 0;
          let fLumSq = 0;
          let fDiff = 0;
          const pixels = w * h;

          // Check outer 4% border darkness to detect matte/inset framing
          let edgeDark = 0;
          let edgeTotal = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
              const maxC = Math.max(r, g, b) / 255;
              const minC = Math.min(r, g, b) / 255;
              satSum += maxC > 0 ? (maxC - minC) / maxC : 0;
              warmthSum += (r - b) / 255;

              fLumSum += lum;
              fLumSq += lum * lum;

              if (prevData) {
                fDiff +=
                  (Math.abs(r - prevData[idx]) +
                    Math.abs(g - prevData[idx + 1]) +
                    Math.abs(b - prevData[idx + 2])) /
                  (3 * 255);
              }

              const isBorder = x < w * 0.04 || x > w * 0.96 || y < h * 0.04 || y > h * 0.96;
              if (isBorder) {
                edgeTotal++;
                if (lum < 0.12) edgeDark++;
                if (i === 1 && x === 2 && y === 2) {
                  bgSampleR = r;
                  bgSampleG = g;
                  bgSampleB = b;
                }
              }

              if (y < h * 0.25 && prevData) {
                topActivity += Math.abs(r - prevData[idx]) / 255;
              } else if (y > h * 0.72 && prevData) {
                bottomActivity += Math.abs(r - prevData[idx]) / 255;
              }
            }
          }

          if (edgeTotal > 0 && edgeDark / edgeTotal > 0.72) borderDarkCount++;
          const mean = fLumSum / pixels;
          const std = Math.sqrt(Math.max(0, fLumSq / pixels - mean * mean));
          lumSum += mean;
          contrastSpread += std;

          if (prevData && fDiff / pixels > 0.16) cutCount++;
          prevData = new Uint8ClampedArray(data);

          onProgress?.(0.15 + ((i + 1) / sampleCount) * 0.78, `Measuring frame ${i + 1} / ${sampleCount}`);
        }

        const avgLum = lumSum / sampleCount;
        const avgStd = contrastSpread / sampleCount;
        const avgSat = satSum / (sampleCount * w * h);
        const avgWarmth = warmthSum / (sampleCount * w * h);
        const hasMatteBorder = borderDarkCount >= sampleCount * 0.5;

        const contrastAdj = Number(Math.max(-0.2, Math.min(0.28, (avgStd - 0.22) * 0.9)).toFixed(2));
        const satAdj = Number(Math.max(-0.35, Math.min(0.3, (avgSat - 0.34) * 0.7)).toFixed(2));
        const tempAdj = Number(Math.max(-0.3, Math.min(0.3, avgWarmth * 0.8)).toFixed(2));
        const brightAdj = Number(Math.max(-0.15, Math.min(0.15, (avgLum - 0.45) * 0.25)).toFixed(2));

        const preferredAnchor: LayoutAnchorId =
          bottomActivity <= topActivity ? 'lower-center' : 'top-center';

        const fastPacing = cutCount >= 2;
        const bgHex = `#${[bgSampleR, bgSampleG, bgSampleB]
          .map((n) => Math.round(n).toString(16).padStart(2, '0'))
          .join('')}`;

        const cleanName =
          templateName?.trim() ||
          `Cloned ${file.name.replace(/\.[^.]+$/, '').slice(0, 26)}`;

        const template: TemplateDefinition = {
          id: createId('tpl'),
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: cleanName,
          description: `Style template reconstructed locally from ${file.name}. Editable color grade, framing, and kinetic pacing.`,
          category: 'Cloned',
          tags: [aspectRatio, 'cloned', fastPacing ? 'fast-cut' : 'steady'],
          aspectRatio,
          version: '1.0.0',
          previewImage: posterDataUrl,
          isFavorite: false,
          isBuiltIn: false,
          createdAt: Date.now(),
          assetReferences: [],
          config: {
            aspectRatio,
            backgroundColor: hasMatteBorder ? bgHex : '#0B0C0E',
            frameInset: hasMatteBorder ? 0.06 : 0.02,
            frameRadius: hasMatteBorder ? 12 : 4,
            borderColor: hasMatteBorder ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
            borderWidth: hasMatteBorder ? 2 : 0,
            fitMode: hasMatteBorder ? 'fit' : 'fill',
            vignetteStrength: avgLum < 0.38 ? 0.3 : 0.15,
            colorGrade: {
              ...defaultColorAdjustments(),
              brightness: brightAdj,
              contrast: contrastAdj,
              saturation: satAdj,
              temperature: tempAdj,
            },
            typography: {
              heroFont: 'Space Grotesk',
              bodyFont: 'Inter',
              heroColor: '#F4F5F7',
              bodyColor: '#E2E6ED',
              panelColor: 'rgba(11,12,14,0.68)',
              preferredAnimation: fastPacing ? 'impact' : 'spring-pop',
              springStiffness: fastPacing ? 320 : 250,
              springDamping: fastPacing ? 16 : 20,
              anticipationMs: fastPacing ? 40 : 30,
            },
            soundProfile: {
              enabled: true,
              heroSfx: fastPacing ? 'impact-hit' : 'soft-pop',
              transitionSfx: 'whoosh-in',
            },
            preferredAnchors: [preferredAnchor, 'upper-left', 'upper-right'],
          },
        };

        const measurements: ClonedTemplateMeasurement[] = [
          { property: 'Aspect Ratio & Resolution', value: `${aspectRatio} (${srcW}×${srcH})`, confidence: 'Measured' },
          { property: 'Outer Matte / Inset Border', value: hasMatteBorder ? '6% framed matte detected' : 'Full-bleed framing', confidence: 'Measured' },
          { property: 'Color Grade & Warmth', value: `Contrast ${contrastAdj >= 0 ? '+' : ''}${contrastAdj}, Sat ${satAdj >= 0 ? '+' : ''}${satAdj}, Temp ${tempAdj >= 0 ? '+' : ''}${tempAdj}`, confidence: 'Measured' },
          { property: 'Scene Cut Cadence', value: `${cutCount} cut transitions in ${sampleCount} samples (${fastPacing ? 'energetic' : 'measured'} pacing)`, confidence: 'Measured' },
          { property: 'Caption Zone & Motion Style', value: `${preferredAnchor} · ${fastPacing ? 'impact' : 'spring-pop'}`, confidence: 'Estimated' },
        ];

        onProgress?.(1, 'Template reconstructed');
        return { template, measurements };
      } finally {
        URL.revokeObjectURL(url);
        video.src = '';
        video.load();
      }
    },
  });
}
