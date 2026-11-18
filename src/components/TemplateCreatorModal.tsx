import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  AnimationPreset,
  AspectRatio,
  CUTFLOW_TEMPLATE_FORMAT,
  CUTFLOW_TEMPLATE_MANIFEST_VERSION,
  CutFlowTemplateManifest,
  SoundEffectType,
  TemplateDefinition,
} from '../types/project';
import { createId, defaultColorAdjustments } from '../utils/timelineMath';
import { listAvailableFontFamilies } from '../services/fonts';
import {
  manifestToTemplateDefinition,
  templateDefinitionToManifest,
} from '../services/templateSchema';
import { TemplatePreviewRenderer } from './TemplatePreviewRenderer';

interface TemplateCreatorModalProps {
  initialTemplate?: TemplateDefinition | null;
  onClose: () => void;
  onSave: (tpl: TemplateDefinition) => Promise<void>;
}

const ANIMATION_OPTIONS: Array<{ value: AnimationPreset; label: string }> = [
  { value: 'spring-pop', label: 'Spring Pop' },
  { value: 'impact', label: 'Hero Impact' },
  { value: 'kinetic-cascade', label: 'Kinetic Cascade' },
  { value: 'word-reveal', label: 'Word Reveal' },
  { value: 'mask-reveal', label: 'Mask Reveal' },
  { value: 'tracking-reveal', label: 'Tracking Reveal' },
  { value: 'stagger', label: 'Word Stagger' },
  { value: 'bounce', label: 'Elastic Bounce' },
  { value: 'shake', label: 'Emphasis Shake' },
  { value: 'emphasis-pulse', label: 'Emphasis Pulse' },
  { value: 'motion-trail', label: 'Motion Trail' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'fade', label: 'Smooth Fade' },
  { value: 'type-on', label: 'Type-On' },
  { value: 'none', label: 'Static (None)' },
];

function createBlankManifest(): CutFlowTemplateManifest {
  return {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: createId('tpl'),
    name: 'Custom Studio Template',
    description: 'Handcrafted local CUTflow composition template.',
    category: 'Custom',
    tags: ['9:16', 'custom'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'Custom Editorial',
      backgroundColor: '#0E1015',
      accentColor: '#14B8A6',
      secondaryColor: '#F1F5F9',
      frameInset: 0.05,
      frameRadius: 10,
      borderColor: 'rgba(20,184,166,0.32)',
      borderWidth: 2,
      fitMode: 'fill',
      vignetteStrength: 0.22,
    },
    typography: {
      pairingName: 'Space Grotesk + Inter',
      hero: {
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        sizeRatio: 1.38,
        color: '#2DD4BF',
        backgroundColor: 'rgba(11,12,14,0.8)',
        textCase: 'upper',
        letterSpacing: 0.8,
        lineHeight: 1.15,
      },
      supporting: {
        fontFamily: 'Inter',
        fontWeight: 600,
        sizeRatio: 1.0,
        color: '#F8FAFC',
        backgroundColor: 'rgba(11,12,14,0.72)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.24,
      },
      standard: {
        fontFamily: 'Inter',
        fontWeight: 500,
        sizeRatio: 0.95,
        color: '#E2E8F0',
        backgroundColor: 'rgba(11,12,14,0.72)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.25,
      },
      annotation: {
        fontFamily: 'IBM Plex Sans',
        fontWeight: 500,
        sizeRatio: 0.78,
        color: '#94A3B8',
        backgroundColor: 'rgba(11,12,14,0.68)',
        textCase: 'none',
        letterSpacing: 0.2,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 600,
        sizeRatio: 0.7,
        color: '#2DD4BF',
        backgroundColor: 'rgba(11,12,14,0.84)',
        textCase: 'upper',
        letterSpacing: 1.5,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['lower-center', 'top-center', 'upper-left'],
      faceSafeMargin: 0.05,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'balanced',
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: 0.05, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: 0.04, scaleMul: 0.95, fontSizeScale: 0.94 },
        '16:9': { frameInset: 0.03, scaleMul: 0.9, fontSizeScale: 0.88 },
      },
      autoWrapMaxWidthRatio: 0.82,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'spring-pop',
      heroPreset: 'impact',
      supportingPreset: 'slide-up',
      springStiffness: 280,
      springDamping: 18,
      springMass: 1,
      anticipationMs: 40,
      motionBlurStrength: 0.3,
      staggerMs: 65,
    },
    colour: { ...defaultColorAdjustments(), contrast: 0.08, vignette: 0.2 },
    audio: {
      enabled: true,
      heroSfx: 'soft-pop',
      transitionSfx: 'whoosh-in',
      cueVolume: 0.25,
    },
    assets: [],
    preview: {
      sampleTitle: 'CUSTOM STYLE',
      sampleHeroWord: 'CREATE',
      sampleCaption: 'Live preview with offline fonts.',
      sampleKicker: 'CUTFLOW CREATOR',
    },
    metadata: {
      author: 'CutFlow User',
      source: 'creator',
      license: 'User Template',
      createdAt: Date.now(),
    },
  };
}

export function TemplateCreatorModal({
  initialTemplate,
  onClose,
  onSave,
}: TemplateCreatorModalProps) {
  const [draft, setDraft] = useState<CutFlowTemplateManifest>(() =>
    initialTemplate ? templateDefinitionToManifest(initialTemplate) : createBlankManifest()
  );
  const [fonts, setFonts] = useState<Array<{ family: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAvailableFontFamilies()
      .then((list) => setFonts(list.map((f) => ({ family: f.family, label: f.label }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tpl = manifestToTemplateDefinition(draft, {
        id: initialTemplate && !initialTemplate.isBuiltIn ? initialTemplate.id : createId('tpl'),
        isBuiltIn: false,
        createdAt: initialTemplate?.createdAt ?? Date.now(),
      });
      await onSave(tpl);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Template Creator"
    >
      <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
              {initialTemplate && !initialTemplate.isBuiltIn ? 'Edit Custom Template' : 'Create New Template'}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-[#8E95A5]">
              Outputs a validated cutflow.template 1.0.0 manifest using bundled offline fonts.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Template Creator"
            className="p-1.5 rounded text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 text-xs">
          {/* Live Canvas Preview */}
          <div className="space-y-3">
            <div className="aspect-[9/12] rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-[#0B0C0E]">
              <TemplatePreviewRenderer manifest={draft} />
            </div>
            <label className="block space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Preview Hero Word</span>
              <input
                type="text"
                value={draft.preview.sampleHeroWord}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    preview: { ...prev.preview, sampleHeroWord: e.target.value },
                  }))
                }
                className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
              />
            </label>
          </div>

          {/* Authoring Controls */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="sm:col-span-2 space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Template Name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Category</span>
                <select
                  value={draft.category}
                  onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value="Custom">Custom</option>
                  <option value="Kinetic">Kinetic</option>
                  <option value="Podcast">Podcast</option>
                  <option value="Editorial">Editorial</option>
                  <option value="Minimal">Minimal</option>
                  <option value="Explainer">Explainer</option>
                  <option value="Creator">Creator</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-slate-500 dark:text-[#8E95A5]">Description</span>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
              />
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Default Aspect</span>
                <select
                  value={draft.defaultAspectRatio}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      defaultAspectRatio: e.target.value as AspectRatio,
                    }))
                  }
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value="9:16">9:16 Vertical</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="16:9">16:9 Widescreen</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Background</span>
                <input
                  type="color"
                  value={draft.designSystem.backgroundColor}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      designSystem: { ...p.designSystem, backgroundColor: e.target.value },
                    }))
                  }
                  className="w-full h-8 rounded cursor-pointer bg-transparent"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Hero Color</span>
                <input
                  type="color"
                  value={draft.typography.hero.color}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      designSystem: { ...p.designSystem, accentColor: e.target.value },
                      typography: {
                        ...p.typography,
                        hero: { ...p.typography.hero, color: e.target.value },
                        kicker: { ...p.typography.kicker, color: e.target.value },
                      },
                    }))
                  }
                  className="w-full h-8 rounded cursor-pointer bg-transparent"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Body Color</span>
                <input
                  type="color"
                  value={draft.typography.supporting.color}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        supporting: { ...p.typography.supporting, color: e.target.value },
                        standard: { ...p.typography.standard, color: e.target.value },
                      },
                    }))
                  }
                  className="w-full h-8 rounded cursor-pointer bg-transparent"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Hero Font</span>
                <select
                  value={draft.typography.hero.fontFamily}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        hero: { ...p.typography.hero, fontFamily: e.target.value },
                      },
                    }))
                  }
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                >
                  {fonts.map((f) => (
                    <option key={f.family} value={f.family}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Body Font</span>
                <select
                  value={draft.typography.standard.fontFamily}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        supporting: { ...p.typography.supporting, fontFamily: e.target.value },
                        standard: { ...p.typography.standard, fontFamily: e.target.value },
                      },
                    }))
                  }
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                >
                  {fonts.map((f) => (
                    <option key={f.family} value={f.family}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Animation Preset</span>
                <select
                  value={draft.animation.preferredPreset}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      animation: {
                        ...p.animation,
                        preferredPreset: e.target.value as AnimationPreset,
                        heroPreset: e.target.value as AnimationPreset,
                      },
                    }))
                  }
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                >
                  {ANIMATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">
                  Frame Inset ({Math.round(draft.designSystem.frameInset * 100)}%)
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.18}
                  step={0.01}
                  value={draft.designSystem.frameInset}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      designSystem: { ...p.designSystem, frameInset: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-teal-500"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">
                  Contrast ({draft.colour.contrast.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={-0.4}
                  max={0.4}
                  step={0.02}
                  value={draft.colour.contrast}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      colour: { ...p.colour, contrast: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-teal-500"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">
                  Warmth ({draft.colour.temperature.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={-0.5}
                  max={0.5}
                  step={0.02}
                  value={draft.colour.temperature}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      colour: { ...p.colour, temperature: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-teal-500"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-500 dark:text-[#8E95A5]">Hero Sound Cue</span>
                <select
                  value={draft.audio.heroSfx}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      audio: { ...p.audio, heroSfx: e.target.value as SoundEffectType },
                    }))
                  }
                  className="w-full rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
                >
                  <option value="none">None</option>
                  <option value="soft-pop">Soft Pop</option>
                  <option value="impact-hit">Impact Hit</option>
                  <option value="whoosh-in">Whoosh In</option>
                  <option value="subtle-tick">Subtle Tick</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-[#8E95A5] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !draft.name.trim()}
            onClick={handleSave}
            className="px-4 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 disabled:opacity-45 text-white text-xs font-medium cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
