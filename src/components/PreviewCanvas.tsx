import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Scan,
  SkipBack,
} from 'lucide-react';
import { CutFlowProject, FitMode, PerformanceMode } from '../types/project';
import {
  computeClipAudioGain,
  computeProjectDuration,
  formatTimecode,
  mapTimelineTimeToSourceTime,
} from '../utils/timelineMath';
import { ProjectMediaPool, renderProjectFrame } from '../services/compositor';
import { playPreviewSoundCue } from '../services/soundDesign';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

interface PreviewCanvasProps {
  project: CutFlowProject;
  currentTime: number;
  isPlaying: boolean;
  previewFitMode: FitMode;
  performanceMode?: PerformanceMode;
  onTimeChange: (timeSec: number) => void;
  onTogglePlay: () => void;
  onPreviewFitModeChange: (mode: FitMode) => void;
}

export function PreviewCanvas({
  project,
  currentTime,
  isPlaying,
  previewFitMode,
  performanceMode = 'balanced',
  onTimeChange,
  onTogglePlay,
  onPreviewFitModeChange,
}: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poolRef = useRef<ProjectMediaPool | null>(null);
  const timeRef = useRef(currentTime);
  const projectRef = useRef(project);
  const playedCuesRef = useRef<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showGuides, setShowGuides] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });

  timeRef.current = currentTime;
  projectRef.current = project;

  const totalDuration = Math.max(0.1, computeProjectDuration(project));
  const frameStepSec = 1 / Math.max(1, project.fps || 30);

  const previewScale =
    performanceMode === 'low-memory' ? 0.5 : performanceMode === 'balanced' ? 0.67 : 1;
  const internalWidth = Math.max(320, Math.round(project.width * previewScale));
  const internalHeight = Math.max(320, Math.round(project.height * previewScale));

  useEffect(() => {
    const pool = new ProjectMediaPool();
    poolRef.current = pool;
    return () => {
      pool.dispose();
      poolRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pool = poolRef.current;
    if (!pool) return;
    pool.preloadProject(project);
  }, [project.media]);

  // Reset triggered sound cue memory when paused/scrubbed
  useEffect(() => {
    if (!isPlaying) {
      playedCuesRef.current.clear();
    }
  }, [isPlaying, currentTime]);

  // Render paused/scrubbed frame immediately
  useEffect(() => {
    if (isPlaying) return;
    const canvas = canvasRef.current;
    const pool = poolRef.current;
    if (!canvas || !pool) return;

    for (const m of project.media) {
      const cached = pool.getCached(m.id);
      if (cached?.video && !cached.video.paused) cached.video.pause();
      if (cached?.audio && !cached.audio.paused) cached.audio.pause();
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    renderProjectFrame({
      ctx,
      project,
      timeSec: currentTime,
      pool,
      canvasWidth: internalWidth,
      canvasHeight: internalHeight,
      seekVideos: true,
      showGuides,
    }).then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [project, currentTime, isPlaying, internalWidth, internalHeight, showGuides]);

  // Playback loop when playing
  useEffect(() => {
    if (!isPlaying) return;
    const canvas = canvasRef.current;
    const pool = poolRef.current;
    if (!canvas || !pool) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastNow = performance.now();
    let localTime = timeRef.current;
    playedCuesRef.current.clear();

    const tick = async (now: number) => {
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const prevTime = localTime;
      localTime += dt;

      const proj = projectRef.current;
      const maxDur = Math.max(0.1, computeProjectDuration(proj));
      if (localTime >= maxDur) {
        onTimeChange(0);
        onTogglePlay();
        return;
      }

      onTimeChange(localTime);

      // Fire procedural sound cues when crossing cue timestamp
      for (const cue of proj.soundCues ?? []) {
        if (
          cue.effect !== 'none' &&
          !playedCuesRef.current.has(cue.id) &&
          cue.timeSec >= prevTime - 0.03 &&
          cue.timeSec <= localTime + 0.03
        ) {
          playedCuesRef.current.add(cue.id);
          playPreviewSoundCue(cue.effect, cue.volume);
        }
      }

      const activeIds = new Set<string>();
      for (const clip of proj.clips) {
        if (localTime >= clip.startTime && localTime < clip.startTime + clip.duration) {
          activeIds.add(clip.mediaId);
          const cached = pool.getCached(clip.mediaId);
          const track = proj.tracks.find((t) => t.id === clip.trackId);
          const trackMuted = track?.muted ?? false;
          const gain = trackMuted ? 0 : computeClipAudioGain(clip, localTime);
          const targetSourceTime = mapTimelineTimeToSourceTime(clip, localTime);

          if (cached?.video) {
            cached.video.muted = gain <= 0.001;
            cached.video.volume = Math.min(1, gain);
            cached.video.playbackRate = Math.max(0.25, Math.min(4, clip.speed || 1));
            if (Math.abs(cached.video.currentTime - targetSourceTime) > 0.25) {
              cached.video.currentTime = targetSourceTime;
            }
            if (cached.video.paused) {
              cached.video.play().catch(() => undefined);
            }
          }
          if (cached?.audio) {
            cached.audio.muted = gain <= 0.001;
            cached.audio.volume = Math.min(1, gain);
            cached.audio.playbackRate = Math.max(0.25, Math.min(4, clip.speed || 1));
            if (Math.abs(cached.audio.currentTime - targetSourceTime) > 0.25) {
              cached.audio.currentTime = targetSourceTime;
            }
            if (cached.audio.paused) {
              cached.audio.play().catch(() => undefined);
            }
          }
        }
      }

      for (const m of proj.media) {
        if (!activeIds.has(m.id)) {
          const cached = pool.getCached(m.id);
          if (cached?.video && !cached.video.paused) cached.video.pause();
          if (cached?.audio && !cached.audio.paused) cached.audio.pause();
        }
      }

      await renderProjectFrame({
        ctx,
        project: proj,
        timeSec: localTime,
        pool,
        canvasWidth: internalWidth,
        canvasHeight: internalHeight,
        seekVideos: false,
        showGuides,
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      for (const m of projectRef.current.media) {
        const cached = pool.getCached(m.id);
        if (cached?.video && !cached.video.paused) cached.video.pause();
        if (cached?.audio && !cached.audio.paused) cached.audio.pause();
      }
    };
  }, [isPlaying, internalWidth, internalHeight, showGuides, onTimeChange, onTogglePlay]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore if fullscreen blocked by iframe sandbox
    }
  };

  const stepFrames = (delta: number) => {
    const next = Math.max(0, Math.min(totalDuration, currentTime + delta * frameStepSec));
    onTimeChange(Number(next.toFixed(4)));
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ open: true, x: e.clientX, y: e.clientY });
  };

  const monitorMenuItems: ContextMenuItem[] = [
    {
      id: 'play-pause',
      label: isPlaying ? 'Pause Program' : 'Play Program',
      shortcut: 'Space',
      onSelect: onTogglePlay,
    },
    {
      id: 'step-back',
      label: 'Step Back 1 Frame',
      shortcut: '←',
      onSelect: () => stepFrames(-1),
    },
    {
      id: 'step-fwd',
      label: 'Step Forward 1 Frame',
      shortcut: '→',
      onSelect: () => stepFrames(1),
    },
    { type: 'divider', id: 'div-1' },
    {
      id: 'guides',
      label: showGuides ? 'Hide Safe Margins & Face Guides' : 'Show Safe Margins & Face Guides',
      onSelect: () => setShowGuides((g) => !g),
    },
    {
      id: 'fit',
      label: previewFitMode === 'fit' ? 'Switch to Fill Viewport' : 'Switch to Fit Viewport',
      onSelect: () => onPreviewFitModeChange(previewFitMode === 'fit' ? 'fill' : 'fit'),
    },
    {
      id: 'fs',
      label: isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Monitor',
      onSelect: toggleFullscreen,
    },
  ];

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      className="flex flex-col h-full bg-slate-100 dark:bg-[#0B0C0E] select-none"
    >
      {/* Program Monitor Header Strip */}
      <div className="h-8 shrink-0 border-b border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] px-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-[#8E95A5]">
        <span className="font-medium text-slate-700 dark:text-[#F4F5F7]">
          Program: {project.name}
        </span>
        <span className="font-mono-tabular">
          {project.width}×{project.height} · {project.fps}fps
        </span>
      </div>

      {/* Preview Viewport */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
        <div
          className="relative flex items-center justify-center rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-[#0B0C0E] shadow-lg"
          style={{
            aspectRatio: `${project.width} / ${project.height}`,
            maxHeight: '100%',
            maxWidth: '100%',
            width: previewFitMode === 'fill' ? '100%' : 'auto',
            height: previewFitMode === 'fit' ? '100%' : 'auto',
          }}
        >
          <canvas
            ref={canvasRef}
            data-testid="preview-canvas"
            width={internalWidth}
            height={internalHeight}
            className="w-full h-full object-contain block"
          />
          {project.clips.length === 0 &&
            project.textLayers.length === 0 &&
            project.overlayLayers.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                <p className="text-sm font-medium text-[#8E95A5]">
                  Canvas ready ({project.aspectRatio})
                </p>
                <p className="text-xs text-[#8E95A5]/70 mt-1">
                  Import media or add a layer from the left panel to begin
                </p>
              </div>
            )}
        </div>
      </div>

      {/* Transport & Scaling Controls */}
      <div className="h-11 shrink-0 border-t border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-mono-tabular">
          <span className="text-teal-500 font-semibold">{formatTimecode(currentTime)}</span>
          <span className="text-slate-400 dark:text-[#8E95A5]">/</span>
          <span className="text-slate-500 dark:text-[#8E95A5]">{formatTimecode(totalDuration)}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onTimeChange(0)}
            aria-label="Jump to start"
            title="Jump to start (Home)"
            className="p-1.5 rounded-md text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => stepFrames(-1)}
            aria-label="Step back 1 frame"
            title="Step Back 1 Frame"
            className="p-1.5 rounded-md text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-teal-600 hover:bg-teal-500 text-white transition-colors cursor-pointer mx-0.5"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => stepFrames(1)}
            aria-label="Step forward 1 frame"
            title="Step Forward 1 Frame"
            className="p-1.5 rounded-md text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowGuides((g) => !g)}
            aria-pressed={showGuides}
            title="Toggle Safe Margins & AI Face Guides"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border cursor-pointer ${
              showGuides
                ? 'border-teal-500 bg-teal-500/15 text-teal-400'
                : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#8E95A5]'
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            Guides
          </button>

          <div className="flex items-center rounded-md border border-slate-200 dark:border-white/10 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => onPreviewFitModeChange('fit')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                previewFitMode === 'fit'
                  ? 'bg-slate-200 dark:bg-white/12 text-slate-900 dark:text-[#F4F5F7]'
                  : 'text-slate-500 dark:text-[#8E95A5]'
              }`}
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() => onPreviewFitModeChange('fill')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                previewFitMode === 'fill'
                  ? 'bg-slate-200 dark:bg-white/12 text-slate-900 dark:text-[#F4F5F7]'
                  : 'text-slate-500 dark:text-[#8E95A5]'
              }`}
            >
              Fill
            </button>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'}
            title="Fullscreen preview"
            className="p-1.5 rounded-md text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={monitorMenuItems}
        onClose={() => setCtxMenu((c) => ({ ...c, open: false }))}
      />
    </div>
  );
}
