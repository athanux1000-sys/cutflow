import React, { useRef, useState } from 'react';
import {
  Film,
  Image as ImageIcon,
  Layers,
  Music,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  AppSettings,
  CutFlowProject,
  MediaAssetRef,
  OverlayShapeType,
} from '../types/project';
import { formatDuration } from '../utils/timelineMath';
import { generateCalibrationClipFile, importMediaFile } from '../services/mediaEngine';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { TranscriptPanel } from './TranscriptPanel';

type DrawerTab = 'media' | 'text' | 'overlays' | 'ai';

interface MediaBinProps {
  project: CutFlowProject;
  settings: AppSettings;
  hideCaptionTools?: boolean;
  onImportAsset: (asset: MediaAssetRef) => void;
  onRemoveAsset: (mediaId: string) => void;
  onAddAssetToTimeline: (asset: MediaAssetRef, targetTrackId?: string, atTime?: number) => void;
  onAddTextLayer: (presetText: string) => void;
  onAddShapeOverlay: (shapeType: OverlayShapeType) => void;
  onUpdateProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onSeekTo: (timeSec: number) => void;
  currentTime: number;
}

export function MediaBin({
  project,
  settings,
  hideCaptionTools = false,
  onImportAsset,
  onRemoveAsset,
  onAddAssetToTimeline,
  onAddTextLayer,
  onAddShapeOverlay,
  onUpdateProject,
  onUpdateSettings,
  onSeekTo,
  currentTime,
}: MediaBinProps) {
  const [tab, setTab] = useState<DrawerTab>('media');
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>({ open: false, x: 0, y: 0, items: [] });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg('');
    setImporting(true);
    try {
      for (const file of Array.from(files)) {
        const asset = await importMediaFile(file, project.maxDurationSec);
        onImportAsset(asset);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import media file.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerateCalibration = async () => {
    setErrorMsg('');
    setImporting(true);
    try {
      const file = await generateCalibrationClipFile(4, 1280, 720);
      const asset = await importMediaFile(file, project.maxDurationSec);
      onImportAsset(asset);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create calibration clip.');
    } finally {
      setImporting(false);
    }
  };

  const openAssetContextMenu = (e: React.MouseEvent, asset: MediaAssetRef) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: 'append',
          label: 'Append to Timeline',
          icon: <Plus className="w-3.5 h-3.5" />,
          onSelect: () => onAddAssetToTimeline(asset),
        },
        {
          id: 'insert-playhead',
          label: 'Insert at Playhead',
          onSelect: () => onAddAssetToTimeline(asset, undefined, currentTime),
        },
        {
          id: 'open-ai',
          label: 'AI Captions & Scene Analysis',
          icon: <Sparkles className="w-3.5 h-3.5" />,
          onSelect: () => setTab('ai'),
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'remove',
          label: 'Remove from Project',
          danger: true,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          onSelect: () => onRemoveAsset(asset.id),
        },
      ],
    });
  };

  const tabs: Array<{ id: DrawerTab; label: string; icon: typeof Film; hidden?: boolean }> = [
    { id: 'media', label: 'Media', icon: Film },
    { id: 'text', label: 'Text', icon: Type, hidden: hideCaptionTools },
    { id: 'overlays', label: 'Shapes', icon: Layers },
    { id: 'ai', label: 'AI', icon: Sparkles },
  ];

  return (
    <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] flex flex-col h-full">
      {/* Drawer Tabs */}
      <div className="flex items-center border-b border-slate-200 dark:border-white/8 px-2 pt-2 gap-1">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'border-teal-500 text-slate-900 dark:text-[#F4F5F7]'
                    : 'border-transparent text-slate-500 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === 'media' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*"
              aria-label="Import local media files"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
              className="rounded-lg border border-dashed border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-[#191C22]/60 p-4 text-center space-y-2.5"
            >
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                {importing ? 'Importing...' : 'Import Local Media'}
              </button>
              <p className="text-[11px] text-slate-500 dark:text-[#8E95A5]">
                Drop video, audio, or image files here. Files stay local on your device.
              </p>
              <button
                type="button"
                disabled={importing}
                onClick={handleGenerateCalibration}
                className="w-full py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-[11px] font-medium text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
              >
                Generate 4s Calibration Clip
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                {errorMsg}
              </div>
            )}

            {project.media.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-[#8E95A5]">
                No media in this project yet.
              </div>
            ) : (
              <div className="space-y-2">
                {project.media.map((asset) => (
                  <div
                    key={asset.id}
                    draggable
                    onContextMenu={(e) => openAssetContextMenu(e, asset)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-cutflow-media', asset.id);
                    }}
                    className="group rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#191C22] p-2 flex items-center gap-2.5"
                  >
                    <div className="w-14 h-10 rounded overflow-hidden bg-black/40 shrink-0 flex items-center justify-center">
                      {asset.thumbnailDataUrl ? (
                        <img
                          src={asset.thumbnailDataUrl}
                          alt={asset.name}
                          className="w-full h-full object-cover"
                        />
                      ) : asset.type === 'audio' ? (
                        <Music className="w-4 h-4 text-teal-400" />
                      ) : asset.type === 'image' ? (
                        <ImageIcon className="w-4 h-4 text-slate-400" />
                      ) : (
                        <Film className="w-4 h-4 text-slate-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
                        {asset.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] font-mono-tabular truncate">
                        {asset.type} · {formatDuration(asset.durationSec)}
                        {asset.width > 0 ? ` · ${asset.width}x${asset.height}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onAddAssetToTimeline(asset)}
                        aria-label={`Add ${asset.name} to timeline`}
                        title="Add to timeline"
                        className="p-1.5 rounded hover:bg-teal-500/20 text-teal-500 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveAsset(asset.id)}
                        aria-label={`Remove ${asset.name} from project`}
                        title="Remove from project (original file stays safe)"
                        className="p-1.5 rounded hover:bg-red-500/15 text-slate-400 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'text' && !hideCaptionTools && (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Insert editable text layers onto the overlay track.
            </p>
            <button
              type="button"
              onClick={() => onAddTextLayer('Headline Title')}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] hover:border-teal-500/50 text-left cursor-pointer"
            >
              <span className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                Headline Title
              </span>
              <Plus className="w-4 h-4 text-teal-500" />
            </button>
            <button
              type="button"
              onClick={() => onAddTextLayer('Subheading note')}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] hover:border-teal-500/50 text-left cursor-pointer"
            >
              <span className="text-xs font-medium text-slate-700 dark:text-[#F4F5F7]">
                Subtitle Text
              </span>
              <Plus className="w-4 h-4 text-teal-500" />
            </button>
          </div>
        )}

        {tab === 'overlays' && (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Add geometric shapes and framing overlays.
            </p>
            {(
              [
                { type: 'rectangle', label: 'Rectangle Block' },
                { type: 'frame', label: 'Border Frame' },
                { type: 'lower-third', label: 'Lower-Third Bar' },
                { type: 'circle', label: 'Circle Matte' },
                { type: 'line', label: 'Divider Line' },
              ] as Array<{ type: OverlayShapeType; label: string }>
            ).map((s) => (
              <button
                key={s.type}
                type="button"
                onClick={() => onAddShapeOverlay(s.type)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] hover:border-teal-500/50 text-xs font-medium text-slate-900 dark:text-[#F4F5F7] cursor-pointer"
              >
                <span>{s.label}</span>
                <Plus className="w-4 h-4 text-teal-500" />
              </button>
            ))}
          </div>
        )}

        {tab === 'ai' && (
          <TranscriptPanel
            project={project}
            settings={settings}
            onUpdateProject={onUpdateProject}
            onUpdateSettings={onUpdateSettings}
            onSeekTo={onSeekTo}
          />
        )}
      </div>

      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenu.items}
        onClose={() => setCtxMenu((c) => ({ ...c, open: false }))}
      />
    </aside>
  );
}
