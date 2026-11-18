import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Volume2 } from 'lucide-react';
import {
  AnimationPreset,
  AspectRatio,
  CutFlowProject,
  FitMode,
  OverlayLayer,
  SelectionTarget,
  SoundEffectType,
  TextLayer,
  TimelineClip,
  TypographyRole,
} from '../types/project';
import { defaultKineticAnimation } from '../utils/motionPhysics';
import {
  createId,
  defaultColorAdjustments,
  getDimensionsForAspectRatio,
} from '../utils/timelineMath';
import { listAvailableFontFamilies } from '../services/fonts';
import { playPreviewSoundCue } from '../services/soundDesign';

interface InspectorPanelProps {
  project: CutFlowProject;
  selection: SelectionTarget;
  onUpdateProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
}

type ClipInspectorTab = 'transform' | 'color' | 'audio';

export function InspectorPanel({ project, selection, onUpdateProject }: InspectorPanelProps) {
  const [clipTab, setClipTab] = useState<ClipInspectorTab>('transform');
  const [advancedColorOpen, setAdvancedColorOpen] = useState(false);
  const [availableFonts, setAvailableFonts] = useState<Array<{ family: string; label: string }>>([
    { family: 'Inter', label: 'Inter' },
    { family: 'IBM Plex Sans', label: 'IBM Plex Sans' },
    { family: 'IBM Plex Mono', label: 'IBM Plex Mono' },
    { family: 'Barlow Condensed', label: 'Barlow Condensed' },
    { family: 'Space Grotesk', label: 'Space Grotesk' },
    { family: 'DM Sans', label: 'DM Sans' },
    { family: 'Playfair Display', label: 'Playfair Display' },
    { family: 'Source Serif 4', label: 'Source Serif 4' },
    { family: 'Archivo Black', label: 'Archivo Black' },
  ]);

  useEffect(() => {
    listAvailableFontFamilies()
      .then((list) => setAvailableFonts(list.map((f) => ({ family: f.family, label: f.label }))))
      .catch(() => {});
  }, [selection?.kind]);

  const selectedClip =
    selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selectedText =
    selection?.kind === 'text' ? project.textLayers.find((t) => t.id === selection.id) : undefined;
  const selectedOverlay =
    selection?.kind === 'overlay'
      ? project.overlayLayers.find((o) => o.id === selection.id)
      : undefined;

  const updateClip = (patch: Partial<TimelineClip>) => {
    if (!selectedClip) return;
    onUpdateProject((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c)),
    }));
  };

  const updateText = (patch: Partial<TextLayer>) => {
    if (!selectedText) return;
    onUpdateProject((prev) => ({
      ...prev,
      textLayers: prev.textLayers.map((t) => (t.id === selectedText.id ? { ...t, ...patch } : t)),
    }));
  };

  const updateOverlay = (patch: Partial<OverlayLayer>) => {
    if (!selectedOverlay) return;
    onUpdateProject((prev) => ({
      ...prev,
      overlayLayers: prev.overlayLayers.map((o) =>
        o.id === selectedOverlay.id ? { ...o, ...patch } : o
      ),
    }));
  };

  const linkedCue = selectedText
    ? (project.soundCues ?? []).find((c) => c.linkedLayerId === selectedText.id)
    : undefined;

  const setLinkedCueEffect = (effect: SoundEffectType, volume?: number) => {
    if (!selectedText) return;
    onUpdateProject((prev) => {
      const existing = (prev.soundCues ?? []).find((c) => c.linkedLayerId === selectedText.id);
      if (effect === 'none') {
        return {
          ...prev,
          soundCues: (prev.soundCues ?? []).filter((c) => c.linkedLayerId !== selectedText.id),
        };
      }
      if (existing) {
        return {
          ...prev,
          soundCues: (prev.soundCues ?? []).map((c) =>
            c.id === existing.id ? { ...c, effect, volume: volume ?? c.volume } : c
          ),
        };
      }
      return {
        ...prev,
        soundCues: [
          ...(prev.soundCues ?? []),
          {
            id: createId('sfx'),
            timeSec: selectedText.startTime,
            effect,
            volume: volume ?? 0.25,
            linkedLayerId: selectedText.id,
          },
        ],
      };
    });
  };

  const suggestSceneColorBalance = () => {
    if (!selectedClip) return;
    const mid = selectedClip.startTime + selectedClip.duration / 2;
    const scene =
      project.sceneMap?.scenes.find((s) => mid >= s.startSec && mid <= s.endSec) ??
      project.sceneMap?.scenes[0];
    const avgLum = scene?.brightnessAvg ?? 0.45;
    const exposureAdjust = avgLum < 0.35 ? 0.22 : avgLum > 0.68 ? -0.18 : 0.05;
    updateClip({
      color: {
        ...selectedClip.color,
        exposure: Number(exposureAdjust.toFixed(2)),
        contrast: 0.1,
        vibrance: 0.12,
        shadows: avgLum < 0.4 ? 0.14 : 0.04,
      },
    });
  };

  return (
    <aside className="w-72 shrink-0 border-l border-slate-200 dark:border-white/8 bg-white dark:bg-[#121418] flex flex-col h-full overflow-y-auto p-4 space-y-5">
      {!selectedClip && !selectedText && !selectedOverlay && (
        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-slate-900 dark:text-[#F4F5F7]">
            Canvas Settings
          </h2>
          <label className="block space-y-1.5 text-xs">
            <span className="text-slate-500 dark:text-[#8E95A5]">Project Name</span>
            <input
              type="text"
              value={project.name}
              onChange={(e) => onUpdateProject((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-sm text-slate-900 dark:text-[#F4F5F7]"
            />
          </label>

          <div className="space-y-1.5 text-xs">
            <span className="block text-slate-500 dark:text-[#8E95A5]">Aspect Ratio</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['16:9', '9:16', '1:1'] as AspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => {
                    const dims = getDimensionsForAspectRatio(ratio, project.exportSettings.resolution);
                    onUpdateProject((prev) => ({
                      ...prev,
                      aspectRatio: ratio,
                      width: dims.width,
                      height: dims.height,
                    }));
                  }}
                  className={`py-1.5 rounded-md font-mono-tabular border text-xs cursor-pointer ${
                    project.aspectRatio === ratio
                      ? 'border-teal-500 bg-teal-500/15 text-teal-400'
                      : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#8E95A5]'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-[#8E95A5] pt-2">
            Select any clip, caption layer, or overlay in the timeline to adjust transforms, color grading, kinetic motion, or audio.
          </p>
        </div>
      )}

      {selectedClip && (
        <div className="space-y-4 text-xs">
          <div>
            <h2 className="text-xs font-semibold text-slate-900 dark:text-[#F4F5F7] truncate">
              {selectedClip.name}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] font-mono-tabular mt-0.5">
              {selectedClip.kind} · {selectedClip.duration.toFixed(2)}s
            </p>
          </div>

          {/* Sub-tabs for Premiere-like clean separation */}
          {selectedClip.kind !== 'audio' && (
            <div className="grid grid-cols-3 rounded-md border border-slate-200 dark:border-white/10 p-0.5 bg-slate-50 dark:bg-[#0E1014] text-[11px]">
              {(
                [
                  { id: 'transform', label: 'Motion' },
                  { id: 'color', label: 'Color' },
                  { id: 'audio', label: 'Audio' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setClipTab(t.id)}
                  className={`py-1 rounded font-medium cursor-pointer ${
                    clipTab === t.id
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-500 dark:text-[#8E95A5]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {selectedClip.kind !== 'audio' && clipTab === 'transform' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-1">
                {(['fit', 'fill', 'stretch'] as FitMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      updateClip({ transform: { ...selectedClip.transform, fitMode: mode } })
                    }
                    className={`py-1 rounded text-[11px] capitalize border cursor-pointer ${
                      selectedClip.transform.fitMode === mode
                        ? 'border-teal-500 bg-teal-500/15 text-teal-400'
                        : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#8E95A5]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <SliderRow
                label="Scale"
                value={selectedClip.transform.scale}
                min={0.2}
                max={3}
                step={0.05}
                display={`${Math.round(selectedClip.transform.scale * 100)}%`}
                onChange={(v) => updateClip({ transform: { ...selectedClip.transform, scale: v } })}
              />
              <SliderRow
                label="Position X"
                value={selectedClip.transform.x}
                min={-0.8}
                max={0.8}
                step={0.02}
                display={`${Math.round(selectedClip.transform.x * 100)}%`}
                onChange={(v) => updateClip({ transform: { ...selectedClip.transform, x: v } })}
              />
              <SliderRow
                label="Position Y"
                value={selectedClip.transform.y}
                min={-0.8}
                max={0.8}
                step={0.02}
                display={`${Math.round(selectedClip.transform.y * 100)}%`}
                onChange={(v) => updateClip({ transform: { ...selectedClip.transform, y: v } })}
              />
              <SliderRow
                label="Rotation"
                value={selectedClip.transform.rotation}
                min={-180}
                max={180}
                step={1}
                display={`${selectedClip.transform.rotation}°`}
                onChange={(v) =>
                  updateClip({ transform: { ...selectedClip.transform, rotation: v } })
                }
              />
              <SliderRow
                label="Opacity"
                value={selectedClip.transform.opacity}
                min={0}
                max={1}
                step={0.02}
                display={`${Math.round(selectedClip.transform.opacity * 100)}%`}
                onChange={(v) =>
                  updateClip({ transform: { ...selectedClip.transform, opacity: v } })
                }
              />

              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/8">
                <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">Crop Insets</p>
                {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
                  <SliderRow
                    key={edge}
                    label={edge.charAt(0).toUpperCase() + edge.slice(1)}
                    value={selectedClip.transform.crop[edge]}
                    min={0}
                    max={0.4}
                    step={0.01}
                    display={`${Math.round(selectedClip.transform.crop[edge] * 100)}%`}
                    onChange={(v) =>
                      updateClip({
                        transform: {
                          ...selectedClip.transform,
                          crop: { ...selectedClip.transform.crop, [edge]: v },
                        },
                      })
                    }
                  />
                ))}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-white/8">
                <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">Entry Transition</p>
                <select
                  value={selectedClip.transitionIn?.type ?? 'none'}
                  onChange={(e) =>
                    updateClip({
                      transitionIn: {
                        type: e.target.value as 'none' | 'fade' | 'slide-up',
                        durationSec: 0.4,
                      },
                    })
                  }
                  className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value="none">None</option>
                  <option value="fade">Fade In (0.4s)</option>
                  <option value="slide-up">Slide Up (0.4s)</option>
                </select>
              </div>
            </div>
          )}

          {selectedClip.kind !== 'audio' && clipTab === 'color' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={suggestSceneColorBalance}
                  className="flex-1 py-1.5 px-2 rounded border border-teal-500/40 bg-teal-500/10 text-teal-400 text-[11px] font-medium cursor-pointer"
                >
                  Auto Balance
                </button>
                <button
                  type="button"
                  onClick={() => updateClip({ color: defaultColorAdjustments() })}
                  className="py-1.5 px-2.5 rounded border border-slate-200 dark:border-white/10 text-[11px] text-slate-500 hover:text-white cursor-pointer"
                >
                  Reset
                </button>
              </div>

              <SliderRow
                label="Exposure"
                value={selectedClip.color.exposure ?? 0}
                min={-1.5}
                max={1.5}
                step={0.05}
                display={(selectedClip.color.exposure ?? 0).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, exposure: v } })}
              />
              <SliderRow
                label="Contrast"
                value={selectedClip.color.contrast}
                min={-0.8}
                max={0.8}
                step={0.05}
                display={selectedClip.color.contrast.toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, contrast: v } })}
              />
              <SliderRow
                label="Highlights"
                value={selectedClip.color.highlights ?? 0}
                min={-1}
                max={1}
                step={0.05}
                display={(selectedClip.color.highlights ?? 0).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, highlights: v } })}
              />
              <SliderRow
                label="Shadows"
                value={selectedClip.color.shadows ?? 0}
                min={-1}
                max={1}
                step={0.05}
                display={(selectedClip.color.shadows ?? 0).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, shadows: v } })}
              />
              <SliderRow
                label="Temperature"
                value={selectedClip.color.temperature ?? 0}
                min={-1}
                max={1}
                step={0.05}
                display={(selectedClip.color.temperature ?? 0).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, temperature: v } })}
              />
              <SliderRow
                label="Tint"
                value={selectedClip.color.tint ?? 0}
                min={-1}
                max={1}
                step={0.05}
                display={(selectedClip.color.tint ?? 0).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, tint: v } })}
              />
              <SliderRow
                label="Saturation"
                value={selectedClip.color.saturation}
                min={-1}
                max={1}
                step={0.05}
                display={selectedClip.color.saturation.toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, saturation: v } })}
              />
              <SliderRow
                label="Vibrance"
                value={selectedClip.color.vibrance ?? 0}
                min={-1}
                max={1}
                step={0.05}
                display={(selectedClip.color.vibrance ?? 0).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, vibrance: v } })}
              />
              <SliderRow
                label="Gamma"
                value={selectedClip.color.gamma ?? 1}
                min={0.6}
                max={1.6}
                step={0.05}
                display={(selectedClip.color.gamma ?? 1).toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, gamma: v } })}
              />
              <SliderRow
                label="Vignette"
                value={selectedClip.color.vignette ?? 0}
                min={0}
                max={1}
                step={0.05}
                display={`${Math.round((selectedClip.color.vignette ?? 0) * 100)}%`}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, vignette: v } })}
              />
              <SliderRow
                label="Brightness"
                value={selectedClip.color.brightness}
                min={-0.8}
                max={0.8}
                step={0.05}
                display={selectedClip.color.brightness.toFixed(2)}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, brightness: v } })}
              />
              <SliderRow
                label="Blur"
                value={selectedClip.color.blur}
                min={0}
                max={16}
                step={0.5}
                display={`${selectedClip.color.blur}px`}
                onChange={(v) => updateClip({ color: { ...selectedClip.color, blur: v } })}
              />

              <div className="pt-2 border-t border-slate-200 dark:border-white/8 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setAdvancedColorOpen((v) => !v)}
                  className="w-full flex items-center justify-between text-[11px] font-medium text-slate-700 dark:text-[#F4F5F7] cursor-pointer"
                >
                  <span>Advanced Color (Grain, Lift, Gain)</span>
                  {advancedColorOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </button>

                {advancedColorOpen && (
                  <div className="space-y-3 pt-1">
                    <SliderRow
                      label="Film Grain"
                      value={selectedClip.color.grain ?? 0}
                      min={0}
                      max={1}
                      step={0.02}
                      display={`${Math.round((selectedClip.color.grain ?? 0) * 100)}%`}
                      onChange={(v) => updateClip({ color: { ...selectedClip.color, grain: v } })}
                    />
                    <SliderRow
                      label="Shadow Lift"
                      value={selectedClip.color.lift ?? 0}
                      min={-0.5}
                      max={0.5}
                      step={0.02}
                      display={(selectedClip.color.lift ?? 0).toFixed(2)}
                      onChange={(v) => updateClip({ color: { ...selectedClip.color, lift: v } })}
                    />
                    <SliderRow
                      label="Highlight Gain"
                      value={selectedClip.color.gain ?? 1}
                      min={0.5}
                      max={1.5}
                      step={0.02}
                      display={(selectedClip.color.gain ?? 1).toFixed(2)}
                      onChange={(v) => updateClip({ color: { ...selectedClip.color, gain: v } })}
                    />
                    <SliderRow
                      label="Whites"
                      value={selectedClip.color.whites ?? 0}
                      min={-1}
                      max={1}
                      step={0.05}
                      display={(selectedClip.color.whites ?? 0).toFixed(2)}
                      onChange={(v) => updateClip({ color: { ...selectedClip.color, whites: v } })}
                    />
                    <SliderRow
                      label="Blacks"
                      value={selectedClip.color.blacks ?? 0}
                      min={-1}
                      max={1}
                      step={0.05}
                      display={(selectedClip.color.blacks ?? 0).toFixed(2)}
                      onChange={(v) => updateClip({ color: { ...selectedClip.color, blacks: v } })}
                    />
                    <SliderRow
                      label="Sharpen"
                      value={selectedClip.color.sharpen ?? 0}
                      min={0}
                      max={1}
                      step={0.05}
                      display={`${Math.round((selectedClip.color.sharpen ?? 0) * 100)}%`}
                      onChange={(v) => updateClip({ color: { ...selectedClip.color, sharpen: v } })}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {(selectedClip.kind === 'audio' || clipTab === 'audio') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">Audio & Speed</p>
                <button
                  type="button"
                  onClick={() => updateClip({ muted: !selectedClip.muted })}
                  className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer ${
                    selectedClip.muted
                      ? 'border-red-500/40 bg-red-500/10 text-red-400'
                      : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-[#8E95A5]'
                  }`}
                >
                  {selectedClip.muted ? 'Muted' : 'Mute'}
                </button>
              </div>
              <SliderRow
                label="Volume"
                value={selectedClip.volume}
                min={0}
                max={2}
                step={0.05}
                display={`${Math.round(selectedClip.volume * 100)}%`}
                onChange={(v) => updateClip({ volume: v })}
              />
              <SliderRow
                label="Fade In"
                value={selectedClip.fadeInSec}
                min={0}
                max={Math.min(5, selectedClip.duration * 0.5)}
                step={0.1}
                display={`${selectedClip.fadeInSec.toFixed(1)}s`}
                onChange={(v) => updateClip({ fadeInSec: v })}
              />
              <SliderRow
                label="Fade Out"
                value={selectedClip.fadeOutSec}
                min={0}
                max={Math.min(5, selectedClip.duration * 0.5)}
                step={0.1}
                display={`${selectedClip.fadeOutSec.toFixed(1)}s`}
                onChange={(v) => updateClip({ fadeOutSec: v })}
              />
              {selectedClip.kind !== 'image' && (
                <SliderRow
                  label="Speed"
                  value={selectedClip.speed}
                  min={0.5}
                  max={2}
                  step={0.1}
                  display={`${selectedClip.speed.toFixed(1)}x`}
                  onChange={(v) => {
                    const ratio = selectedClip.speed / v;
                    updateClip({
                      speed: v,
                      duration: Math.max(0.2, Number((selectedClip.duration * ratio).toFixed(3))),
                    });
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {selectedText && (
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Typography & Motion
            </h2>
            {selectedText.anchorZone && (
              <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-400">
                {selectedText.anchorZone}
              </span>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-slate-500 dark:text-[#8E95A5]">Content</span>
            <textarea
              rows={2}
              value={selectedText.text}
              onChange={(e) => updateText({ text: e.target.value })}
              className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-sm text-slate-900 dark:text-[#F4F5F7]"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Role</span>
              <select
                value={selectedText.role ?? 'standard'}
                onChange={(e) => updateText({ role: e.target.value as TypographyRole })}
                className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
              >
                <option value="hero">Hero Impact</option>
                <option value="supporting">Supporting</option>
                <option value="standard">Standard</option>
                <option value="annotation">Annotation</option>
                <option value="stat">Metric / Stat</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Case</span>
              <select
                value={selectedText.textCase ?? 'none'}
                onChange={(e) =>
                  updateText({ textCase: e.target.value as 'none' | 'upper' | 'title' })
                }
                className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
              >
                <option value="none">As Typed</option>
                <option value="upper">UPPERCASE</option>
                <option value="title">Title Case</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Font</span>
              <select
                value={selectedText.fontFamily}
                onChange={(e) => updateText({ fontFamily: e.target.value })}
                className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
              >
                {availableFonts.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.label}
                  </option>
                ))}
                {!availableFonts.some((f) => f.family === selectedText.fontFamily) && (
                  <option value={selectedText.fontFamily}>{selectedText.fontFamily}</option>
                )}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Weight</span>
              <select
                value={selectedText.fontWeight}
                onChange={(e) =>
                  updateText({ fontWeight: Number(e.target.value) as 400 | 500 | 600 | 700 })
                }
                className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
              >
                <option value={400}>Regular</option>
                <option value={500}>Medium</option>
                <option value={600}>SemiBold</option>
                <option value={700}>Bold</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Text Color</span>
              <input
                type="color"
                value={selectedText.color}
                onChange={(e) => updateText({ color: e.target.value })}
                className="w-full h-8 rounded cursor-pointer bg-transparent"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Alignment</span>
              <select
                value={selectedText.align}
                onChange={(e) =>
                  updateText({ align: e.target.value as 'left' | 'center' | 'right' })
                }
                className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>

          <SliderRow
            label="Size"
            value={selectedText.fontSize}
            min={20}
            max={120}
            step={2}
            display={`${selectedText.fontSize}px`}
            onChange={(v) => updateText({ fontSize: v })}
          />
          <SliderRow
            label="Position X"
            value={selectedText.x}
            min={-0.45}
            max={0.45}
            step={0.02}
            display={`${Math.round(selectedText.x * 100)}%`}
            onChange={(v) => updateText({ x: v, userLockedPosition: true })}
          />
          <SliderRow
            label="Position Y"
            value={selectedText.y}
            min={-0.45}
            max={0.45}
            step={0.02}
            display={`${Math.round(selectedText.y * 100)}%`}
            onChange={(v) => updateText({ y: v, userLockedPosition: true })}
          />

          {/* Kinetic Motion Physics */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-white/8">
            <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">Kinetic Motion Physics</p>
            <select
              value={selectedText.animation?.preset ?? 'none'}
              onChange={(e) => {
                const anim = selectedText.animation ?? defaultKineticAnimation();
                updateText({
                  animation: { ...anim, preset: e.target.value as AnimationPreset },
                });
              }}
              className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
            >
              <option value="none">Static (None)</option>
              <option value="spring-pop">Spring Pop</option>
              <option value="impact">Hero Impact</option>
              <option value="kinetic-cascade">Kinetic Cascade</option>
              <option value="word-reveal">Word-by-Word Reveal</option>
              <option value="mask-reveal">Mask Reveal</option>
              <option value="tracking-reveal">Tracking Reveal</option>
              <option value="stagger">Word Stagger</option>
              <option value="bounce">Elastic Bounce</option>
              <option value="shake">Emphasis Shake</option>
              <option value="emphasis-pulse">Emphasis Pulse</option>
              <option value="motion-trail">Motion Trail</option>
              <option value="slide-up">Spring Slide Up</option>
              <option value="fade">Smooth Fade</option>
              <option value="type-on">Type-On</option>
            </select>

            {selectedText.animation && selectedText.animation.preset !== 'none' && (
              <>
                <SliderRow
                  label="Spring Stiffness"
                  value={selectedText.animation.springStiffness}
                  min={80}
                  max={500}
                  step={10}
                  display={`${selectedText.animation.springStiffness}`}
                  onChange={(v) =>
                    updateText({
                      animation: { ...selectedText.animation!, springStiffness: v },
                    })
                  }
                />
                <SliderRow
                  label="Spring Damping"
                  value={selectedText.animation.springDamping}
                  min={6}
                  max={45}
                  step={1}
                  display={`${selectedText.animation.springDamping}`}
                  onChange={(v) =>
                    updateText({
                      animation: { ...selectedText.animation!, springDamping: v },
                    })
                  }
                />
                <SliderRow
                  label="Anticipation"
                  value={selectedText.animation.anticipationMs}
                  min={0}
                  max={100}
                  step={5}
                  display={`${selectedText.animation.anticipationMs}ms`}
                  onChange={(v) =>
                    updateText({
                      animation: { ...selectedText.animation!, anticipationMs: v },
                    })
                  }
                />
                <SliderRow
                  label="Motion Blur"
                  value={selectedText.animation.motionBlurStrength}
                  min={0}
                  max={1}
                  step={0.05}
                  display={`${Math.round(selectedText.animation.motionBlurStrength * 100)}%`}
                  onChange={(v) =>
                    updateText({
                      animation: { ...selectedText.animation!, motionBlurStrength: v },
                    })
                  }
                />
              </>
            )}
          </div>

          {/* Sound Design Cue */}
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-white/8">
            <div className="flex items-center justify-between">
              <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">Sound Cue</p>
              {linkedCue && linkedCue.effect !== 'none' && (
                <button
                  type="button"
                  onClick={() => playPreviewSoundCue(linkedCue.effect, linkedCue.volume)}
                  className="inline-flex items-center gap-1 text-[11px] text-teal-400 hover:underline cursor-pointer"
                >
                  <Volume2 className="w-3 h-3" />
                  Preview
                </button>
              )}
            </div>
            <select
              value={linkedCue?.effect ?? 'none'}
              onChange={(e) => setLinkedCueEffect(e.target.value as SoundEffectType)}
              className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
            >
              <option value="none">None</option>
              <option value="soft-pop">Soft Pop</option>
              <option value="impact-hit">Impact Hit</option>
              <option value="whoosh-in">Whoosh In</option>
              <option value="subtle-tick">Subtle Tick</option>
            </select>
          </div>
        </div>
      )}

      {selectedOverlay && (
        <div className="space-y-4 text-xs">
          <h2 className="text-xs font-semibold text-slate-900 dark:text-[#F4F5F7]">
            {selectedOverlay.name}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Fill</span>
              <input
                type="color"
                value={
                  selectedOverlay.fillColor.startsWith('#')
                    ? selectedOverlay.fillColor
                    : '#14B8A6'
                }
                onChange={(e) => updateOverlay({ fillColor: e.target.value })}
                className="w-full h-8 rounded cursor-pointer bg-transparent"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Stroke</span>
              <input
                type="color"
                value={
                  selectedOverlay.strokeColor.startsWith('#')
                    ? selectedOverlay.strokeColor
                    : '#FFFFFF'
                }
                onChange={(e) => updateOverlay({ strokeColor: e.target.value })}
                className="w-full h-8 rounded cursor-pointer bg-transparent"
              />
            </label>
          </div>
          <SliderRow
            label="Position X"
            value={selectedOverlay.x}
            min={-0.45}
            max={0.45}
            step={0.02}
            display={`${Math.round(selectedOverlay.x * 100)}%`}
            onChange={(v) => updateOverlay({ x: v })}
          />
          <SliderRow
            label="Position Y"
            value={selectedOverlay.y}
            min={-0.45}
            max={0.45}
            step={0.02}
            display={`${Math.round(selectedOverlay.y * 100)}%`}
            onChange={(v) => updateOverlay({ y: v })}
          />
          <SliderRow
            label="Scale"
            value={selectedOverlay.scale}
            min={0.2}
            max={2.5}
            step={0.05}
            display={`${Math.round(selectedOverlay.scale * 100)}%`}
            onChange={(v) => updateOverlay({ scale: v })}
          />
          <SliderRow
            label="Opacity"
            value={selectedOverlay.opacity}
            min={0}
            max={1}
            step={0.02}
            display={`${Math.round(selectedOverlay.opacity * 100)}%`}
            onChange={(v) => updateOverlay({ opacity: v })}
          />
          <SliderRow
            label="Duration"
            value={selectedOverlay.duration}
            min={0.5}
            max={60}
            step={0.5}
            display={`${selectedOverlay.duration.toFixed(1)}s`}
            onChange={(v) => updateOverlay({ duration: v })}
          />
        </div>
      )}
    </aside>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (val: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500 dark:text-[#8E95A5]">{label}</span>
        <span className="font-mono-tabular text-slate-700 dark:text-[#F4F5F7]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-500"
      />
    </label>
  );
}
