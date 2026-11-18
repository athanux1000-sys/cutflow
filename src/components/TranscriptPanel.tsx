import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  GitMerge,
  Mic,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  Wand2,
} from 'lucide-react';
import {
  AppSettings,
  CutFlowProject,
  RomanizationStyle,
  TranscriptSegment,
  TranscriptWordToken,
} from '../types/project';
import { buildEditorialPlan, editorialPlanToTimelineLayers } from '../utils/editorialPlanner';
import { processTextToRomanHinglish, buildWordTokensForSegment } from '../utils/hinglish';
import { createId, formatDuration } from '../utils/timelineMath';
import {
  downloadModelExplicitly,
  isModelReady,
  subscribeModelManager,
} from '../services/ai/modelManager';
import { getModelDefinition } from '../services/ai/modelRegistry';
import {
  buildSileroVadChunksIfReady,
  extractMono16kAudio,
  ModelNotDownloadedError,
  reRomanizeTranscriptSegments,
  transcribeMediaAssetLocally,
} from '../services/ai/speechService';
import { analyzeVideoSceneComposition } from '../services/ai/visionService';
import { loadMediaBlob, saveAnalysisBundle } from '../services/storage';

interface TranscriptPanelProps {
  project: CutFlowProject;
  settings: AppSettings;
  onUpdateProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onSeekTo: (timeSec: number) => void;
}

export function TranscriptPanel({
  project,
  settings,
  onUpdateProject,
  onUpdateSettings,
  onSeekTo,
}: TranscriptPanelProps) {
  const [whisperReady, setWhisperReady] = useState(false);
  const [faceReady, setFaceReady] = useState(false);
  const [busyStage, setBusyStage] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [vadWindows, setVadWindows] = useState<{
    windows: Array<{ startSec: number; endSec: number }>;
    engine: string;
  } | null>(null);
  const [needsDownloadModelId, setNeedsDownloadModelId] = useState<string | null>(null);
  const [expandedSegId, setExpandedSegId] = useState<string | null>(null);
  const [showRawForId, setShowRawForId] = useState<Record<string, boolean>>({});
  const [playingSegId, setPlayingSegId] = useState<string | null>(null);
  const snippetAudioRef = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode } | null>(null);

  const primaryMedia =
    project.media.find((m) => m.type === 'video') ??
    project.media.find((m) => m.type === 'audio') ??
    null;

  const modelId = settings.preferredWhisperModelId || 'whisper-small-multi';
  const modelDef = getModelDefinition(modelId);
  const segments = project.transcriptSegments ?? [];

  const refreshModelFlags = async () => {
    const [w, f] = await Promise.all([
      isModelReady(modelId),
      isModelReady('mediapipe-face-landmarker'),
    ]);
    setWhisperReady(w);
    setFaceReady(f);
  };

  useEffect(() => {
    refreshModelFlags();
    return subscribeModelManager(() => {
      refreshModelFlags();
    });
  }, [modelId]);

  useEffect(() => {
    return () => {
      try {
        snippetAudioRef.current?.source.stop();
        snippetAudioRef.current?.ctx.close();
      } catch {
        // ignore
      }
    };
  }, []);

  const stopSnippetAudio = () => {
    try {
      snippetAudioRef.current?.source.stop();
      snippetAudioRef.current?.ctx.close();
    } catch {
      // ignore
    }
    snippetAudioRef.current = null;
    setPlayingSegId(null);
  };

  const playSegmentSnippet = async (seg: TranscriptSegment) => {
    if (playingSegId === seg.id) {
      stopSnippetAudio();
      return;
    }
    stopSnippetAudio();
    if (!primaryMedia) return;

    try {
      const blob = await loadMediaBlob(primaryMedia.storageKey, primaryMedia.storageBackend);
      if (!blob) return;
      const arr = await blob.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arr);
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      const start = Math.max(0, seg.startSec);
      const dur = Math.max(0.2, seg.endSec - start);
      source.onended = () => {
        setPlayingSegId((cur) => (cur === seg.id ? null : cur));
        ctx.close().catch(() => {});
      };
      source.start(0, start, dur);
      snippetAudioRef.current = { ctx, source };
      setPlayingSegId(seg.id);
      onSeekTo(seg.startSec);
    } catch {
      setPlayingSegId(null);
    }
  };

  const handleScanVadOnly = async () => {
    if (!primaryMedia) {
      setErrorMsg('Import a video or audio clip first to scan speech regions.');
      return;
    }
    setErrorMsg('');
    setBusyStage('Running local VAD...');
    setProgress(0.3);
    try {
      const blob = await loadMediaBlob(primaryMedia.storageKey, primaryMedia.storageBackend);
      if (!blob) throw new Error('Media file not found in local storage.');
      const { pcm } = await extractMono16kAudio(blob);
      const { chunks, vadEngineUsed } = await buildSileroVadChunksIfReady(pcm, 16000, 20);
      setVadWindows({
        windows: chunks.map((c) => ({ startSec: c.startSec, endSec: c.endSec })),
        engine: vadEngineUsed,
      });
      setBusyStage('');
      setProgress(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'VAD scan failed.');
      setBusyStage('');
      setProgress(0);
    }
  };

  const handleExplicitDownload = async (targetModelId: string) => {
    setErrorMsg('');
    setNeedsDownloadModelId(null);
    setBusyStage(`Downloading ${getModelDefinition(targetModelId)?.name ?? targetModelId}...`);
    setProgress(0.05);
    try {
      await downloadModelExplicitly(targetModelId, (p, stage) => {
        setProgress(p);
        setBusyStage(stage);
      });
      await refreshModelFlags();
      setBusyStage('');
      setProgress(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Download failed.');
      setBusyStage('');
      setProgress(0);
    }
  };

  const handleTranscribeSpeech = async () => {
    if (!primaryMedia) {
      setErrorMsg('Import a video or audio clip first to generate captions.');
      return;
    }
    setErrorMsg('');
    setNeedsDownloadModelId(null);
    setBusyStage('Preparing local Whisper runtime...');
    setProgress(0.05);

    try {
      const res = await transcribeMediaAssetLocally({
        asset: primaryMedia,
        modelId,
        romanizationStyle: settings.romanizationStyle,
        customVocabulary: settings.customVocabulary,
        performanceMode: settings.performanceMode,
        onProgress: (p, stage) => {
          setProgress(p);
          setBusyStage(stage);
        },
      });

      onUpdateProject((prev) => ({
        ...prev,
        transcriptSegments: res.segments,
      }));

      await saveAnalysisBundle({
        cacheKey: `analysis_${primaryMedia.id}`,
        mediaId: primaryMedia.id,
        modelId,
        romanizationStyle: settings.romanizationStyle,
        createdAt: Date.now(),
        segments: res.segments,
        sceneMap: project.sceneMap,
      });

      setBusyStage('');
      setProgress(0);
    } catch (err) {
      if (err instanceof ModelNotDownloadedError) {
        setNeedsDownloadModelId(err.modelId);
      }
      setErrorMsg(err instanceof Error ? err.message : 'Speech recognition failed.');
      setBusyStage('');
      setProgress(0);
    }
  };

  const handleAnalyzeScene = async (forceReanalyze = false) => {
    const videoAsset = project.media.find((m) => m.type === 'video');
    if (!videoAsset) {
      setErrorMsg('Import a video clip to analyze visual scenes and speaker landmarks.');
      return;
    }
    setErrorMsg('');
    setBusyStage('Analyzing visual scenes...');
    setProgress(0.08);
    try {
      const sceneMap = await analyzeVideoSceneComposition({
        asset: videoAsset,
        performanceMode: settings.performanceMode,
        includeOcr: false,
        forceReanalyze,
        onProgress: (p, stage) => {
          setProgress(p);
          setBusyStage(stage);
        },
      });
      onUpdateProject((prev) => ({
        ...prev,
        sceneMap,
      }));
      setBusyStage('');
      setProgress(0);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Visual scene analysis failed.');
      setBusyStage('');
      setProgress(0);
    }
  };

  const handleApplyCaptionsToTimeline = () => {
    if (segments.length === 0) return;
    const overlayTrackId =
      project.tracks.find((t) => t.kind === 'overlay')?.id ??
      project.tracks[0]?.id ??
      'track_overlay_1';

    const plan = buildEditorialPlan({
      projectId: project.id,
      segments,
      sceneMap: project.sceneMap,
    });

    const { textLayers, soundCues } = editorialPlanToTimelineLayers({
      plan,
      segments,
      overlayTrackId,
      enableSoundDesign: settings.autoSoundDesign,
    });

    onUpdateProject((prev) => ({
      ...prev,
      editorialPlan: plan,
      textLayers: [
        ...prev.textLayers.filter((t) => !t.transcriptSegmentId),
        ...textLayers,
      ],
      soundCues: [
        ...(prev.soundCues ?? []).filter((c) => !c.linkedLayerId),
        ...soundCues,
      ],
    }));
  };

  const updateSegmentText = (segId: string, nextText: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: (prev.transcriptSegments ?? []).map((s) => {
        if (s.id !== segId) return s;
        return {
          ...s,
          text: nextText,
          userEdited: true,
          uncertain: false,
          words: buildWordTokensForSegment({
            segmentId: s.id,
            text: nextText,
            startSec: s.startSec,
            endSec: s.endSec,
            style: settings.romanizationStyle,
            customVocabulary: settings.customVocabulary,
          }),
        };
      }),
    }));
  };

  const updateSegmentWords = (segId: string, nextWords: TranscriptWordToken[]) => {
    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: (prev.transcriptSegments ?? []).map((s) => {
        if (s.id !== segId) return s;
        const rebuiltText = nextWords.map((w) => w.word).filter(Boolean).join(' ');
        const minStart = nextWords.length ? nextWords[0].startSec : s.startSec;
        const maxEnd = nextWords.length ? nextWords[nextWords.length - 1].endSec : s.endSec;
        return {
          ...s,
          text: rebuiltText || s.text,
          startSec: Number(Math.min(s.startSec, minStart).toFixed(3)),
          endSec: Number(Math.max(s.startSec + 0.25, maxEnd).toFixed(3)),
          userEdited: true,
          words: nextWords,
        };
      }),
    }));
  };

  const mergeWithNextWord = (seg: TranscriptSegment, wordIdx: number) => {
    if (wordIdx >= seg.words.length - 1) return;
    const a = seg.words[wordIdx];
    const b = seg.words[wordIdx + 1];
    const merged: TranscriptWordToken = {
      ...a,
      word: `${a.word} ${b.word}`.trim(),
      endSec: b.endSec,
      timingSource:
        a.timingSource === 'model-aligned' && b.timingSource === 'model-aligned'
          ? 'model-aligned'
          : 'estimated',
    };
    const nextWords = [
      ...seg.words.slice(0, wordIdx),
      merged,
      ...seg.words.slice(wordIdx + 2),
    ];
    updateSegmentWords(seg.id, nextWords);
  };

  const nudgeSegmentRange = (seg: TranscriptSegment, deltaSec: number) => {
    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: (prev.transcriptSegments ?? []).map((s) => {
        if (s.id !== seg.id) return s;
        const nextStart = Math.max(0, Number((s.startSec + deltaSec).toFixed(2)));
        const nextEnd = Math.max(nextStart + 0.3, Number((s.endSec + deltaSec).toFixed(2)));
        return {
          ...s,
          startSec: nextStart,
          endSec: nextEnd,
          userEdited: true,
          words: s.words.map((w) => ({
            ...w,
            startSec: Math.max(0, Number((w.startSec + deltaSec).toFixed(2))),
            endSec: Math.max(0.1, Number((w.endSec + deltaSec).toFixed(2))),
          })),
        };
      }),
    }));
  };

  const mergeSegmentWithNext = (segId: string) => {
    const idx = segments.findIndex((s) => s.id === segId);
    if (idx === -1 || idx >= segments.length - 1) return;
    const a = segments[idx];
    const b = segments[idx + 1];
    const combinedText = `${a.text} ${b.text}`.replace(/\s+/g, ' ').trim();
    const combined: TranscriptSegment = {
      ...a,
      endSec: Math.max(a.endSec, b.endSec),
      text: combinedText,
      rawText: `${a.rawText} ${b.rawText}`.trim(),
      userEdited: true,
      words: [...a.words, ...b.words],
    };
    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: [
        ...segments.slice(0, idx),
        combined,
        ...segments.slice(idx + 2),
      ],
    }));
  };

  const splitSegmentAtMid = (seg: TranscriptSegment) => {
    const words = seg.text.trim().split(/\s+/);
    if (words.length < 2) return;
    const midIdx = Math.ceil(words.length / 2);
    const midTime = Number(((seg.startSec + seg.endSec) / 2).toFixed(3));
    const leftText = words.slice(0, midIdx).join(' ');
    const rightText = words.slice(midIdx).join(' ');

    const left: TranscriptSegment = {
      ...seg,
      endSec: midTime,
      text: leftText,
      userEdited: true,
      words: buildWordTokensForSegment({
        segmentId: seg.id,
        text: leftText,
        startSec: seg.startSec,
        endSec: midTime,
        style: settings.romanizationStyle,
        customVocabulary: settings.customVocabulary,
      }),
    };
    const rightId = createId('seg');
    const right: TranscriptSegment = {
      ...seg,
      id: rightId,
      startSec: midTime,
      text: rightText,
      userEdited: true,
      words: buildWordTokensForSegment({
        segmentId: rightId,
        text: rightText,
        startSec: midTime,
        endSec: seg.endSec,
        style: settings.romanizationStyle,
        customVocabulary: settings.customVocabulary,
      }),
    };

    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: (prev.transcriptSegments ?? []).flatMap((s) =>
        s.id === seg.id ? [left, right] : [s]
      ),
    }));
  };

  const deleteSegment = (segId: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: (prev.transcriptSegments ?? []).filter((s) => s.id !== segId),
    }));
  };

  const addManualSegment = () => {
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
    const s0 = Number(lastEnd.toFixed(2));
    const s1 = Number((s0 + 2.5).toFixed(2));
    const conv = processTextToRomanHinglish(
      'Ye asli jannat hai bhai!',
      settings.romanizationStyle,
      settings.customVocabulary
    );
    const segId = createId('seg');
    const newSeg: TranscriptSegment = {
      id: segId,
      startSec: s0,
      endSec: s1,
      text: conv.text,
      rawText: 'Ye asli jannat hai bhai!',
      language: 'hi-en',
      script: 'latin',
      userEdited: true,
      uncertain: false,
      words: buildWordTokensForSegment({
        segmentId: segId,
        text: conv.text,
        startSec: s0,
        endSec: s1,
        style: settings.romanizationStyle,
        customVocabulary: settings.customVocabulary,
      }),
    };
    onUpdateProject((prev) => ({
      ...prev,
      transcriptSegments: [...(prev.transcriptSegments ?? []), newSeg],
    }));
  };

  return (
    <div className="space-y-3 text-xs">
      {/* Model Readiness & Actions */}
      <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-900 dark:text-[#F4F5F7]">Local AI Studio</span>
          <span
            className={`text-[10px] font-mono-tabular px-1.5 py-0.5 rounded ${
              whisperReady
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            {whisperReady ? 'Whisper Ready' : 'Model Not Downloaded'}
          </span>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-[#8E95A5]">
          {modelDef?.name ?? modelId} · Runs locally on your device. No cloud video upload.
        </p>

        {!whisperReady && (
          <button
            type="button"
            disabled={Boolean(busyStage)}
            onClick={() => handleExplicitDownload(modelId)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 font-medium cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Download {modelDef?.sizeMb ?? 237} MB Model
          </button>
        )}

        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            disabled={Boolean(busyStage) || !primaryMedia}
            onClick={handleTranscribeSpeech}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-teal-600 hover:bg-teal-500 disabled:opacity-45 text-white font-medium cursor-pointer"
          >
            <Mic className="w-3.5 h-3.5" />
            Generate Captions (Whisper)
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={Boolean(busyStage) || !primaryMedia}
              onClick={handleScanVadOnly}
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-[11px] text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 disabled:opacity-45 cursor-pointer"
            >
              <Sparkles className="w-3 h-3 text-teal-400" />
              Scan VAD
            </button>
            <button
              type="button"
              disabled={Boolean(busyStage) || !project.media.some((m) => m.type === 'video')}
              onClick={() => handleAnalyzeScene(false)}
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-[11px] text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 disabled:opacity-45 cursor-pointer"
            >
              <Eye className="w-3 h-3 text-sky-400" />
              Analyze Scene
            </button>
          </div>
        </div>

        {busyStage && (
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-[11px] text-teal-400">
              <span className="truncate">{busyStage}</span>
              <span className="font-mono-tabular">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full bg-teal-500 transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-400 space-y-1.5">
            <p>{errorMsg}</p>
            {needsDownloadModelId && (
              <button
                type="button"
                onClick={() => handleExplicitDownload(needsDownloadModelId)}
                className="inline-flex items-center gap-1 text-teal-400 underline cursor-pointer"
              >
                <Download className="w-3 h-3" />
                Download required model now
              </button>
            )}
          </div>
        )}
      </div>

      {/* VAD & Scene Diagnostics Summary */}
      {vadWindows && (
        <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22]/70 p-2.5 space-y-1">
          <p className="text-[11px] font-medium text-slate-900 dark:text-[#F4F5F7]">
            VAD ({vadWindows.engine}): {vadWindows.windows.length} speech chunk(s)
          </p>
          <div className="flex flex-wrap gap-1">
            {vadWindows.windows.map((w, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSeekTo(w.startSec)}
                className="px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-400 font-mono-tabular text-[10px] cursor-pointer"
              >
                {formatDuration(w.startSec)}–{formatDuration(w.endSec)}
              </button>
            ))}
          </div>
        </div>
      )}

      {project.sceneMap && (
        <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22]/70 p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {project.sceneMap.scenes.length} scene(s) mapped
            </span>
            <button
              type="button"
              onClick={() => handleAnalyzeScene(true)}
              title="Re-analyze scene"
              className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-[#8E95A5]">
            {faceReady ? 'Face/Mouth avoidance active' : 'Grid negative-space mapping active'}
          </p>
        </div>
      )}

      {/* Romanization Style Control */}
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500 dark:text-[#8E95A5] block">
          Roman Hinglish Style
        </label>
        <select
          value={settings.romanizationStyle}
          onChange={(e) => {
            const nextStyle = e.target.value as RomanizationStyle;
            onUpdateSettings({ romanizationStyle: nextStyle });
            if (segments.length > 0) {
              onUpdateProject((prev) => ({
                ...prev,
                transcriptSegments: reRomanizeTranscriptSegments(
                  prev.transcriptSegments ?? [],
                  nextStyle,
                  settings.customVocabulary
                ),
              }));
            }
          }}
          className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
        >
          <option value="natural-hinglish">Natural Hinglish (Conversation)</option>
          <option value="phonetic-roman">Phonetic Roman</option>
          <option value="preserve-english">Preserve English Strictly</option>
        </select>
      </div>

      {/* Transcript Segment + Word-Level Editor */}
      <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-white/8">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-900 dark:text-[#F4F5F7]">
            Transcript ({segments.length})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={addManualSegment}
              title="Add caption segment manually"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-white/10 text-[10px] text-slate-600 dark:text-[#8E95A5] hover:text-white cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              Add Line
            </button>
          </div>
        </div>

        {segments.length === 0 ? (
          <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] py-3 text-center">
            Run Whisper transcription or add a caption line manually to build smart mouth-safe kinetic captions.
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
            {segments.map((seg, segIdx) => {
              const isExpanded = expandedSegId === seg.id;
              const showingRaw = Boolean(showRawForId[seg.id]);
              const isPlaying = playingSegId === seg.id;
              const hasModelAligned = seg.words.some((w) => w.timingSource === 'model-aligned');

              return (
                <div
                  key={seg.id}
                  className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] p-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-1 text-[10px] font-mono-tabular text-slate-400">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onSeekTo(seg.startSec)}
                        className="inline-flex items-center gap-1 text-teal-400 hover:underline cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5" />
                        {seg.startSec.toFixed(1)}s–{seg.endSec.toFixed(1)}s
                      </button>
                      {primaryMedia && (
                        <button
                          type="button"
                          title={isPlaying ? 'Stop audio snippet' : 'Play segment audio snippet'}
                          onClick={() => playSegmentSnippet(seg)}
                          className="p-0.5 rounded hover:text-white cursor-pointer"
                        >
                          {isPlaying ? (
                            <Square className="w-2.5 h-2.5 text-rose-400" />
                          ) : (
                            <Volume2 className="w-2.5 h-2.5 text-sky-400" />
                          )}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {seg.uncertain && (
                        <span title="Check script conversion" className="text-amber-400">
                          <AlertTriangle className="w-3 h-3" />
                        </span>
                      )}
                      {seg.rawText && seg.rawText !== seg.text && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowRawForId((p) => ({ ...p, [seg.id]: !p[seg.id] }))
                          }
                          title="Compare raw ASR text vs Romanized caption"
                          className={`px-1 rounded text-[9px] border cursor-pointer ${
                            showingRaw
                              ? 'border-sky-500/40 text-sky-300'
                              : 'border-white/10 text-slate-400'
                          }`}
                        >
                          Raw
                        </button>
                      )}
                      {segIdx < segments.length - 1 && (
                        <button
                          type="button"
                          onClick={() => mergeSegmentWithNext(seg.id)}
                          title="Merge with next segment"
                          className="p-0.5 hover:text-white cursor-pointer"
                        >
                          <GitMerge className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => splitSegmentAtMid(seg)}
                        title="Split segment"
                        className="p-0.5 hover:text-white cursor-pointer"
                      >
                        <Scissors className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSegment(seg.id)}
                        title="Delete segment"
                        className="p-0.5 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {showingRaw && (
                    <p className="text-[10px] text-sky-300 bg-sky-500/10 rounded px-1.5 py-1 font-mono-tabular">
                      Raw: {seg.rawText}
                    </p>
                  )}

                  <textarea
                    rows={2}
                    value={seg.text}
                    onChange={(e) => updateSegmentText(seg.id, e.target.value)}
                    className="w-full rounded border border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] px-2 py-1 text-xs text-slate-900 dark:text-[#F4F5F7]"
                  />

                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <button
                      type="button"
                      onClick={() => setExpandedSegId(isExpanded ? null : seg.id)}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                      Words ({seg.words.length}) ·{' '}
                      <span className={hasModelAligned ? 'text-emerald-400' : 'text-amber-400'}>
                        {hasModelAligned ? 'model-aligned' : 'estimated'}
                      </span>
                    </button>

                    <div className="flex items-center gap-1 font-mono-tabular">
                      <button
                        type="button"
                        title="Nudge segment -0.1s"
                        onClick={() => nudgeSegmentRange(seg, -0.1)}
                        className="px-1 rounded border border-white/10 hover:text-white cursor-pointer"
                      >
                        -0.1s
                      </button>
                      <button
                        type="button"
                        title="Nudge segment +0.1s"
                        onClick={() => nudgeSegmentRange(seg, 0.1)}
                        className="px-1 rounded border border-white/10 hover:text-white cursor-pointer"
                      >
                        +0.1s
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-white/8">
                      {seg.words.map((w, wIdx) => (
                        <div
                          key={w.id}
                          className="grid grid-cols-[1fr_54px_54px_auto] gap-1 items-center text-[10px]"
                        >
                          <input
                            type="text"
                            aria-label={`Word ${wIdx + 1}`}
                            value={w.word}
                            onChange={(e) => {
                              const next = seg.words.map((item, i) =>
                                i === wIdx ? { ...item, word: e.target.value } : item
                              );
                              updateSegmentWords(seg.id, next);
                            }}
                            className="rounded border border-white/10 bg-[#121418] px-1.5 py-0.5 text-[#F4F5F7]"
                          />
                          <input
                            type="number"
                            step={0.05}
                            value={w.startSec}
                            aria-label={`Word ${wIdx + 1} start`}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const next = seg.words.map((item, i) =>
                                i === wIdx ? { ...item, startSec: Math.max(0, val) } : item
                              );
                              updateSegmentWords(seg.id, next);
                            }}
                            className="rounded border border-white/10 bg-[#121418] px-1 py-0.5 font-mono-tabular text-[#CBD5E1]"
                          />
                          <input
                            type="number"
                            step={0.05}
                            value={w.endSec}
                            aria-label={`Word ${wIdx + 1} end`}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              const next = seg.words.map((item, i) =>
                                i === wIdx
                                  ? { ...item, endSec: Math.max(item.startSec + 0.05, val) }
                                  : item
                              );
                              updateSegmentWords(seg.id, next);
                            }}
                            className="rounded border border-white/10 bg-[#121418] px-1 py-0.5 font-mono-tabular text-[#CBD5E1]"
                          />
                          {wIdx < seg.words.length - 1 ? (
                            <button
                              type="button"
                              title="Merge with next word"
                              onClick={() => mergeWithNextWord(seg, wIdx)}
                              className="px-1 py-0.5 rounded border border-white/10 text-slate-400 hover:text-white cursor-pointer"
                            >
                              +
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {segments.length > 0 && (
          <button
            type="button"
            onClick={handleApplyCaptionsToTimeline}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Apply Smart Captions to Timeline
          </button>
        )}
      </div>
    </div>
  );
}
