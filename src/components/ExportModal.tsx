import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FolderOutput, X, AlertTriangle, RotateCcw } from 'lucide-react';
import { CutFlowProject, ExportSettings, FinalOutputItem } from '../types/project';
import { computeProjectDuration, formatBytes, formatDuration } from '../utils/timelineMath';
import { detectBrowserCapabilities } from '../services/capabilities';
import {
  exportBlobToDisk,
  RenderedVideoResult,
  renderProjectToVideo,
  RenderProgressEvent,
  saveRenderedVideoToFinalOutputs,
} from '../services/renderer';

interface ExportModalProps {
  open: boolean;
  project: CutFlowProject;
  onClose: () => void;
  onExportedToOutputs?: (output: FinalOutputItem) => void;
}

export function ExportModal({ open, project, onClose, onExportedToOutputs }: ExportModalProps) {
  const [resolution, setResolution] = useState<'1080p' | '720p'>(project.exportSettings.resolution);
  const [fps, setFps] = useState<30 | 60>(project.exportSettings.fps);
  const [quality, setQuality] = useState<'high' | 'standard'>(project.exportSettings.quality);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error' | 'cancelled'>('idle');
  const [progress, setProgress] = useState<RenderProgressEvent>({
    progress: 0,
    stage: 'Ready',
    currentFrame: 0,
    totalFrames: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [result, setResult] = useState<RenderedVideoResult | null>(null);
  const [savedOutput, setSavedOutput] = useState<FinalOutputItem | null>(null);
  const [h264Available, setH264Available] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    detectBrowserCapabilities().then((caps) => {
      setH264Available(caps.webCodecsVideoEncoder && caps.webCodecsH264Supported);
    });
    return () => {
      abortRef.current?.abort();
    };
  }, [open]);

  if (!open) return null;

  const durationSec = Math.max(1, computeProjectDuration(project));
  const hasTimelineContent =
    project.clips.length > 0 || project.textLayers.length > 0 || project.overlayLayers.length > 0;

  const startRender = async () => {
    setErrorMessage('');
    setResult(null);
    setSavedOutput(null);
    setStatus('rendering');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const settings: Partial<ExportSettings> = { resolution, fps, quality, format: 'mp4' };
      const rendered = await renderProjectToVideo({
        project,
        settings,
        signal: controller.signal,
        onProgress: (ev) => setProgress(ev),
      });

      const saved = await saveRenderedVideoToFinalOutputs({
        project,
        rendered,
        outputName: project.name,
      });

      setResult(rendered);
      setSavedOutput(saved);
      setStatus('done');
      onExportedToOutputs?.(saved);
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('cancelled');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Export failed.');
        setStatus('error');
      }
    }
  };

  const handleCancelRender = () => {
    abortRef.current?.abort();
  };

  const handleDownload = async () => {
    if (!result) return;
    try {
      await exportBlobToDisk(result.blob, project.name, result.extension);
    } catch (err) {
      if (err instanceof Error && err.message !== 'Save cancelled.') {
        setErrorMessage(err.message);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="export-modal-title" className="text-base font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Export Video
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5] font-mono-tabular mt-0.5">
              {project.aspectRatio} · {formatDuration(durationSec)} · Local render
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (status === 'rendering') handleCancelRender();
              onClose();
            }}
            aria-label="Close export dialog"
            className="p-1.5 rounded-md text-slate-500 dark:text-[#8E95A5] hover:bg-slate-100 dark:hover:bg-white/8 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {h264Available === false && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
            WebCodecs H.264 hardware/software encoding is unavailable in this browser profile. CutFlow will automatically export via its MediaRecorder fallback.
          </div>
        )}

        {!hasTimelineContent && (
          <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/4 px-3.5 py-2.5 text-xs text-slate-600 dark:text-[#8E95A5]">
            Your timeline currently has no clips or layers. Add media or text layers first, or export a blank 1-second slate.
          </div>
        )}

        {status === 'idle' || status === 'cancelled' || status === 'error' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1.5 text-xs">
                <span className="block text-slate-500 dark:text-[#8E95A5]">Resolution</span>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as '1080p' | '720p')}
                  className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-2 text-sm text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value="1080p">1080p HD</option>
                  <option value="720p">720p Fast</option>
                </select>
              </label>

              <label className="space-y-1.5 text-xs">
                <span className="block text-slate-500 dark:text-[#8E95A5]">Frame Rate</span>
                <select
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value) as 30 | 60)}
                  className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-2 text-sm text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                </select>
              </label>

              <label className="space-y-1.5 text-xs">
                <span className="block text-slate-500 dark:text-[#8E95A5]">Bitrate</span>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as 'high' | 'standard')}
                  className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-2 text-sm text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value="high">High</option>
                  <option value="standard">Standard</option>
                </select>
              </label>
            </div>

            {status === 'error' && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Render failed</p>
                  <p className="mt-0.5 opacity-90">{errorMessage}</p>
                </div>
              </div>
            )}

            {status === 'cancelled' && (
              <p className="text-xs text-slate-500 dark:text-[#8E95A5]">Export was cancelled.</p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-md text-sm font-medium text-slate-600 dark:text-[#8E95A5] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={startRender}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white cursor-pointer"
              >
                {status === 'error' ? <RotateCcw className="w-4 h-4" /> : <FolderOutput className="w-4 h-4" />}
                {status === 'error' ? 'Retry Export' : 'Start Local Export'}
              </button>
            </div>
          </div>
        ) : null}

        {status === 'rendering' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700 dark:text-[#F4F5F7]">{progress.stage}</span>
                <span className="font-mono-tabular text-teal-400">
                  {Math.round(progress.progress * 100)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-teal-500 transition-all duration-150"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] font-mono-tabular">
                Frame {progress.currentFrame} of {progress.totalFrames}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCancelRender}
                className="px-3.5 py-2 rounded-md text-sm font-medium border border-slate-200 dark:border-white/12 text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
              >
                Cancel Render
              </button>
            </div>
          </div>
        )}

        {status === 'done' && result && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-teal-500/30 bg-teal-500/10 p-3.5">
              <CheckCircle2 className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">
                  Video exported locally and saved to Final Outputs
                </p>
                <p className="text-slate-600 dark:text-[#8E95A5] font-mono-tabular">
                  {result.width}x{result.height} · {result.fps} FPS · {formatBytes(result.blob.size)} ·{' '}
                  {result.encoderPath === 'webcodecs-mp4' ? 'MP4 (H.264)' : `${result.extension.toUpperCase()} fallback`}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-md text-sm font-medium text-slate-600 dark:text-[#8E95A5] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
              >
                Done
              </button>
              {savedOutput && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Save File to Disk
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
