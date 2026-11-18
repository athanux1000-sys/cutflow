import { useEffect, useState } from 'react';
import {
  AppSettings,
  CutFlowProject,
  FitMode,
  MediaAssetRef,
  OverlayLayer,
  OverlayShapeType,
  SelectionTarget,
  TextLayer,
  TimelineClip,
} from '../types/project';
import {
  computeProjectDuration,
  createId,
  defaultColorAdjustments,
  defaultTransform,
  splitClipAtTime,
} from '../utils/timelineMath';
import { InspectorPanel } from './InspectorPanel';
import { MediaBin } from './MediaBin';
import { PreviewCanvas } from './PreviewCanvas';
import { Timeline } from './Timeline';

interface EditorWorkspaceProps {
  project: CutFlowProject;
  settings: AppSettings;
  hideCaptionTools?: boolean;
  onChangeProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

export function EditorWorkspace({
  project,
  settings,
  hideCaptionTools = false,
  onChangeProject,
  onUpdateSettings,
}: EditorWorkspaceProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selection, setSelection] = useState<SelectionTarget>(null);
  const [previewFitMode, setPreviewFitMode] = useState<FitMode>('fit');

  const handleAddAssetToTimeline = (asset: MediaAssetRef, targetTrackId?: string, atTime?: number) => {
    const startTime =
      atTime !== undefined
        ? atTime
        : Number(computeProjectDuration(project).toFixed(2));

    let trackId = targetTrackId;
    if (!trackId) {
      if (asset.type === 'audio') {
        trackId = project.tracks.find((t) => t.kind === 'audio')?.id ?? 'track_audio_1';
      } else {
        trackId =
          project.tracks.find((t) => t.id === 'track_video_1')?.id ??
          project.tracks.find((t) => t.kind === 'video')?.id ??
          'track_video_1';
      }
    }

    const duration = Math.min(project.maxDurationSec - startTime, Math.max(0.5, asset.durationSec));
    if (duration <= 0.2) return;

    const newClip: TimelineClip = {
      id: createId('clip'),
      trackId,
      mediaId: asset.id,
      name: asset.name,
      kind: asset.type,
      startTime,
      duration,
      sourceIn: 0,
      sourceOut: duration,
      speed: 1,
      volume: 1,
      muted: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      transform: defaultTransform(),
      color: defaultColorAdjustments(),
    };

    onChangeProject((prev) => ({
      ...prev,
      clips: [...prev.clips, newClip],
    }));
    setSelection({ kind: 'clip', id: newClip.id });
  };

  const handleImportAsset = (asset: MediaAssetRef) => {
    onChangeProject((prev) => ({
      ...prev,
      media: [...prev.media, asset],
    }));
  };

  const handleRemoveAsset = (mediaId: string) => {
    onChangeProject((prev) => ({
      ...prev,
      media: prev.media.filter((m) => m.id !== mediaId),
      clips: prev.clips.filter((c) => c.mediaId !== mediaId),
      overlayLayers: prev.overlayLayers.filter((o) => o.mediaId !== mediaId),
    }));
    setSelection(null);
  };

  const handleAddTextLayer = (presetText: string) => {
    const overlayTrackId =
      project.tracks.find((t) => t.kind === 'overlay')?.id ??
      project.tracks[0]?.id ??
      'track_overlay_1';
    const layer: TextLayer = {
      id: createId('txt'),
      trackId: overlayTrackId,
      text: presetText,
      startTime: Number(currentTime.toFixed(2)),
      duration: 4,
      fontFamily: 'Space Grotesk',
      fontSize: 56,
      fontWeight: 600,
      color: '#F4F5F7',
      backgroundColor: 'rgba(11,12,14,0.55)',
      align: 'center',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      rotation: 0,
    };
    onChangeProject((prev) => ({
      ...prev,
      textLayers: [...prev.textLayers, layer],
    }));
    setSelection({ kind: 'text', id: layer.id });
  };

  const handleAddShapeOverlay = (shapeType: OverlayShapeType) => {
    const overlayTrackId =
      project.tracks.find((t) => t.kind === 'overlay')?.id ??
      project.tracks[0]?.id ??
      'track_overlay_1';
    const layer: OverlayLayer = {
      id: createId('ovl'),
      trackId: overlayTrackId,
      kind: 'shape',
      name: `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} Overlay`,
      shapeType,
      fillColor:
        shapeType === 'frame' || shapeType === 'line' ? 'transparent' : 'rgba(20,184,166,0.28)',
      strokeColor: '#14B8A6',
      strokeWidth: shapeType === 'line' ? 4 : 3,
      startTime: Number(currentTime.toFixed(2)),
      duration: 4,
      x: 0,
      y: shapeType === 'lower-third' ? 0.34 : 0,
      width: shapeType === 'lower-third' ? 0.8 : shapeType === 'circle' ? 0.25 : 0.45,
      height: shapeType === 'lower-third' ? 0.14 : shapeType === 'line' ? 0.02 : 0.28,
      scale: 1,
      opacity: 1,
      rotation: 0,
    };
    onChangeProject((prev) => ({
      ...prev,
      overlayLayers: [...prev.overlayLayers, layer],
    }));
    setSelection({ kind: 'overlay', id: layer.id });
  };

  const handleSplitAtPlayhead = () => {
    onChangeProject((prev) => {
      const targetClip =
        selection?.kind === 'clip'
          ? prev.clips.find((c) => c.id === selection.id)
          : prev.clips.find(
              (c) => currentTime > c.startTime + 0.2 && currentTime < c.startTime + c.duration - 0.2
            );

      if (!targetClip) return prev;
      const track = prev.tracks.find((t) => t.id === targetClip.trackId);
      if (track?.locked) return prev;

      const split = splitClipAtTime(targetClip, currentTime);
      if (!split) return prev;

      const [left, right] = split;
      return {
        ...prev,
        clips: prev.clips.flatMap((c) => (c.id === targetClip.id ? [left, right] : [c])),
      };
    });
  };

  const handleDeleteSelected = () => {
    if (!selection) return;
    onChangeProject((prev) => ({
      ...prev,
      clips:
        selection.kind === 'clip' ? prev.clips.filter((c) => c.id !== selection.id) : prev.clips,
      textLayers:
        selection.kind === 'text'
          ? prev.textLayers.filter((t) => t.id !== selection.id)
          : prev.textLayers,
      overlayLayers:
        selection.kind === 'overlay'
          ? prev.overlayLayers.filter((o) => o.id !== selection.id)
          : prev.overlayLayers,
    }));
    setSelection(null);
  };

  const handleDuplicateSelected = () => {
    if (!selection) return;
    if (selection.kind === 'clip') {
      const orig = project.clips.find((c) => c.id === selection.id);
      if (!orig) return;
      const copy: TimelineClip = {
        ...JSON.parse(JSON.stringify(orig)),
        id: createId('clip'),
        startTime: Number((orig.startTime + orig.duration).toFixed(3)),
      };
      onChangeProject((prev) => ({ ...prev, clips: [...prev.clips, copy] }));
      setSelection({ kind: 'clip', id: copy.id });
    } else if (selection.kind === 'text') {
      const orig = project.textLayers.find((t) => t.id === selection.id);
      if (!orig) return;
      const copy: TextLayer = {
        ...orig,
        id: createId('txt'),
        startTime: Number((orig.startTime + orig.duration).toFixed(3)),
      };
      onChangeProject((prev) => ({ ...prev, textLayers: [...prev.textLayers, copy] }));
      setSelection({ kind: 'text', id: copy.id });
    } else if (selection.kind === 'overlay') {
      const orig = project.overlayLayers.find((o) => o.id === selection.id);
      if (!orig) return;
      const copy: OverlayLayer = {
        ...orig,
        id: createId('ovl'),
        startTime: Number((orig.startTime + orig.duration).toFixed(3)),
      };
      onChangeProject((prev) => ({ ...prev, overlayLayers: [...prev.overlayLayers, copy] }));
      setSelection({ kind: 'overlay', id: copy.id });
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentTime((t) => Math.max(0, t - 1 / Math.max(1, project.fps || 30)));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentTime((t) => t + 1 / Math.max(1, project.fps || 30));
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selection) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, project.fps]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <MediaBin
          project={project}
          settings={settings}
          hideCaptionTools={hideCaptionTools}
          currentTime={currentTime}
          onImportAsset={handleImportAsset}
          onRemoveAsset={handleRemoveAsset}
          onAddAssetToTimeline={(asset, trackId, atTime) =>
            handleAddAssetToTimeline(asset, trackId, atTime)
          }
          onAddTextLayer={handleAddTextLayer}
          onAddShapeOverlay={handleAddShapeOverlay}
          onUpdateProject={onChangeProject}
          onUpdateSettings={onUpdateSettings}
          onSeekTo={(t) => {
            setIsPlaying(false);
            setCurrentTime(t);
          }}
        />

        <div className="flex-1 min-w-0 min-h-0">
          <PreviewCanvas
            project={project}
            currentTime={currentTime}
            isPlaying={isPlaying}
            previewFitMode={previewFitMode}
            performanceMode={settings.performanceMode}
            onTimeChange={setCurrentTime}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onPreviewFitModeChange={setPreviewFitMode}
          />
        </div>

        <InspectorPanel
          project={project}
          selection={selection}
          onUpdateProject={onChangeProject}
        />
      </div>

      <Timeline
        project={project}
        currentTime={currentTime}
        selection={selection}
        inputPreferences={settings.inputPreferences}
        onSeek={(t) => {
          setIsPlaying(false);
          setCurrentTime(t);
        }}
        onSelect={setSelection}
        onUpdateProject={onChangeProject}
        onSplitAtPlayhead={handleSplitAtPlayhead}
        onDeleteSelected={handleDeleteSelected}
        onDuplicateSelected={handleDuplicateSelected}
        onDropAssetOnTrack={(mediaId, trackId, startTime) => {
          const asset = project.media.find((m) => m.id === mediaId);
          if (asset) handleAddAssetToTimeline(asset, trackId, startTime);
        }}
      />
    </div>
  );
}
