import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Edit3,
  Film,
  Maximize2,
  Play,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { ApprovalStatus, FinalOutputItem } from '../types/project';
import { formatBytes, formatDuration } from '../utils/timelineMath';
import { loadMediaBlob } from '../services/storage';
import { exportBlobToDisk } from '../services/renderer';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';

interface FinalOutputsPageProps {
  outputs: FinalOutputItem[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRestore: (id: string) => void;
  onDeletePermanent: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onOpenEditor: (output: FinalOutputItem) => void;
}

export function FinalOutputsPage({
  outputs,
  onApprove,
  onReject,
  onRestore,
  onDeletePermanent,
  onRename,
  onOpenEditor,
}: FinalOutputsPageProps) {
  const [filter, setFilter] = useState<'all' | ApprovalStatus>('all');
  const [search, setSearch] = useState('');
  const [activeOutput, setActiveOutput] = useState<FinalOutputItem | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string>('');
  const [renameDraft, setRenameDraft] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  }>({ open: false, x: 0, y: 0, items: [] });

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return outputs.filter((o) => {
      if (filter !== 'all' && o.approvalStatus !== filter) return false;
      if (filter === 'all' && o.approvalStatus === 'rejected') return false;
      if (!q) return true;
      return o.name.toLowerCase().includes(q) || (o.templateName?.toLowerCase().includes(q) ?? false);
    });
  }, [outputs, filter, search]);

  const visibleItems = filtered.slice(0, visibleLimit);

  useEffect(() => {
    if (!activeOutput) return;
    const latest = outputs.find((o) => o.id === activeOutput.id);
    if (!latest) {
      setActiveOutput(null);
    } else {
      setActiveOutput(latest);
      setRenameDraft(latest.name);
    }
  }, [outputs, activeOutput?.id]);

  useEffect(() => {
    if (!activeOutput) {
      setActiveVideoUrl('');
      return;
    }
    let revoked = false;
    let createdUrl = '';

    loadMediaBlob(activeOutput.storageKey, activeOutput.storageBackend).then((blob) => {
      if (!blob || revoked) return;
      createdUrl = URL.createObjectURL(blob);
      setActiveVideoUrl(createdUrl);
    });

    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [activeOutput?.id]);

  const handleExportSingle = async (item: FinalOutputItem) => {
    const blob = await loadMediaBlob(item.storageKey, item.storageBackend);
    if (!blob) return;
    const ext = item.mimeType.includes('webm') ? 'webm' : 'mp4';
    await exportBlobToDisk(blob, item.name, ext).catch(() => undefined);
  };

  const handleExportApproved = async () => {
    const approved = outputs.filter((o) => o.approvalStatus === 'approved');
    for (const item of approved) {
      await handleExportSingle(item);
    }
  };

  const openCardContextMenu = (e: React.MouseEvent, item: FinalOutputItem) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          id: 'preview',
          label: 'Preview Output',
          icon: <Play className="w-3.5 h-3.5" />,
          onSelect: () => {
            setActiveOutput(item);
            setRenameDraft(item.name);
          },
        },
        {
          id: 'edit',
          label: 'Open in Output Editor',
          icon: <Edit3 className="w-3.5 h-3.5" />,
          onSelect: () => onOpenEditor(item),
        },
        {
          id: 'export',
          label: 'Export Video File',
          icon: <Download className="w-3.5 h-3.5" />,
          onSelect: () => handleExportSingle(item),
        },
        { type: 'divider', id: 'd1' },
        {
          id: 'approve',
          label: 'Mark Approved',
          icon: <Check className="w-3.5 h-3.5 text-emerald-400" />,
          onSelect: () => onApprove(item.id),
        },
        item.approvalStatus === 'rejected'
          ? {
              id: 'restore',
              label: 'Restore to Pending',
              icon: <RotateCcw className="w-3.5 h-3.5" />,
              onSelect: () => onRestore(item.id),
            }
          : {
              id: 'reject',
              label: 'Reject Output',
              icon: <X className="w-3.5 h-3.5 text-amber-400" />,
              onSelect: () => onReject(item.id),
            },
        { type: 'divider', id: 'd2' },
        {
          id: 'delete',
          label: 'Delete Permanently',
          danger: true,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          onSelect: () => onDeletePermanent(item.id),
        },
      ],
    });
  };

  const counts = useMemo(() => {
    return {
      all: outputs.filter((o) => o.approvalStatus !== 'rejected').length,
      pending: outputs.filter((o) => o.approvalStatus === 'pending').length,
      approved: outputs.filter((o) => o.approvalStatus === 'approved').length,
      rejected: outputs.filter((o) => o.approvalStatus === 'rejected').length,
    };
  }, [outputs]);

  return (
    <main className="flex-1 overflow-y-auto px-5 py-6 w-full max-w-[1800px] mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-white/8 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-[#F4F5F7]">
            Final Outputs
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#8E95A5] font-mono-tabular">
            {counts.all} active · {counts.approved} approved · {counts.rejected} rejected
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Filter outputs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] text-xs text-slate-900 dark:text-[#F4F5F7] w-48"
            />
          </div>

          <div className="flex items-center rounded-md border border-slate-200 dark:border-white/10 p-0.5 text-xs">
            {(
              [
                { id: 'all', label: `All (${counts.all})` },
                { id: 'pending', label: `Pending (${counts.pending})` },
                { id: 'approved', label: `Approved (${counts.approved})` },
                { id: 'rejected', label: `Rejected (${counts.rejected})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
                  filter === tab.id
                    ? 'bg-slate-200 dark:bg-white/12 text-slate-900 dark:text-[#F4F5F7]'
                    : 'text-slate-500 dark:text-[#8E95A5]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {counts.approved > 0 && (
            <button
              type="button"
              onClick={handleExportApproved}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Approved ({counts.approved})
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 p-12 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-[#F4F5F7]">
            No outputs in this view
          </p>
          <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
            Render a video from Video Edit or Templates to inspect and approve finished clips here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-2.5">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onContextMenu={(e) => openCardContextMenu(e, item)}
                onClick={() => {
                  setActiveOutput(item);
                  setRenameDraft(item.name);
                }}
                className="group text-left rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] overflow-hidden hover:border-teal-500/70 transition-colors cursor-pointer flex flex-col"
              >
                <div className="aspect-[9/14] bg-[#0B0C0E] relative overflow-hidden">
                  {item.posterDataUrl ? (
                    <img
                      src={item.posterDataUrl}
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-5 h-5 text-[#8E95A5]" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 flex items-center justify-between text-[10px] font-mono-tabular text-white">
                    <span>{formatDuration(item.durationSec)}</span>
                    <span>
                      {item.approvalStatus === 'approved'
                        ? 'Approved'
                        : item.approvalStatus === 'rejected'
                          ? 'Rejected'
                          : 'Pending'}
                    </span>
                  </div>
                </div>
                <div className="p-2 space-y-0.5">
                  <p className="text-[11px] font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
                    {item.name}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-[#8E95A5] font-mono-tabular truncate">
                    {item.width}x{item.height} · {item.renderStatus}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {filtered.length > visibleLimit && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setVisibleLimit((n) => n + 80)}
                className="px-4 py-2 rounded-md border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
              >
                Load more ({filtered.length - visibleLimit} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {activeOutput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${activeOutput.name}`}
        >
          <div className="w-full max-w-4xl rounded-xl border border-white/12 bg-[#121418] overflow-hidden shadow-2xl grid grid-cols-1 md:grid-cols-[1fr_320px]">
            <div className="bg-black flex items-center justify-center min-h-[340px] max-h-[80vh] relative">
              {activeVideoUrl ? (
                <video
                  ref={videoRef}
                  src={activeVideoUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[78vh] max-w-full"
                />
              ) : (
                <p className="text-xs text-[#8E95A5]">Loading local video...</p>
              )}
            </div>

            <div className="p-5 flex flex-col justify-between gap-5 border-t md:border-t-0 md:border-l border-white/10">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 flex-1">
                    <label className="block text-[11px] text-[#8E95A5]">Output Name</label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => {
                          if (renameDraft.trim() && renameDraft !== activeOutput.name) {
                            onRename(activeOutput.id, renameDraft.trim());
                          }
                        }}
                        className="flex-1 rounded border border-white/12 bg-[#191C22] px-2.5 py-1.5 text-sm text-[#F4F5F7]"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveOutput(null)}
                    aria-label="Close preview"
                    className="p-1.5 rounded text-[#8E95A5] hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-xs text-[#8E95A5] font-mono-tabular space-y-1">
                  <p>
                    Resolution: {activeOutput.width}x{activeOutput.height} · {activeOutput.fps} FPS
                  </p>
                  <p>
                    Duration: {formatDuration(activeOutput.durationSec)} · Size:{' '}
                    {formatBytes(activeOutput.sizeBytes)}
                  </p>
                  <p>
                    Approval:{' '}
                    <span className="text-[#F4F5F7] capitalize">{activeOutput.approvalStatus}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => videoRef.current?.requestFullscreen?.().catch(() => undefined)}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-white/12 text-xs font-medium text-[#F4F5F7] hover:bg-white/6 cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Fullscreen Player
                </button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove(activeOutput.id)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  {activeOutput.approvalStatus === 'rejected' ? (
                    <button
                      type="button"
                      onClick={() => onRestore(activeOutput.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-white/12 text-[#F4F5F7] hover:bg-white/6 text-xs font-medium cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onReject(activeOutput.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-amber-500/35 text-amber-300 hover:bg-amber-500/10 text-xs font-medium cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const target = activeOutput;
                    setActiveOutput(null);
                    onOpenEditor(target);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-white/12 text-xs font-medium text-[#F4F5F7] hover:bg-white/6 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Open in Output Editor
                </button>

                <button
                  type="button"
                  onClick={() => handleExportSingle(activeOutput)}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Video File
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDeletePermanent(activeOutput.id);
                    setActiveOutput(null);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-red-400 hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ContextMenu
        open={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenu.items}
        onClose={() => setCtxMenu((c) => ({ ...c, open: false }))}
      />
    </main>
  );
}
