import {
  LayoutAnchorId,
  MediaAssetRef,
  NormalizedBox,
  PerformanceMode,
  SceneCompositionMap,
  SceneCompositionRecord,
} from '../../types/project';
import { createId } from '../../utils/timelineMath';
import { detectBrowserCapabilities } from '../capabilities';
import { seekVideoElement } from '../compositor';
import { mediaUrlRegistry } from '../mediaEngine';
import { findAnalysisByMediaId, saveAnalysisBundle } from '../storage';
import { getCachedBinaryAssetBuffer, isModelReady } from './modelManager';
import { getModelDefinition, MEDIAPIPE_LOCAL_WASM_BASE } from './modelRegistry';
import { resourceGovernor } from './resourceGovernor';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function analyzeCanvasFrameMetrics(
  imageData: ImageData,
  prevData: Uint8ClampedArray | null
): {
  brightnessAvg: number;
  motionScore: number;
  palette: string[];
  negativeSpaceBoxes: NormalizedBox[];
} {
  const { width, height, data } = imageData;
  let lumSum = 0;
  let diffSum = 0;
  const pixelCount = Math.max(1, width * height);

  const gridSum = new Float64Array(9);
  const gridSq = new Float64Array(9);
  const gridCnt = new Float64Array(9);
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let y = 0; y < height; y++) {
    const gy = Math.min(2, Math.floor((y / height) * 3));
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      lumSum += lum;

      if (prevData) {
        const dr = Math.abs(r - prevData[idx]);
        const dg = Math.abs(g - prevData[idx + 1]);
        const db = Math.abs(b - prevData[idx + 2]);
        diffSum += (dr + dg + db) / (3 * 255);
      }

      const gx = Math.min(2, Math.floor((x / width) * 3));
      const cell = gy * 3 + gx;
      gridSum[cell] += lum;
      gridSq[cell] += lum * lum;
      gridCnt[cell] += 1;

      if ((x + y) % 4 === 0) {
        const key = `${r >> 5}_${g >> 5}_${b >> 5}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.r += r;
          existing.g += g;
          existing.b += b;
          existing.count += 1;
        } else {
          buckets.set(key, { r, g, b, count: 1 });
        }
      }
    }
  }

  const palette = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((b) => rgbToHex(b.r / b.count, b.g / b.count, b.b / b.count));

  const negativeSpaceBoxes: NormalizedBox[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const c = gy * 3 + gx;
      const cnt = Math.max(1, gridCnt[c]);
      const mean = gridSum[c] / cnt;
      const variance = Math.max(0, gridSq[c] / cnt - mean * mean);
      if (variance < 0.018) {
        negativeSpaceBoxes.push({
          x: Number((gx / 3).toFixed(3)),
          y: Number((gy / 3).toFixed(3)),
          width: 0.33,
          height: 0.33,
          confidence: Number(clamp01(1 - variance * 30).toFixed(2)),
        });
      }
    }
  }

  return {
    brightnessAvg: Number((lumSum / pixelCount).toFixed(3)),
    motionScore: prevData ? Number(clamp01((diffSum / pixelCount) * 4.5).toFixed(3)) : 0,
    palette: palette.length ? palette : ['#181B20', '#9AA2B1'],
    negativeSpaceBoxes,
  };
}

function smoothBoxesAcrossFrames(
  prevBoxes: NormalizedBox[],
  currBoxes: NormalizedBox[],
  alpha = 0.65
): NormalizedBox[] {
  if (currBoxes.length === 0) return prevBoxes.slice(0, 1).map((b) => ({ ...b, confidence: (b.confidence ?? 0.8) * 0.8 }));
  if (prevBoxes.length === 0) return currBoxes;

  return currBoxes.map((curr, idx) => {
    const prev = prevBoxes[idx];
    if (!prev) return curr;
    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (dist > 0.25) return curr;
    return {
      ...curr,
      x: clamp01(prev.x * (1 - alpha) + curr.x * alpha),
      y: clamp01(prev.y * (1 - alpha) + curr.y * alpha),
      width: clamp01(prev.width * (1 - alpha) + curr.width * alpha),
      height: clamp01(prev.height * (1 - alpha) + curr.height * alpha),
    };
  });
}

function suggestAnchorFromBoxes(
  mouthBoxes: NormalizedBox[],
  negativeBoxes: NormalizedBox[],
  silhouetteBoxes: NormalizedBox[]
): LayoutAnchorId {
  const mouthInLower = mouthBoxes.some((m) => m.y + m.height > 0.58);
  const mouthInUpper = mouthBoxes.some((m) => m.y < 0.32);
  if (!mouthInLower && !silhouetteBoxes.some((s) => s.y > 0.65 && s.width > 0.55)) {
    return 'lower-center';
  }
  if (!mouthInUpper) return 'top-center';

  const calmTopLeft = negativeBoxes.some((n) => n.x < 0.35 && n.y < 0.35);
  if (calmTopLeft) return 'upper-left';
  return 'upper-right';
}

interface SampleFrameBuffer {
  timeSec: number;
  imageData: ImageData;
  brightnessAvg: number;
  motionScore: number;
  palette: string[];
  negativeSpaceBoxes: NormalizedBox[];
  faceBoxes: NormalizedBox[];
  mouthBoxes: NormalizedBox[];
  eyeBoxes: NormalizedBox[];
  poseBoxes: NormalizedBox[];
  personSilhouetteBoxes: NormalizedBox[];
  objectBoxes: NormalizedBox[];
  ocrRegions: Array<NormalizedBox & { text: string }>;
}

export async function analyzeVideoSceneComposition(params: {
  asset: MediaAssetRef;
  performanceMode: PerformanceMode;
  includeOcr?: boolean;
  forceReanalyze?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string) => void;
}): Promise<SceneCompositionMap> {
  const {
    asset,
    performanceMode,
    includeOcr = false,
    forceReanalyze = false,
    signal,
    onProgress,
  } = params;

  if (!forceReanalyze) {
    const cached = await findAnalysisByMediaId(asset.id);
    if (cached?.sceneMap) {
      onProgress?.(1, 'Reused cached scene composition analysis');
      return cached.sceneMap;
    }
  }

  return resourceGovernor.runExclusiveTask({
    name: `Visual Scene Analysis (${asset.name})`,
    kind: 'vision',
    backend: 'Sequential MediaPipe + Canvas + Tesseract',
    signal,
    fn: async (abortSignal) => {
      const url = await mediaUrlRegistry.getUrl(asset);
      if (!url) throw new Error('Source video could not be loaded for visual analysis.');

      const caps = await detectBrowserCapabilities();
      const budget = resourceGovernor.getProfileBudget(performanceMode);
      const duration = Math.max(0.5, asset.durationSec || 1);

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timed out loading video for scene analysis.')), 10000);
        video.onloadeddata = () => {
          clearTimeout(t);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(t);
          reject(new Error('Failed to decode video for scene analysis.'));
        };
        video.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = budget.analysisWidth;
      canvas.height = budget.analysisHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Unable to create offscreen analysis canvas.');

      const sampleCount = Math.min(budget.maxSampleFrames, Math.max(4, Math.ceil(duration / 1.0)));
      const samples: SampleFrameBuffer[] = [];

      // Pass 1: Extract frames & compute luminance, palette, motion & negative space
      let prevPixels: Uint8ClampedArray | null = null;
      try {
        for (let i = 0; i < sampleCount; i++) {
          if (abortSignal.aborted) throw new Error('Scene analysis cancelled.');
          const t = Math.min(
            duration - 0.05,
            (i / Math.max(1, sampleCount - 1)) * Math.max(0.1, duration - 0.05)
          );
          await seekVideoElement(video, Math.max(0, t));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const metrics = analyzeCanvasFrameMetrics(img, prevPixels);
          prevPixels = new Uint8ClampedArray(img.data);

          samples.push({
            timeSec: Number(t.toFixed(2)),
            imageData: img,
            ...metrics,
            faceBoxes: [],
            mouthBoxes: [],
            eyeBoxes: [],
            poseBoxes: [],
            personSilhouetteBoxes: [],
            objectBoxes: [],
            ocrRegions: [],
          });
          onProgress?.(0.05 + ((i + 1) / sampleCount) * 0.25, `Sampling frame ${i + 1} / ${sampleCount}`);
        }
      } finally {
        video.src = '';
        video.load();
      }

      const [hasFace, hasPose, hasSeg, hasObj, hasOcr] = await Promise.all([
        isModelReady('mediapipe-face-landmarker'),
        isModelReady('mediapipe-pose-landmarker'),
        isModelReady('mediapipe-image-segmenter'),
        isModelReady('mediapipe-object-detector'),
        includeOcr ? isModelReady('tesseract-ocr-eng') : Promise.resolve(false),
      ]);

      let faceDetectorUsed = 'Not run (FaceLandmarker not downloaded)';
      let poseDetectorUsed = 'Not run (PoseLandmarker not downloaded)';
      let segmenterUsed = 'Not run (SelfieSegmenter not downloaded)';
      let objectDetectorUsed = 'Not run (ObjectDetector not downloaded)';
      let ocrUsed = includeOcr ? 'Not run (Tesseract OCR not downloaded)' : 'Skipped';

      const delegate = caps.webGL2 ? 'GPU' : 'CPU';
      const visionModule =
        hasFace || hasPose || hasSeg || hasObj ? await import('@mediapipe/tasks-vision') : null;
      const fileset = visionModule
        ? await visionModule.FilesetResolver.forVisionTasks(MEDIAPIPE_LOCAL_WASM_BASE)
        : null;

      // Pass 2 (Sequential): FaceLandmarker -> run -> immediately close
      if (hasFace && visionModule && fileset) {
        const def = getModelDefinition('mediapipe-face-landmarker');
        if (def?.assetUrl) {
          onProgress?.(0.35, 'Running FaceLandmarker (load -> infer -> release)');
          let detector: Awaited<
            ReturnType<typeof visionModule.FaceLandmarker.createFromOptions>
          > | null = null;
          try {
            const buf = await getCachedBinaryAssetBuffer(def.assetUrl);
            detector = await visionModule.FaceLandmarker.createFromOptions(fileset, {
              baseOptions: buf
                ? { modelAssetBuffer: buf, delegate }
                : { modelAssetPath: def.assetUrl, delegate },
              runningMode: 'IMAGE',
              numFaces: 2,
            });
            let prevFace: NormalizedBox[] = [];
            for (const s of samples) {
              if (abortSignal.aborted) throw new Error('Scene analysis cancelled.');
              ctx.putImageData(s.imageData, 0, 0);
              const res = detector.detect(canvas);
              const rawFaces: NormalizedBox[] = [];
              for (const landmarks of res.faceLandmarks ?? []) {
                let minX = 1,
                  minY = 1,
                  maxX = 0,
                  maxY = 0;
                for (const pt of landmarks) {
                  minX = Math.min(minX, pt.x);
                  minY = Math.min(minY, pt.y);
                  maxX = Math.max(maxX, pt.x);
                  maxY = Math.max(maxY, pt.y);
                }
                const fw = Math.max(0.04, maxX - minX);
                const fh = Math.max(0.04, maxY - minY);
                rawFaces.push({ x: clamp01(minX), y: clamp01(minY), width: clamp01(fw), height: clamp01(fh), label: 'face', confidence: 0.9 });
                const mouthPts = [landmarks[61], landmarks[291], landmarks[0], landmarks[17]].filter(Boolean);
                if (mouthPts.length >= 2) {
                  const mx0 = Math.min(...mouthPts.map((p) => p.x)) - 0.025;
                  const my0 = Math.min(...mouthPts.map((p) => p.y)) - 0.02;
                  const mx1 = Math.max(...mouthPts.map((p) => p.x)) + 0.025;
                  const my1 = Math.max(...mouthPts.map((p) => p.y)) + 0.025;
                  s.mouthBoxes.push({ x: clamp01(mx0), y: clamp01(my0), width: clamp01(mx1 - mx0), height: clamp01(my1 - my0), label: 'mouth', confidence: 0.9 });
                }
                s.eyeBoxes.push({ x: clamp01(minX + fw * 0.12), y: clamp01(minY + fh * 0.22), width: clamp01(fw * 0.76), height: clamp01(fh * 0.22), label: 'eyes', confidence: 0.9 });
              }
              s.faceBoxes = smoothBoxesAcrossFrames(prevFace, rawFaces);
              prevFace = s.faceBoxes;
            }
            faceDetectorUsed = `MediaPipe FaceLandmarker (${delegate})`;
          } catch (err) {
            faceDetectorUsed = `FaceLandmarker error (${err instanceof Error ? err.message : 'WASM error'})`;
          } finally {
            detector?.close();
          }
        }
      }

      // Pass 3 (Sequential): PoseLandmarker -> run -> immediately close
      if (hasPose && visionModule && fileset) {
        const def = getModelDefinition('mediapipe-pose-landmarker');
        if (def?.assetUrl) {
          onProgress?.(0.52, 'Running PoseLandmarker (load -> infer -> release)');
          let pose: Awaited<
            ReturnType<typeof visionModule.PoseLandmarker.createFromOptions>
          > | null = null;
          try {
            const buf = await getCachedBinaryAssetBuffer(def.assetUrl);
            pose = await visionModule.PoseLandmarker.createFromOptions(fileset, {
              baseOptions: buf
                ? { modelAssetBuffer: buf, delegate }
                : { modelAssetPath: def.assetUrl, delegate },
              runningMode: 'IMAGE',
              numPoses: 2,
            });
            for (const s of samples) {
              if (abortSignal.aborted) throw new Error('Scene analysis cancelled.');
              ctx.putImageData(s.imageData, 0, 0);
              const res = pose.detect(canvas);
              for (const lms of res.landmarks ?? []) {
                const typedLms = lms as Array<{ x: number; y: number; visibility?: number }>;
                const vis = typedLms.filter((p) => (p.visibility ?? 1) > 0.35);
                if (vis.length < 3) continue;
                const minX = Math.min(...vis.map((p) => p.x));
                const maxX = Math.max(...vis.map((p) => p.x));
                const minY = Math.min(...vis.map((p) => p.y));
                const maxY = Math.max(...vis.map((p) => p.y));
                s.poseBoxes.push({
                  x: clamp01(minX),
                  y: clamp01(minY),
                  width: clamp01(Math.max(0.08, maxX - minX)),
                  height: clamp01(Math.max(0.08, maxY - minY)),
                  label: 'pose',
                });
              }
            }
            poseDetectorUsed = `MediaPipe PoseLandmarker Lite (${delegate})`;
          } catch (err) {
            poseDetectorUsed = `PoseLandmarker error (${err instanceof Error ? err.message : 'WASM error'})`;
          } finally {
            pose?.close();
          }
        }
      }

      // Pass 4 (Sequential): ImageSegmenter -> run -> immediately close
      if (hasSeg && visionModule && fileset) {
        const def = getModelDefinition('mediapipe-image-segmenter');
        if (def?.assetUrl) {
          onProgress?.(0.68, 'Running ImageSegmenter (load -> infer -> release)');
          let segmenter: Awaited<
            ReturnType<typeof visionModule.ImageSegmenter.createFromOptions>
          > | null = null;
          try {
            const buf = await getCachedBinaryAssetBuffer(def.assetUrl);
            segmenter = await visionModule.ImageSegmenter.createFromOptions(fileset, {
              baseOptions: buf
                ? { modelAssetBuffer: buf, delegate }
                : { modelAssetPath: def.assetUrl, delegate },
              runningMode: 'IMAGE',
              outputConfidenceMasks: true,
              outputCategoryMask: false,
            });
            for (let i = 0; i < samples.length; i += 2) {
              if (abortSignal.aborted) throw new Error('Scene analysis cancelled.');
              const s = samples[i];
              ctx.putImageData(s.imageData, 0, 0);
              const res = segmenter.segment(canvas);
              const mask = res.confidenceMasks?.[0];
              if (mask) {
                const mw = mask.width;
                const mh = mask.height;
                const data = mask.getAsFloat32Array();
                let minX = 1,
                  minY = 1,
                  maxX = 0,
                  maxY = 0,
                  fgCount = 0;
                for (let y = 0; y < mh; y += 2) {
                  for (let x = 0; x < mw; x += 2) {
                    const v = data[y * mw + x];
                    if (v > 0.55) {
                      fgCount += 1;
                      const nx = x / mw;
                      const ny = y / mh;
                      minX = Math.min(minX, nx);
                      minY = Math.min(minY, ny);
                      maxX = Math.max(maxX, nx);
                      maxY = Math.max(maxY, ny);
                    }
                  }
                }
                if (fgCount > 16) {
                  const box: NormalizedBox = {
                    x: clamp01(minX),
                    y: clamp01(minY),
                    width: clamp01(maxX - minX),
                    height: clamp01(maxY - minY),
                    label: 'person-silhouette',
                    confidence: 0.85,
                  };
                  s.personSilhouetteBoxes.push(box);
                  if (samples[i + 1]) samples[i + 1].personSilhouetteBoxes.push(box);
                }
                mask.close();
              }
            }
            segmenterUsed = `MediaPipe SelfieSegmenter (${delegate})`;
          } catch (err) {
            segmenterUsed = `ImageSegmenter error (${err instanceof Error ? err.message : 'WASM error'})`;
          } finally {
            segmenter?.close();
          }
        }
      }

      // Pass 5 (Sequential): ObjectDetector -> run -> immediately close
      if (hasObj && visionModule && fileset) {
        const def = getModelDefinition('mediapipe-object-detector');
        if (def?.assetUrl) {
          onProgress?.(0.8, 'Running ObjectDetector (load -> infer -> release)');
          let objDetector: Awaited<
            ReturnType<typeof visionModule.ObjectDetector.createFromOptions>
          > | null = null;
          try {
            const buf = await getCachedBinaryAssetBuffer(def.assetUrl);
            objDetector = await visionModule.ObjectDetector.createFromOptions(fileset, {
              baseOptions: buf
                ? { modelAssetBuffer: buf, delegate }
                : { modelAssetPath: def.assetUrl, delegate },
              runningMode: 'IMAGE',
              maxResults: 4,
              scoreThreshold: 0.4,
            });
            for (let i = 0; i < samples.length; i += 2) {
              if (abortSignal.aborted) throw new Error('Scene analysis cancelled.');
              const s = samples[i];
              ctx.putImageData(s.imageData, 0, 0);
              const res = objDetector.detect(canvas);
              for (const det of res.detections ?? []) {
                const bb = det.boundingBox;
                if (!bb) continue;
                const box: NormalizedBox = {
                  x: clamp01(bb.originX / canvas.width),
                  y: clamp01(bb.originY / canvas.height),
                  width: clamp01(bb.width / canvas.width),
                  height: clamp01(bb.height / canvas.height),
                  label: det.categories?.[0]?.categoryName ?? 'object',
                  confidence: det.categories?.[0]?.score ?? 0.5,
                };
                s.objectBoxes.push(box);
                if (samples[i + 1]) samples[i + 1].objectBoxes.push(box);
              }
            }
            objectDetectorUsed = `MediaPipe EfficientDet-Lite0 (${delegate})`;
          } catch (err) {
            objectDetectorUsed = `ObjectDetector error (${err instanceof Error ? err.message : 'WASM error'})`;
          } finally {
            objDetector?.close();
          }
        }
      }

      // Pass 6 (Sequential): Tesseract OCR -> run -> terminate
      if (hasOcr) {
        onProgress?.(0.9, 'Running Tesseract OCR (load -> infer -> terminate)');
        let ocrWorker: {
          recognize: (img: HTMLCanvasElement) => Promise<{
            data: { words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> };
          }>;
          terminate: () => Promise<void>;
        } | null = null;
        try {
          const { createWorker } = await import('tesseract.js');
          ocrWorker = (await createWorker('eng')) as unknown as typeof ocrWorker;
          for (let i = 0; i < samples.length; i += 4) {
            if (abortSignal.aborted) throw new Error('Scene analysis cancelled.');
            const s = samples[i];
            ctx.putImageData(s.imageData, 0, 0);
            const ocrRes = await ocrWorker!.recognize(canvas);
            for (const w of ocrRes.data.words ?? []) {
              if (w.confidence >= 65 && w.text.trim().length >= 2) {
                s.ocrRegions.push({
                  text: w.text.trim(),
                  x: clamp01(w.bbox.x0 / canvas.width),
                  y: clamp01(w.bbox.y0 / canvas.height),
                  width: clamp01((w.bbox.x1 - w.bbox.x0) / canvas.width),
                  height: clamp01((w.bbox.y1 - w.bbox.y0) / canvas.height),
                  confidence: Number((w.confidence / 100).toFixed(2)),
                });
              }
            }
          }
          ocrUsed = 'Tesseract.js (eng)';
        } catch {
          ocrUsed = 'OCR failed to initialize';
        } finally {
          if (ocrWorker) await ocrWorker.terminate().catch(() => {});
        }
      }

      // Build SceneCompositionRecords separated by scene cuts
      const scenes: SceneCompositionRecord[] = [];
      let groupStart = 0;

      const buildSceneRecord = (slice: SampleFrameBuffer[], endSec: number): SceneCompositionRecord => {
        const rep = slice[Math.floor(slice.length / 2)];
        const limitations: string[] = [];
        if (!hasFace) limitations.push('MediaPipe FaceLandmarker not downloaded');
        if (!hasPose) limitations.push('MediaPipe PoseLandmarker not downloaded');
        if (!hasSeg) limitations.push('MediaPipe ImageSegmenter not downloaded');
        if (includeOcr && !hasOcr) limitations.push('Tesseract OCR not downloaded');

        return {
          sceneId: createId('scene'),
          startSec: slice[0].timeSec,
          endSec: Number(Math.max(slice[0].timeSec + 0.5, endSec).toFixed(2)),
          cutConfidence: slice[0].motionScore > 0.55 ? slice[0].motionScore : 0.8,
          faceBoxes: rep.faceBoxes,
          mouthBoxes: rep.mouthBoxes,
          eyeBoxes: rep.eyeBoxes,
          poseBoxes: rep.poseBoxes,
          personSilhouetteBoxes: rep.personSilhouetteBoxes,
          objectBoxes: rep.objectBoxes,
          ocrRegions: rep.ocrRegions,
          negativeSpaceBoxes: rep.negativeSpaceBoxes,
          motionScore: Number(
            (slice.reduce((acc, s) => acc + s.motionScore, 0) / slice.length).toFixed(3)
          ),
          brightnessAvg: Number(
            (slice.reduce((acc, s) => acc + s.brightnessAvg, 0) / slice.length).toFixed(3)
          ),
          dominantPalette: rep.palette,
          suggestedAnchor: suggestAnchorFromBoxes(
            rep.mouthBoxes,
            rep.negativeSpaceBoxes,
            rep.personSilhouetteBoxes
          ),
          limitations,
        };
      };

      for (let i = 1; i < samples.length; i++) {
        if (samples[i].motionScore > 0.58) {
          scenes.push(buildSceneRecord(samples.slice(groupStart, i), samples[i].timeSec));
          groupStart = i;
        }
      }
      if (samples.length > groupStart) {
        scenes.push(buildSceneRecord(samples.slice(groupStart), duration));
      }

      const sceneMap: SceneCompositionMap = {
        mediaId: asset.id,
        durationSec: duration,
        analyzedAt: Date.now(),
        faceDetectorUsed,
        poseDetectorUsed,
        segmenterUsed,
        objectDetectorUsed,
        ocrUsed,
        scenes,
      };

      const existingBundle = await findAnalysisByMediaId(asset.id);
      await saveAnalysisBundle({
        cacheKey: existingBundle?.cacheKey ?? `analysis_${asset.id}`,
        mediaId: asset.id,
        modelId: existingBundle?.modelId ?? 'vision-only',
        romanizationStyle: existingBundle?.romanizationStyle ?? 'natural-hinglish',
        createdAt: Date.now(),
        segments: existingBundle?.segments ?? [],
        sceneMap,
      });

      onProgress?.(1, `Analyzed ${scenes.length} scene segment(s)`);
      return sceneMap;
    },
  });
}
