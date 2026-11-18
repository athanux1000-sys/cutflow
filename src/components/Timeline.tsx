import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  Hand,
  Lock,
  Magnet,
  MousePointer2,
  MoveHorizontal,
  RotateCcw,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CutFlowProject,
  InputPreferences,
  OverlayLayer,
  SelectionTarget,
  TextLayer,
  TimelineClip,
  TimelineTool,
  TimelineTrack,
} from '../types/project';
import {
  clampTrimEnd,
  clampTrimStart,
  computeProjectDuration,
  defaultColorAdjustments,
  formatDuration,
  snapTime,
  splitClipAtTime,
} from '../utils/timelineMath';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

interface TimelineProps {
  project: CutFlowProject;
  currentTime: number;
  selection: SelectionTarget;
  inputPreferences?: InputPreferences;
  onSeek: (timeSec: number) => void;
  onSelect: (target: SelectionTarget) => void;
  onUpdateProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
  onSplitAtPlayhead: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onDropAssetOnTrack: (mediaId: string, trackId: string, startTime: number) => void;
}

type DragState =
  | {
      mode: 'move-clip';
      id: string;
      initialX: number;
      initialStart: number;
      trackId: string;
    }
  | {
      mode: 'trim-left';
      id: string;
      initialX: number;
      origClip: TimelineClip;
    }
  | {
      mode: 'trim-right';
      id: string;
      initialX: number;
      origClip: TimelineClip;
      maxSourceDuration: number;
    }
  | {
      mode: 'move-text' | 'move-overlay';
      id: string;
      initialX: number;
      initialStart: number;
    }
  | {
      mode: 'trim-text-right' | 'trim-overlay-right';
      id: string;
      initialX: number;
      initialDuration: number;
    }
  | {
      mode: 'hand-pan';
      initialX: number;
      initialScrollLeft: number;
    };

export function Timeline({
  project,
  currentTime,
  selection,
  inputPreferences,
  onSeek,
  onSelect,
  onUpdateProject,
  onSplitAtPlayhead,
  onDeleteSelected,
  onDuplicateSelected,
  onDropAssetOnTrack,
}: TimelineProps) {
  const [pxPerSec, setPxPerSec] = useState(56);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [activeTool, setActiveTool] = useState<TimelineTool>(
    inputPreferences?.defaultTimelineTool ?? 'select'
  );
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>({ open: false, x: 0, y: 0, items: [] });

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (inputPreferences?.defaultTimelineTool) {
      setActiveTool(inputPreferences.defaultTimelineTool);
    }
  }, [inputPreferences?.defaultTimelineTool]);

  // Tool keyboard shortcuts: V (Select), C (Razor), B (Trim), H (Hand)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'v') setActiveTool('select');
      else if (k === 'c') setActiveTool('razor');
      else if (k === 'b') setActiveTool('trim');
      else if (k === 'h') setActiveTool('hand');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const projectDuration = computeProjectDuration(project);
  const displayDuration = Math.max(30, Math.ceil(projectDuration + 12));
  const timelineWidth = Math.max(700, displayDuration * pxPerSec);

  const snapCandidates = useMemo(() => {
    const pts = [0, currentTime];
    for (const c of project.clips) {
      pts.push(c.startTime, c.startTime + c.duration);
    }
    for (const t of project.textLayers) {
      pts.push(t.startTime, t.startTime + t.duration);
    }
    for (const o of project.overlayLayers) {
      pts.push(o.startTime, o.startTime + o.duration);
    }
    return pts;
  }, [project.clips, project.textLayers, project.overlayLayers, currentTime]);

  const rulerStep = pxPerSec >= 90 ? 1 : pxPerSec >= 45 ? 2 : 5;
  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let s = 0; s <= displayDuration; s += rulerStep) {
      ticks.push(s);
    }
    return ticks;
  }, [displayDuration, rulerStep]);

  const timeFromClientX = (clientX: number): number => {
    const container = scrollContainerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left + container.scrollLeft;
    return Math.max(0, x / pxPerSec);
  };

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const seekTo = timeFromClientX(e.clientX);
    onSeek(Math.min(project.maxDurationSec, seekTo));
    const onMove = (ev: PointerEvent) => {
      onSeek(Math.min(project.maxDurationSec, timeFromClientX(ev.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggleTrackProp = (trackId: string, prop: 'muted' | 'locked' | 'visible') => {
    onUpdateProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, [prop]: !t[prop] } : t)),
    }));
  };

  const splitSpecificClipAt = (clipId: string, splitTime: number) => {
    onUpdateProject((prev) => {
      const target = prev.clips.find((c) => c.id === clipId);
      if (!target) return prev;
      const track = prev.tracks.find((t) => t.id === target.trackId);
      if (track?.locked) return prev;
      const split = splitClipAtTime(target, splitTime);
      if (!split) return prev;
      return {
        ...prev,
        clips: prev.clips.flatMap((c) => (c.id === clipId ? [split[0], split[1]] : [c])),
      };
    });
  };

  const handleWheelOnTimeline = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const sensitivity = inputPreferences?.touchBarScrubSensitivity ?? 1;
    const invert = inputPreferences?.invertScroll ? -1 : 1;
    const shouldZoom = e.ctrlKey || e.metaKey || inputPreferences?.scrollMode === 'zoom';

    if (shouldZoom) {
      e.preventDefault();
      const delta = (-e.deltaY * 0.14 * sensitivity * invert);
      setPxPerSec((z) => Math.max(20, Math.min(180, Math.round(z + delta))));
    } else if (Math.abs(e.deltaY) > 0 || Math.abs(e.deltaX) > 0) {
      const horiz = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * sensitivity * invert;
      container.scrollLeft += horiz;
    }
  };

  const startDrag = (state: DragState, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = state;

    const onMove = (ev: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;

      if (current.mode === 'hand-pan') {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft =
            current.initialScrollLeft - (ev.clientX - current.initialX);
        }
        return;
      }

      const dxSec = (ev.clientX - current.initialX) / pxPerSec;

      if (current.mode === 'move-clip') {
        let nextStart = Math.max(0, current.initialStart + dxSec);
        if (snapEnabled) nextStart = snapTime(nextStart, snapCandidates);
        onUpdateProject((prev) => ({
          ...prev,
          clips: prev.clips.map((c) => (c.id === current.id ? { ...c, startTime: nextStart } : c)),
        }));
      } else if (current.mode === 'trim-left') {
        let targetStart = current.origClip.startTime + dxSec;
        if (snapEnabled) targetStart = snapTime(targetStart, snapCandidates);
        const updated = clampTrimStart(current.origClip, targetStart);
        onUpdateProject((prev) => ({
          ...prev,
          clips: prev.clips.map((c) => (c.id === current.id ? updated : c)),
        }));
      } else if (current.mode === 'trim-right') {
        const targetDur = current.origClip.duration + dxSec;
        const updated = clampTrimEnd(current.origClip, targetDur, current.maxSourceDuration);
        onUpdateProject((prev) => ({
          ...prev,
          clips: prev.clips.map((c) => (c.id === current.id ? updated : c)),
        }));
      } else if (current.mode === 'move-text') {
        let nextStart = Math.max(0, current.initialStart + dxSec);
        if (snapEnabled) nextStart = snapTime(nextStart, snapCandidates);
        onUpdateProject((prev) => ({
          ...prev,
          textLayers: prev.textLayers.map((t) =>
            t.id === current.id ? { ...t, startTime: nextStart } : t
          ),
        }));
      } else if (current.mode === 'move-overlay') {
        let nextStart = Math.max(0, current.initialStart + dxSec);
        if (snapEnabled) nextStart = snapTime(nextStart, snapCandidates);
        onUpdateProject((prev) => ({
          ...prev,
          overlayLayers: prev.overlayLayers.map((o) =>
            o.id === current.id ? { ...o, startTime: nextStart } : o
          ),
        }));
      } else if (current.mode === 'trim-text-right') {
        const nextDur = Math.max(0.25, Number((current.initialDuration + dxSec).toFixed(3)));
        onUpdateProject((prev) => ({
          ...prev,
          textLayers: prev.textLayers.map((t) =>
            t.id === current.id ? { ...t, duration: nextDur } : t
          ),
        }));
      } else if (current.mode === 'trim-overlay-right') {
        const nextDur = Math.max(0.25, Number((current.initialDuration + dxSec).toFixed(3)));
        onUpdateProject((prev) => ({
          ...prev,
          overlayLayers: prev.overlayLayers.map((o) =>
            o.id === current.id ? { ...o, duration: nextDur } : o
          ),
        }));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const openClipContextMenu = (e: React.MouseEvent, clip: TimelineClip, track: TimelineTrack) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect({ kind: 'clip', id: clip.id });
    const clickTime = timeFromClientX(e.clientX);
    const items: ContextMenuItem[] = [
      {
        id: 'split-here',
        label: 'Split Clip Here',
        shortcut: 'C',
        icon: <Scissors className="w-3.5 h-3.5" />,
        disabled: track.locked,
        onSelect: () => splitSpecificClipAt(clip.id, clickTime),
      },
      {
        id: 'dup-clip',
        label: 'Duplicate Clip',
        icon: <Copy className="w-3.5 h-3.5" />,
        onSelect: () => {
          onSelect({ kind: 'clip', id: clip.id });
          onDuplicateSelected();
        },
      },
      {
        id: 'mute-clip',
        label: clip.muted ? 'Unmute Clip' : 'Mute Clip',
        icon: clip.muted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />,
        onSelect: () =>
          onUpdateProject((prev) => ({
            ...prev,
            clips: prev.clips.map((c) => (c.id === clip.id ? { ...c, muted: !c.muted } : c)),
          })),
      },
      {
        id: 'reset-grade',
        label: 'Reset Color Grade',
        icon: <RotateCcw className="w-3.5 h-3.5" />,
        onSelect: () =>
          onUpdateProject((prev) => ({
            ...prev,
            clips: prev.clips.map((c) =>
              c.id === clip.id ? { ...c, color: defaultColorAdjustments() } : c
            ),
          })),
      },
      { type: 'divider', id: 'd1' },
      {
        id: 'del-clip',
        label: 'Delete Clip',
        shortcut: 'Del',
        danger: true,
        icon: <Trash2 className="w-3.5 h-3.5" />,
        onSelect: () => {
          onUpdateProject((prev) => ({
            ...prev,
            clips: prev.clips.filter((c) => c.id !== clip.id),
          }));
          onSelect(null);
        },
      },
    ];
    setCtxMenu({ open: true, x: e.clientX, y: e.clientY, items });
  };

  const openTextContextMenu = (e: React.MouseEvent, txt: TextLayer) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect({ kind: 'text', id: txt.id });
    setCtxMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: 'jump-txt',
          label: 'Jump Playhead to Caption',
          onSelect: () => onSeek(txt.startTime),
        },
        {
          id: 'dup-txt',
          label: 'Duplicate Caption Layer',
          icon: <Copy className="w-3.5 h-3.5" />,
          onSelect: () => {
            onSelect({ kind: 'text', id: txt.id });
            onDuplicateSelected();
          },
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'del-txt',
          label: 'Delete Caption Layer',
          shortcut: 'Del',
          danger: true,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          onSelect: () => {
            onUpdateProject((prev) => ({
              ...prev,
              textLayers: prev.textLayers.filter((t) => t.id !== txt.id),
            }));
            onSelect(null);
          },
        },
      ],
    });
  };

  const openOverlayContextMenu = (e: React.MouseEvent, ovl: OverlayLayer) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect({ kind: 'overlay', id: ovl.id });
    setCtxMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: 'jump-ovl',
          label: 'Jump Playhead to Layer',
          onSelect: () => onSeek(ovl.startTime),
        },
        {
          id: 'dup-ovl',
          label: 'Duplicate Overlay',
          icon: <Copy className="w-3.5 h-3.5" />,
          onSelect: () => {
            onSelect({ kind: 'overlay', id: ovl.id });
            onDuplicateSelected();
          },
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'del-ovl',
          label: 'Delete Overlay',
          shortcut: 'Del',
          danger: true,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          onSelect: () => {
            onUpdateProject((prev) => ({
              ...prev,
              overlayLayers: prev.overlayLayers.filter((o) => o.id !== ovl.id),
            }));
            onSelect(null);
          },
        },
      ],
    });
  };

  const openTrackHeaderContextMenu = (e: React.MouseEvent, track: TimelineTrack) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(track.kind !== 'audio'
          ? [
              {
                id: 'vis',
                label: track.visible ? `Hide ${track.name}` : `Show ${track.name}`,
                onSelect: () => toggleTrackProp(track.id, 'visible'),
              },
            ]
          : []),
        ...(track.kind !== 'overlay'
          ? [
              {
                id: 'mute',
                label: track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`,
                onSelect: () => toggleTrackProp(track.id, 'muted'),
              },
            ]
          : []),
        {
          id: 'lock',
          label: track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`,
          onSelect: () => toggleTrackProp(track.id, 'locked'),
        },
      ],
    });
  };

  const renderTrackItems = (track: TimelineTrack) => {
    const trackClips = project.clips.filter((c) => c.trackId === track.id);
    const trackTexts = project.textLayers.filter((t) => t.trackId === track.id);
    const trackOverlays = project.overlayLayers.filter((o) => o.trackId === track.id);

    return (
      <>
        {trackClips.map((clip) => {
          const isSelected = selection?.kind === 'clip' && selection.id === clip.id;
          const media = project.media.find((m) => m.id === clip.mediaId);
          const maxSource = clip.kind === 'image' ? 600 : media?.durationSec ?? 600;
          const left = clip.startTime * pxPerSec;
          const width = Math.max(24, clip.duration * pxPerSec);

          return (
            <div
              key={clip.id}
              data-testid={`timeline-clip-${clip.id}`}
              onContextMenu={(e) => openClipContextMenu(e, clip, track)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                onSelect({ kind: 'clip', id: clip.id });
                if (activeTool === 'razor') {
                  e.stopPropagation();
                  splitSpecificClipAt(clip.id, timeFromClientX(e.clientX));
                  return;
                }
                if (activeTool === 'hand') {
                  startDrag(
                    {
                      mode: 'hand-pan',
                      initialX: e.clientX,
                      initialScrollLeft: scrollContainerRef.current?.scrollLeft ?? 0,
                    },
                    e
                  );
                  return;
                }
                if (!track.locked) {
                  startDrag(
                    {
                      mode: 'move-clip',
                      id: clip.id,
                      initialX: e.clientX,
                      initialStart: clip.startTime,
                      trackId: track.id,
                    },
                    e
                  );
                }
              }}
              style={{ left, width }}
              className={`absolute top-1.5 bottom-1.5 rounded-md overflow-hidden border transition-colors select-none ${
                track.locked
                  ? 'cursor-not-allowed opacity-75'
                  : activeTool === 'razor'
                    ? 'cursor-crosshair'
                    : activeTool === 'hand'
                      ? 'cursor-grab'
                      : 'cursor-grab active:cursor-grabbing'
              } ${
                isSelected
                  ? 'border-teal-400 ring-1 ring-teal-400 bg-teal-950/60'
                  : clip.kind === 'audio'
                    ? 'border-emerald-500/40 bg-emerald-950/50 hover:border-emerald-400/70'
                    : 'border-white/15 bg-[#202632] hover:border-white/30'
              }`}
            >
              {!track.locked && activeTool !== 'razor' && (
                <div
                  role="slider"
                  aria-label={`Trim start of ${clip.name}`}
                  aria-valuenow={clip.startTime}
                  onPointerDown={(e) => {
                    onSelect({ kind: 'clip', id: clip.id });
                    startDrag(
                      { mode: 'trim-left', id: clip.id, initialX: e.clientX, origClip: clip },
                      e
                    );
                  }}
                  className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-teal-400/60 z-10"
                />
              )}

              {media?.waveformPeaks && media.waveformPeaks.length > 0 && (
                <div className="absolute inset-x-1 bottom-0.5 h-4 flex items-end gap-px opacity-35 pointer-events-none">
                  {media.waveformPeaks.map((peak, idx) => (
                    <span
                      key={idx}
                      className="flex-1 bg-teal-300 rounded-t-xs"
                      style={{ height: `${Math.max(15, peak * 100)}%` }}
                    />
                  ))}
                </div>
              )}

              <div className="px-2.5 py-1 flex items-center justify-between gap-1 text-[11px] text-[#F4F5F7] relative z-[1]">
                <span className="truncate font-medium">
                  {clip.name}
                  {clip.muted ? ' (Muted)' : ''}
                </span>
                <span className="font-mono-tabular text-[10px] text-[#8E95A5] shrink-0">
                  {clip.duration.toFixed(1)}s
                </span>
              </div>

              {!track.locked && activeTool !== 'razor' && (
                <div
                  role="slider"
                  aria-label={`Trim end of ${clip.name}`}
                  aria-valuenow={clip.duration}
                  onPointerDown={(e) => {
                    onSelect({ kind: 'clip', id: clip.id });
                    startDrag(
                      {
                        mode: 'trim-right',
                        id: clip.id,
                        initialX: e.clientX,
                        origClip: clip,
                        maxSourceDuration: maxSource,
                      },
                      e
                    );
                  }}
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-teal-400/60 z-10"
                />
              )}
            </div>
          );
        })}

        {trackTexts.map((txt: TextLayer) => {
          const isSelected = selection?.kind === 'text' && selection.id === txt.id;
          return (
            <div
              key={txt.id}
              onContextMenu={(e) => openTextContextMenu(e, txt)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                onSelect({ kind: 'text', id: txt.id });
                if (!track.locked && activeTool !== 'razor') {
                  startDrag(
                    { mode: 'move-text', id: txt.id, initialX: e.clientX, initialStart: txt.startTime },
                    e
                  );
                }
              }}
              style={{ left: txt.startTime * pxPerSec, width: Math.max(24, txt.duration * pxPerSec) }}
              className={`absolute top-1.5 bottom-1.5 rounded-md border px-2 py-1 flex items-center justify-between text-[11px] select-none cursor-grab ${
                isSelected
                  ? 'border-amber-400 ring-1 ring-amber-400 bg-amber-950/60 text-amber-100'
                  : 'border-amber-500/35 bg-amber-950/40 text-amber-100 hover:border-amber-400/60'
              }`}
            >
              <span className="truncate font-medium">
                {txt.role === 'hero' ? '★ ' : 'T · '}
                {txt.text}
              </span>
              {!track.locked && (
                <div
                  onPointerDown={(e) =>
                    startDrag(
                      {
                        mode: 'trim-text-right',
                        id: txt.id,
                        initialX: e.clientX,
                        initialDuration: txt.duration,
                      },
                      e
                    )
                  }
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/60"
                />
              )}
            </div>
          );
        })}

        {trackOverlays.map((ovl: OverlayLayer) => {
          const isSelected = selection?.kind === 'overlay' && selection.id === ovl.id;
          return (
            <div
              key={ovl.id}
              onContextMenu={(e) => openOverlayContextMenu(e, ovl)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                onSelect({ kind: 'overlay', id: ovl.id });
                if (!track.locked && activeTool !== 'razor') {
                  startDrag(
                    { mode: 'move-overlay', id: ovl.id, initialX: e.clientX, initialStart: ovl.startTime },
                    e
                  );
                }
              }}
              style={{ left: ovl.startTime * pxPerSec, width: Math.max(24, ovl.duration * pxPerSec) }}
              className={`absolute top-1.5 bottom-1.5 rounded-md border px-2 py-1 flex items-center justify-between text-[11px] select-none cursor-grab ${
                isSelected
                  ? 'border-sky-400 ring-1 ring-sky-400 bg-sky-950/60 text-sky-100'
                  : 'border-sky-500/35 bg-sky-950/40 text-sky-100 hover:border-sky-400/60'
              }`}
            >
              <span className="truncate font-medium">{ovl.name}</span>
              {!track.locked && (
                <div
                  onPointerDown={(e) =>
                    startDrag(
                      {
                        mode: 'trim-overlay-right',
                        id: ovl.id,
                        initialX: e.clientX,
                        initialDuration: ovl.duration,
                      },
                      e
                    )
                  }
                  className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-sky-400/60"
                />
              )}
            </div>
          );
        })}
      </>
    );
  };

  const tools: Array<{ id: TimelineTool; label: string; shortcut: string; icon: typeof MousePointer2 }> = [
    { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
    { id: 'razor', label: 'Razor', shortcut: 'C', icon: Scissors },
    { id: 'trim', label: 'Trim', shortcut: 'B', icon: MoveHorizontal },
    { id: 'hand', label: 'Hand', shortcut: 'H', icon: Hand },
  ];

  return (
    <section
      aria-label="Timeline editor"
      className="h-64 shrink-0 border-t border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] flex flex-col"
    >
      {/* Premiere-style Timeline Action Bar & Tool Strip */}
      <div className="h-10 shrink-0 border-b border-slate-200 dark:border-white/8 px-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* Tool Strip */}
          <div className="flex items-center rounded-md border border-slate-200 dark:border-white/10 p-0.5 bg-slate-50 dark:bg-[#0E1014]">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => setActiveTool(tool.id)}
                  aria-pressed={active}
                  title={`${tool.label} Tool (${tool.shortcut})`}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                    active
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{tool.label}</span>
                </button>
              );
            })}
          </div>

          <span className="h-4 w-px bg-slate-200 dark:bg-white/10" />

          <button
            type="button"
            onClick={onSplitAtPlayhead}
            title="Split clip at playhead"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/8 cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            Split
          </button>
          <button
            type="button"
            disabled={!selection}
            onClick={onDuplicateSelected}
            title="Duplicate selected item"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/8 disabled:opacity-40 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate
          </button>
          <button
            type="button"
            disabled={!selection}
            onClick={onDeleteSelected}
            title="Delete selected item"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSnapEnabled((s) => !s)}
            aria-pressed={snapEnabled}
            title="Toggle magnetic snapping"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium cursor-pointer ${
              snapEnabled
                ? 'bg-teal-500/15 text-teal-400'
                : 'text-slate-500 dark:text-[#8E95A5] hover:bg-slate-100 dark:hover:bg-white/6'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            Snap
          </button>

          <div className="flex items-center gap-1.5 text-slate-500 dark:text-[#8E95A5]">
            <button
              type="button"
              aria-label="Zoom out timeline"
              onClick={() => setPxPerSec((z) => Math.max(20, z - 12))}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              aria-label="Timeline zoom"
              min={20}
              max={180}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(Number(e.target.value))}
              className="w-24 accent-teal-500"
            />
            <button
              type="button"
              aria-label="Zoom in timeline"
              onClick={() => setPxPerSec((z) => Math.min(180, z + 12))}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Tracks + Scrollable Ruler Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Track Controls Column */}
        <div className="w-44 shrink-0 border-r border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#101216] flex flex-col">
          <div className="h-6 border-b border-slate-200 dark:border-white/8 px-3 flex items-center text-[10px] text-slate-500 dark:text-[#8E95A5]">
            Tracks
          </div>
          <div className="flex-1 overflow-y-hidden">
            {project.tracks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((track) => (
                <div
                  key={track.id}
                  onContextMenu={(e) => openTrackHeaderContextMenu(e, track)}
                  className="h-12 border-b border-slate-200 dark:border-white/6 px-2.5 flex items-center justify-between gap-1"
                >
                  <span className="text-[11px] font-medium text-slate-700 dark:text-[#F4F5F7] truncate">
                    {track.name}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {track.kind !== 'audio' && (
                      <button
                        type="button"
                        onClick={() => toggleTrackProp(track.id, 'visible')}
                        aria-label={`${track.visible ? 'Hide' : 'Show'} ${track.name}`}
                        className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
                      >
                        {track.visible ? (
                          <Eye className="w-3 h-3" />
                        ) : (
                          <EyeOff className="w-3 h-3 text-amber-400" />
                        )}
                      </button>
                    )}
                    {track.kind !== 'overlay' && (
                      <button
                        type="button"
                        onClick={() => toggleTrackProp(track.id, 'muted')}
                        aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                        className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
                      >
                        {track.muted ? (
                          <VolumeX className="w-3 h-3 text-red-400" />
                        ) : (
                          <Volume2 className="w-3 h-3" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleTrackProp(track.id, 'locked')}
                      aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`}
                      className="p-1 rounded text-slate-400 hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
                    >
                      {track.locked ? (
                        <Lock className="w-3 h-3 text-amber-400" />
                      ) : (
                        <Unlock className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Scrollable Track Lanes */}
        <div
          ref={scrollContainerRef}
          onWheel={handleWheelOnTimeline}
          onPointerDown={(e) => {
            if (activeTool === 'hand' && e.button === 0) {
              startDrag(
                {
                  mode: 'hand-pan',
                  initialX: e.clientX,
                  initialScrollLeft: scrollContainerRef.current?.scrollLeft ?? 0,
                },
                e
              );
            }
          }}
          className={`flex-1 overflow-x-auto overflow-y-auto relative bg-slate-100 dark:bg-[#0B0C0E] ${
            activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) onSelect(null);
          }}
        >
          <div style={{ width: timelineWidth }} className="relative min-h-full">
            {/* Time Ruler */}
            <div
              onPointerDown={handleRulerPointerDown}
              className="h-6 sticky top-0 z-20 border-b border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] cursor-ew-resize select-none"
            >
              {rulerTicks.map((sec) => (
                <div
                  key={sec}
                  style={{ left: sec * pxPerSec }}
                  className="absolute top-0 bottom-0 border-l border-slate-300 dark:border-white/12 pl-1 text-[10px] font-mono-tabular text-slate-500 dark:text-[#8E95A5] leading-6"
                >
                  {formatDuration(sec)}
                </div>
              ))}
            </div>

            {/* Track Lanes */}
            {project.tracks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((track) => (
                <div
                  key={track.id}
                  data-testid={`track-lane-${track.id}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const t = timeFromClientX(e.clientX);
                    setCtxMenu({
                      open: true,
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        {
                          id: 'jump-here',
                          label: `Move Playhead to ${formatDuration(t)}`,
                          onSelect: () => onSeek(t),
                        },
                        {
                          id: 'toggle-snap',
                          label: snapEnabled ? 'Disable Snapping' : 'Enable Snapping',
                          onSelect: () => setSnapEnabled((s) => !s),
                        },
                        {
                          id: 'track-lock',
                          label: track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`,
                          onSelect: () => toggleTrackProp(track.id, 'locked'),
                        },
                      ],
                    });
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const mediaId = e.dataTransfer.getData('application/x-cutflow-media');
                    if (mediaId && !track.locked) {
                      onDropAssetOnTrack(mediaId, track.id, timeFromClientX(e.clientX));
                    }
                  }}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) onSelect(null);
                  }}
                  className="h-12 relative border-b border-slate-200 dark:border-white/6 bg-slate-50/50 dark:bg-[#0F1115]"
                >
                  {renderTrackItems(track)}
                </div>
              ))}

            {/* Playhead Indicator Line */}
            <div
              style={{ left: currentTime * pxPerSec }}
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-teal-400 z-30"
            >
              <div className="w-2.5 h-3 -ml-[5px] bg-teal-400 rounded-b-sm" />
            </div>
          </div>
        </div>
      </div>

      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenu.items}
        onClose={() => setCtxMenu((c) => ({ ...c, open: false }))}
      />
    </section>
  );
}
