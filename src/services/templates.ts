import {
  AspectRatio,
  CUTFLOW_TEMPLATE_FORMAT,
  CUTFLOW_TEMPLATE_MANIFEST_VERSION,
  CutFlowProject,
  CutFlowTemplateManifest,
  OverlayLayer,
  SourceAnalysisBundle,
  TemplateDefinition,
  TextLayer,
} from '../types/project';
import { buildEditorialPlan, editorialPlanToTimelineLayers } from '../utils/editorialPlanner';
import {
  cloneProject,
  computeProjectDuration,
  createId,
  defaultColorAdjustments,
  getDimensionsForAspectRatio,
} from '../utils/timelineMath';
import { deleteCustomTemplate, listCustomTemplates, saveCustomTemplate } from './storage';
import { parseTemplateFileForPreview, commitParsedTemplateImport } from './templatePackage';
import { manifestToTemplateDefinition, templateDefinitionToManifest } from './templateSchema';

const grade = (overrides: Partial<ReturnType<typeof defaultColorAdjustments>>) => ({
  ...defaultColorAdjustments(),
  ...overrides,
});

const BUILT_IN_MANIFESTS: CutFlowTemplateManifest[] = [
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_editorial_punch',
    name: 'Editorial Punch',
    description:
      'High-impact vertical reel with condensed uppercase hero callouts, sharp yellow emphasis, and punchy contrast.',
    category: 'Kinetic',
    tags: ['9:16', 'punchy', 'hinglish', 'reels'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'High-Contrast Editorial Punch',
      backgroundColor: '#0B0C0E',
      accentColor: '#FACC15',
      secondaryColor: '#F8FAFC',
      frameInset: 0.025,
      frameRadius: 6,
      borderColor: 'rgba(250,204,21,0.35)',
      borderWidth: 2,
      fitMode: 'fill',
      vignetteStrength: 0.24,
    },
    typography: {
      pairingName: 'Barlow Condensed + Inter + IBM Plex Mono',
      hero: {
        fontFamily: 'Barlow Condensed',
        fontWeight: 700,
        sizeRatio: 1.48,
        color: '#FACC15',
        backgroundColor: 'rgba(11,12,14,0.82)',
        textCase: 'upper',
        letterSpacing: 1.2,
        lineHeight: 1.08,
      },
      supporting: {
        fontFamily: 'Inter',
        fontWeight: 600,
        sizeRatio: 1.0,
        color: '#FFFFFF',
        backgroundColor: 'rgba(11,12,14,0.74)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.22,
      },
      standard: {
        fontFamily: 'Inter',
        fontWeight: 500,
        sizeRatio: 0.96,
        color: '#F1F5F9',
        backgroundColor: 'rgba(11,12,14,0.74)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.24,
      },
      annotation: {
        fontFamily: 'IBM Plex Sans',
        fontWeight: 500,
        sizeRatio: 0.78,
        color: '#CBD5E1',
        backgroundColor: 'rgba(11,12,14,0.68)',
        textCase: 'none',
        letterSpacing: 0.2,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 600,
        sizeRatio: 0.72,
        color: '#FACC15',
        backgroundColor: 'rgba(11,12,14,0.85)',
        textCase: 'upper',
        letterSpacing: 1.8,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['lower-center', 'top-center', 'upper-left'],
      faceSafeMargin: 0.05,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'punchy',
      titleOverlay: {
        enabled: true,
        defaultText: 'KEY TAKEAWAY',
        fontFamily: 'IBM Plex Mono',
        fontSize: 28,
        fontWeight: 600,
        color: '#FACC15',
        y: -0.41,
      },
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: 0.025, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: 0.03, scaleMul: 0.95, fontSizeScale: 0.92 },
        '16:9': { frameInset: 0.02, scaleMul: 0.9, fontSizeScale: 0.85 },
      },
      autoWrapMaxWidthRatio: 0.82,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'impact',
      heroPreset: 'impact',
      supportingPreset: 'spring-pop',
      springStiffness: 340,
      springDamping: 16,
      springMass: 1,
      anticipationMs: 45,
      motionBlurStrength: 0.42,
      staggerMs: 55,
    },
    colour: grade({
      contrast: 0.16,
      vibrance: 0.16,
      shadows: 0.08,
      vignette: 0.22,
      sharpen: 0.18,
    }),
    audio: {
      enabled: true,
      heroSfx: 'impact-hit',
      transitionSfx: 'whoosh-in',
      cueVolume: 0.28,
    },
    assets: [],
    preview: {
      sampleTitle: 'KEY TAKEAWAY',
      sampleHeroWord: 'JANNAT',
      sampleCaption: 'Ye asli jannat hai bhai!',
      sampleKicker: '01 // REEL HOOK',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000001000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_clean_podcast',
    name: 'Clean Podcast',
    description:
      'Conversational studio framing with warm neutral balance, DM Sans subtitles, and crisp word-reveal pacing.',
    category: 'Podcast',
    tags: ['9:16', 'podcast', 'interview', 'clean'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'Warm Studio Conversation',
      backgroundColor: '#121316',
      accentColor: '#14B8A6',
      secondaryColor: '#E2E8F0',
      frameInset: 0.05,
      frameRadius: 14,
      borderColor: 'rgba(255,255,255,0.16)',
      borderWidth: 1.5,
      fitMode: 'fill',
      vignetteStrength: 0.18,
    },
    typography: {
      pairingName: 'DM Sans + IBM Plex Mono',
      hero: {
        fontFamily: 'DM Sans',
        fontWeight: 700,
        sizeRatio: 1.24,
        color: '#2DD4BF',
        backgroundColor: 'rgba(15,17,21,0.78)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.2,
      },
      supporting: {
        fontFamily: 'DM Sans',
        fontWeight: 500,
        sizeRatio: 1.0,
        color: '#F8FAFC',
        backgroundColor: 'rgba(15,17,21,0.72)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.26,
      },
      standard: {
        fontFamily: 'DM Sans',
        fontWeight: 500,
        sizeRatio: 0.96,
        color: '#F1F5F9',
        backgroundColor: 'rgba(15,17,21,0.72)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.26,
      },
      annotation: {
        fontFamily: 'IBM Plex Sans',
        fontWeight: 400,
        sizeRatio: 0.78,
        color: '#94A3B8',
        backgroundColor: 'rgba(15,17,21,0.68)',
        textCase: 'none',
        letterSpacing: 0.2,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 600,
        sizeRatio: 0.7,
        color: '#94A3B8',
        backgroundColor: 'rgba(15,17,21,0.82)',
        textCase: 'upper',
        letterSpacing: 1.5,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['lower-center', 'top-center', 'upper-right'],
      faceSafeMargin: 0.06,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'balanced',
      accentShape: {
        enabled: true,
        shapeType: 'line',
        fillColor: 'transparent',
        strokeColor: 'rgba(20,184,166,0.6)',
        strokeWidth: 2,
        x: 0,
        y: -0.42,
        width: 0.28,
        height: 0.01,
      },
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
      preferredPreset: 'word-reveal',
      heroPreset: 'word-reveal',
      supportingPreset: 'fade',
      springStiffness: 240,
      springDamping: 22,
      springMass: 1,
      anticipationMs: 25,
      motionBlurStrength: 0.2,
      staggerMs: 65,
    },
    colour: grade({
      brightness: 0.02,
      contrast: 0.08,
      temperature: 0.06,
      vignette: 0.16,
    }),
    audio: {
      enabled: true,
      heroSfx: 'subtle-tick',
      transitionSfx: 'none',
      cueVolume: 0.18,
    },
    assets: [],
    preview: {
      sampleTitle: 'EPISODE CLIP',
      sampleHeroWord: 'Focus',
      sampleCaption: 'Real workflows stay fast locally.',
      sampleKicker: 'PODCAST // EP 14',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000002000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_cinematic_editorial',
    name: 'Cinematic Editorial',
    description:
      'Widescreen serif typography paired with warm Leica-inspired filmic contrast, gentle vignette, and smooth fade pacing.',
    category: 'Editorial',
    tags: ['16:9', 'cinema', 'serif', 'film'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    defaultAspectRatio: '16:9',
    version: '1.0.0',
    designSystem: {
      mood: 'Warm Filmic Documentary',
      backgroundColor: '#0A0908',
      accentColor: '#F5E6CC',
      secondaryColor: '#D6D3D1',
      frameInset: 0.04,
      frameRadius: 2,
      borderColor: 'rgba(245,230,204,0.18)',
      borderWidth: 1,
      fitMode: 'fit',
      vignetteStrength: 0.34,
    },
    typography: {
      pairingName: 'Playfair Display + Source Serif 4',
      hero: {
        fontFamily: 'Playfair Display',
        fontWeight: 700,
        sizeRatio: 1.32,
        color: '#FEF3C7',
        backgroundColor: 'rgba(10,9,8,0.62)',
        textCase: 'none',
        letterSpacing: 0.3,
        lineHeight: 1.18,
      },
      supporting: {
        fontFamily: 'Source Serif 4',
        fontWeight: 600,
        sizeRatio: 1.0,
        color: '#F5F5F4',
        backgroundColor: 'rgba(10,9,8,0.58)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.28,
      },
      standard: {
        fontFamily: 'Source Serif 4',
        fontWeight: 400,
        sizeRatio: 0.95,
        color: '#E7E5E4',
        backgroundColor: 'rgba(10,9,8,0.58)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.3,
      },
      annotation: {
        fontFamily: 'IBM Plex Sans',
        fontWeight: 400,
        sizeRatio: 0.76,
        color: '#A8A29E',
        backgroundColor: 'transparent',
        textCase: 'none',
        letterSpacing: 0.4,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 500,
        sizeRatio: 0.68,
        color: '#D6D3D1',
        backgroundColor: 'transparent',
        textCase: 'upper',
        letterSpacing: 2.2,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['lower-center', 'lower-left', 'upper-right'],
      faceSafeMargin: 0.05,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'editorial',
      titleOverlay: {
        enabled: true,
        defaultText: 'CHAPTER I',
        fontFamily: 'IBM Plex Mono',
        fontSize: 24,
        fontWeight: 500,
        color: '#F5E6CC',
        y: -0.42,
      },
    },
    adaptation: {
      aspectOverrides: {
        '16:9': { frameInset: 0.04, scaleMul: 1, fontSizeScale: 1 },
        '9:16': { frameInset: 0.08, scaleMul: 0.96, fontSizeScale: 1.05 },
        '1:1': { frameInset: 0.05, scaleMul: 0.98, fontSizeScale: 0.98 },
      },
      autoWrapMaxWidthRatio: 0.78,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'fade',
      heroPreset: 'slide-up',
      supportingPreset: 'fade',
      springStiffness: 200,
      springDamping: 24,
      springMass: 1.1,
      anticipationMs: 15,
      motionBlurStrength: 0.15,
      staggerMs: 80,
    },
    colour: grade({
      contrast: 0.1,
      saturation: -0.08,
      temperature: 0.14,
      highlights: -0.06,
      shadows: 0.08,
      vignette: 0.3,
      grain: 0.12,
    }),
    audio: {
      enabled: false,
      heroSfx: 'none',
      transitionSfx: 'none',
      cueVolume: 0.15,
    },
    assets: [],
    preview: {
      sampleTitle: 'CHAPTER I',
      sampleHeroWord: 'Golden Hour',
      sampleCaption: 'Shot on location at dusk.',
      sampleKicker: 'DIRECTOR CUT',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000003000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_kinetic_stack',
    name: 'Kinetic Stack',
    description:
      'Fast-paced kinetic cascade captions pairing Space Grotesk and Archivo Black for energetic storytelling and breakdowns.',
    category: 'Kinetic',
    tags: ['9:16', 'kinetic', 'stagger', 'fast'],
    aspectRatios: ['9:16', '1:1'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'Electric Kinetic Cascade',
      backgroundColor: '#090B10',
      accentColor: '#38BDF8',
      secondaryColor: '#F8FAFC',
      frameInset: 0.03,
      frameRadius: 10,
      borderColor: 'rgba(56,189,248,0.28)',
      borderWidth: 2,
      fitMode: 'fill',
      vignetteStrength: 0.2,
    },
    typography: {
      pairingName: 'Archivo Black + Space Grotesk',
      hero: {
        fontFamily: 'Archivo Black',
        fontWeight: 400,
        sizeRatio: 1.42,
        color: '#38BDF8',
        backgroundColor: 'rgba(9,11,16,0.84)',
        textCase: 'upper',
        letterSpacing: 0.8,
        lineHeight: 1.1,
      },
      supporting: {
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        sizeRatio: 1.05,
        color: '#FFFFFF',
        backgroundColor: 'rgba(9,11,16,0.75)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.2,
      },
      standard: {
        fontFamily: 'Space Grotesk',
        fontWeight: 500,
        sizeRatio: 0.96,
        color: '#E2E8F0',
        backgroundColor: 'rgba(9,11,16,0.72)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.22,
      },
      annotation: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 500,
        sizeRatio: 0.74,
        color: '#94A3B8',
        backgroundColor: 'rgba(9,11,16,0.72)',
        textCase: 'upper',
        letterSpacing: 1,
        lineHeight: 1.18,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 600,
        sizeRatio: 0.7,
        color: '#38BDF8',
        backgroundColor: 'rgba(9,11,16,0.8)',
        textCase: 'upper',
        letterSpacing: 1.5,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['top-center', 'lower-center', 'center-left', 'center-right'],
      faceSafeMargin: 0.06,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'punchy',
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: 0.03, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: 0.04, scaleMul: 0.94, fontSizeScale: 0.92 },
      },
      autoWrapMaxWidthRatio: 0.8,
      orphanAvoidance: true,
      longSentenceStrategy: 'stack-vertical',
    },
    animation: {
      preferredPreset: 'kinetic-cascade',
      heroPreset: 'stagger',
      supportingPreset: 'kinetic-cascade',
      springStiffness: 310,
      springDamping: 17,
      springMass: 0.95,
      anticipationMs: 35,
      motionBlurStrength: 0.45,
      staggerMs: 60,
    },
    colour: grade({
      contrast: 0.14,
      vibrance: 0.2,
      saturation: 0.06,
      vignette: 0.18,
    }),
    audio: {
      enabled: true,
      heroSfx: 'soft-pop',
      transitionSfx: 'whoosh-in',
      cueVolume: 0.26,
    },
    assets: [],
    preview: {
      sampleTitle: 'STACKED FLOW',
      sampleHeroWord: 'SPEED',
      sampleCaption: 'Zero lag kinetic captions.',
      sampleKicker: '02 // KINETIC',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000004000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_minimal_caption',
    name: 'Minimal Caption',
    description:
      'Gallery matte negative-space framing keeping horizontal or vertical footage uncropped with mask-reveal typography.',
    category: 'Minimal',
    tags: ['9:16', 'uncropped', 'negative-space', 'minimal'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'Gallery Minimal Matte',
      backgroundColor: '#0E1013',
      accentColor: '#F4F5F7',
      secondaryColor: '#9AA2B1',
      frameInset: 0.11,
      frameRadius: 12,
      borderColor: 'rgba(255,255,255,0.18)',
      borderWidth: 1.5,
      fitMode: 'fit',
      vignetteStrength: 0.12,
    },
    typography: {
      pairingName: 'Inter + IBM Plex Mono',
      hero: {
        fontFamily: 'Inter',
        fontWeight: 700,
        sizeRatio: 1.22,
        color: '#FFFFFF',
        backgroundColor: 'transparent',
        textCase: 'none',
        letterSpacing: -0.3,
        lineHeight: 1.2,
      },
      supporting: {
        fontFamily: 'Inter',
        fontWeight: 500,
        sizeRatio: 0.96,
        color: '#CBD5E1',
        backgroundColor: 'transparent',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.26,
      },
      standard: {
        fontFamily: 'Inter',
        fontWeight: 400,
        sizeRatio: 0.92,
        color: '#E2E8F0',
        backgroundColor: 'transparent',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.28,
      },
      annotation: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 400,
        sizeRatio: 0.72,
        color: '#94A3B8',
        backgroundColor: 'transparent',
        textCase: 'none',
        letterSpacing: 0.6,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 500,
        sizeRatio: 0.68,
        color: '#94A3B8',
        backgroundColor: 'transparent',
        textCase: 'upper',
        letterSpacing: 1.8,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['top-center', 'lower-center'],
      faceSafeMargin: 0.06,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'balanced',
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: 0.11, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: 0.08, scaleMul: 0.96, fontSizeScale: 0.95 },
        '16:9': { frameInset: 0.05, scaleMul: 0.92, fontSizeScale: 0.9 },
      },
      autoWrapMaxWidthRatio: 0.8,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'mask-reveal',
      heroPreset: 'mask-reveal',
      supportingPreset: 'fade',
      springStiffness: 230,
      springDamping: 24,
      springMass: 1,
      anticipationMs: 15,
      motionBlurStrength: 0.18,
      staggerMs: 70,
    },
    colour: grade({
      contrast: 0.05,
      vignette: 0.1,
    }),
    audio: {
      enabled: true,
      heroSfx: 'subtle-tick',
      transitionSfx: 'none',
      cueVolume: 0.15,
    },
    assets: [],
    preview: {
      sampleTitle: 'CLEAN FRAME',
      sampleHeroWord: 'Minimal',
      sampleCaption: 'Uncropped framing in matte black.',
      sampleKicker: 'NOTE // 03',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000005000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_split_composition',
    name: 'Split Composition',
    description:
      'Structured architectural border with top title header and tracking-reveal captions engineered for tutorials & commentary.',
    category: 'Editorial',
    tags: ['9:16', 'split', 'commentary', 'grid'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'Architectural Split Grid',
      backgroundColor: '#10141B',
      accentColor: '#3B82F6',
      secondaryColor: '#E2E8F0',
      frameInset: 0.075,
      frameRadius: 10,
      borderColor: 'rgba(59,130,246,0.34)',
      borderWidth: 2,
      fitMode: 'fill',
      vignetteStrength: 0.2,
    },
    typography: {
      pairingName: 'Space Grotesk + DM Sans',
      hero: {
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        sizeRatio: 1.3,
        color: '#60A5FA',
        backgroundColor: 'rgba(16,20,27,0.84)',
        textCase: 'upper',
        letterSpacing: 0.8,
        lineHeight: 1.15,
      },
      supporting: {
        fontFamily: 'DM Sans',
        fontWeight: 500,
        sizeRatio: 1.0,
        color: '#F8FAFC',
        backgroundColor: 'rgba(16,20,27,0.78)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.24,
      },
      standard: {
        fontFamily: 'DM Sans',
        fontWeight: 400,
        sizeRatio: 0.95,
        color: '#E2E8F0',
        backgroundColor: 'rgba(16,20,27,0.76)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.25,
      },
      annotation: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 500,
        sizeRatio: 0.74,
        color: '#93C5FD',
        backgroundColor: 'rgba(16,20,27,0.8)',
        textCase: 'upper',
        letterSpacing: 1.2,
        lineHeight: 1.15,
      },
      kicker: {
        fontFamily: 'Space Grotesk',
        fontWeight: 700,
        sizeRatio: 0.78,
        color: '#F8FAFC',
        backgroundColor: 'rgba(59,130,246,0.22)',
        textCase: 'upper',
        letterSpacing: 1.4,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['top-center', 'lower-center', 'upper-left'],
      faceSafeMargin: 0.05,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'split-screen',
      titleOverlay: {
        enabled: true,
        defaultText: 'SPLIT ANALYSIS',
        fontFamily: 'Space Grotesk',
        fontSize: 34,
        fontWeight: 700,
        color: '#F8FAFC',
        y: -0.43,
      },
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: 0.075, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: 0.05, scaleMul: 0.95, fontSizeScale: 0.94 },
        '16:9': { frameInset: 0.04, scaleMul: 0.9, fontSizeScale: 0.88 },
      },
      autoWrapMaxWidthRatio: 0.8,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'tracking-reveal',
      heroPreset: 'tracking-reveal',
      supportingPreset: 'slide-up',
      springStiffness: 260,
      springDamping: 20,
      springMass: 1,
      anticipationMs: 30,
      motionBlurStrength: 0.25,
      staggerMs: 65,
    },
    colour: grade({
      contrast: 0.12,
      saturation: -0.06,
      vignette: 0.18,
    }),
    audio: {
      enabled: true,
      heroSfx: 'subtle-tick',
      transitionSfx: 'whoosh-in',
      cueVolume: 0.2,
    },
    assets: [],
    preview: {
      sampleTitle: 'SPLIT ANALYSIS',
      sampleHeroWord: 'COMPARE',
      sampleCaption: 'Structured top-to-bottom balance.',
      sampleKicker: 'PART 01',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000006000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_bold_explainer',
    name: 'Bold Explainer',
    description:
      'Square-first product & tech explainer card featuring Archivo Black headlines, lower-third bar, and spring-pop callouts.',
    category: 'Explainer',
    tags: ['1:1', '9:16', 'product', 'explainer'],
    aspectRatios: ['1:1', '9:16', '16:9'],
    defaultAspectRatio: '1:1',
    version: '1.0.0',
    designSystem: {
      mood: 'Bold Studio Product Card',
      backgroundColor: '#141619',
      accentColor: '#10B981',
      secondaryColor: '#F4F5F7',
      frameInset: 0.05,
      frameRadius: 16,
      borderColor: 'rgba(16,185,129,0.28)',
      borderWidth: 1.5,
      fitMode: 'fill',
      vignetteStrength: 0.18,
    },
    typography: {
      pairingName: 'Archivo Black + IBM Plex Sans',
      hero: {
        fontFamily: 'Archivo Black',
        fontWeight: 400,
        sizeRatio: 1.38,
        color: '#34D399',
        backgroundColor: 'rgba(18,20,24,0.86)',
        textCase: 'upper',
        letterSpacing: 0.6,
        lineHeight: 1.12,
      },
      supporting: {
        fontFamily: 'IBM Plex Sans',
        fontWeight: 600,
        sizeRatio: 1.0,
        color: '#F4F5F7',
        backgroundColor: 'rgba(18,20,24,0.82)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.24,
      },
      standard: {
        fontFamily: 'IBM Plex Sans',
        fontWeight: 500,
        sizeRatio: 0.95,
        color: '#E5E7EB',
        backgroundColor: 'rgba(18,20,24,0.8)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.25,
      },
      annotation: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 500,
        sizeRatio: 0.76,
        color: '#9CA3AF',
        backgroundColor: 'rgba(18,20,24,0.8)',
        textCase: 'none',
        letterSpacing: 0.4,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 600,
        sizeRatio: 0.72,
        color: '#10B981',
        backgroundColor: 'rgba(16,185,129,0.14)',
        textCase: 'upper',
        letterSpacing: 1.4,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['top-center', 'lower-center', 'upper-left'],
      faceSafeMargin: 0.05,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'balanced',
      accentShape: {
        enabled: true,
        shapeType: 'lower-third',
        fillColor: 'rgba(18,20,24,0.8)',
        strokeColor: 'rgba(16,185,129,0.35)',
        strokeWidth: 1.5,
        x: 0,
        y: 0.39,
        width: 0.84,
        height: 0.1,
      },
      titleOverlay: {
        enabled: true,
        defaultText: 'HOW IT WORKS',
        fontFamily: 'IBM Plex Sans',
        fontSize: 34,
        fontWeight: 700,
        color: '#F4F5F7',
        y: 0.39,
      },
    },
    adaptation: {
      aspectOverrides: {
        '1:1': { frameInset: 0.05, scaleMul: 1, fontSizeScale: 1 },
        '9:16': { frameInset: 0.06, scaleMul: 1, fontSizeScale: 1.04 },
        '16:9': { frameInset: 0.04, scaleMul: 0.92, fontSizeScale: 0.9 },
      },
      autoWrapMaxWidthRatio: 0.82,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'spring-pop',
      heroPreset: 'bounce',
      supportingPreset: 'spring-pop',
      springStiffness: 280,
      springDamping: 17,
      springMass: 1,
      anticipationMs: 40,
      motionBlurStrength: 0.3,
      staggerMs: 60,
    },
    colour: grade({
      contrast: 0.1,
      vibrance: 0.1,
      sharpen: 0.12,
    }),
    audio: {
      enabled: true,
      heroSfx: 'soft-pop',
      transitionSfx: 'subtle-tick',
      cueVolume: 0.24,
    },
    assets: [],
    preview: {
      sampleTitle: 'HOW IT WORKS',
      sampleHeroWord: '100% LOCAL',
      sampleCaption: 'Offline processing with crisp cards.',
      sampleKicker: 'EXPLAINER // 01',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000007000,
    },
  },
  {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: 'tpl_storytelling',
    name: 'Storytelling',
    description:
      'Narrative vertical essay mixing Playfair Display accents, warm highlights, subtle film grain, and emphasis-pulse pacing.',
    category: 'Creator',
    tags: ['9:16', 'storytelling', 'serif', 'warm'],
    aspectRatios: ['9:16', '1:1', '16:9'],
    defaultAspectRatio: '9:16',
    version: '1.0.0',
    designSystem: {
      mood: 'Intimate Narrative Storytelling',
      backgroundColor: '#161311',
      accentColor: '#FB923C',
      secondaryColor: '#F5EFE6',
      frameInset: 0.04,
      frameRadius: 8,
      borderColor: 'rgba(245,239,230,0.22)',
      borderWidth: 1.5,
      fitMode: 'fill',
      vignetteStrength: 0.32,
    },
    typography: {
      pairingName: 'Playfair Display + DM Sans',
      hero: {
        fontFamily: 'Playfair Display',
        fontWeight: 700,
        sizeRatio: 1.38,
        color: '#FDBA74',
        backgroundColor: 'rgba(22,19,17,0.72)',
        textCase: 'none',
        letterSpacing: 0.2,
        lineHeight: 1.16,
      },
      supporting: {
        fontFamily: 'DM Sans',
        fontWeight: 500,
        sizeRatio: 1.0,
        color: '#FAF5EE',
        backgroundColor: 'rgba(22,19,17,0.68)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.25,
      },
      standard: {
        fontFamily: 'DM Sans',
        fontWeight: 400,
        sizeRatio: 0.96,
        color: '#F5EFE6',
        backgroundColor: 'rgba(22,19,17,0.68)',
        textCase: 'none',
        letterSpacing: 0,
        lineHeight: 1.25,
      },
      annotation: {
        fontFamily: 'Source Serif 4',
        fontWeight: 400,
        sizeRatio: 0.8,
        color: '#D6CCC0',
        backgroundColor: 'rgba(22,19,17,0.6)',
        textCase: 'none',
        letterSpacing: 0.2,
        lineHeight: 1.2,
      },
      kicker: {
        fontFamily: 'IBM Plex Mono',
        fontWeight: 500,
        sizeRatio: 0.7,
        color: '#FDBA74',
        backgroundColor: 'rgba(22,19,17,0.75)',
        textCase: 'upper',
        letterSpacing: 1.6,
        lineHeight: 1.15,
      },
    },
    layout: {
      preferredAnchors: ['lower-center', 'top-center', 'upper-right'],
      faceSafeMargin: 0.06,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'editorial',
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: 0.04, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: 0.04, scaleMul: 0.95, fontSizeScale: 0.94 },
        '16:9': { frameInset: 0.02, scaleMul: 0.9, fontSizeScale: 0.88 },
      },
      autoWrapMaxWidthRatio: 0.82,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: 'emphasis-pulse',
      heroPreset: 'emphasis-pulse',
      supportingPreset: 'slide-up',
      springStiffness: 250,
      springDamping: 19,
      springMass: 1,
      anticipationMs: 30,
      motionBlurStrength: 0.22,
      staggerMs: 70,
    },
    colour: grade({
      brightness: 0.03,
      contrast: 0.09,
      temperature: 0.14,
      shadows: 0.06,
      vignette: 0.28,
      grain: 0.1,
    }),
    audio: {
      enabled: true,
      heroSfx: 'soft-pop',
      transitionSfx: 'whoosh-in',
      cueVolume: 0.22,
    },
    assets: [],
    preview: {
      sampleTitle: 'STORY CHAPTER',
      sampleHeroWord: 'Home.',
      sampleCaption: 'Every frame tells a story.',
      sampleKicker: 'STORYTELLING',
    },
    metadata: {
      author: 'CUTflow Studio',
      source: 'built-in',
      license: 'CUTflow Built-In (SIL OFL Fonts)',
      createdAt: 1700000008000,
    },
  },
];

export const BUILT_IN_TEMPLATES: TemplateDefinition[] = BUILT_IN_MANIFESTS.map((m) =>
  manifestToTemplateDefinition(m, {
    id: m.id,
    isBuiltIn: true,
    isFavorite: m.id === 'tpl_editorial_punch' || m.id === 'tpl_kinetic_stack',
    createdAt: m.metadata.createdAt,
  })
);

const FAVORITES_KEY = 'cutflow_template_favorites';

function getSavedFavoriteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set(['tpl_editorial_punch', 'tpl_kinetic_stack']);
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function setTemplateFavoriteLocal(id: string, isFavorite: boolean): void {
  const favs = getSavedFavoriteIds();
  if (isFavorite) favs.add(id);
  else favs.delete(id);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    // ignore storage restriction
  }
}

export async function getAllTemplates(): Promise<TemplateDefinition[]> {
  const custom = await listCustomTemplates().catch(() => []);
  const favs = getSavedFavoriteIds();
  const builtIn = BUILT_IN_TEMPLATES.map((t) => ({
    ...t,
    isFavorite: favs.has(t.id),
  }));
  const customWithFav = custom.map((t) => ({
    ...t,
    manifest: t.manifest ?? templateDefinitionToManifest(t),
    isFavorite: favs.has(t.id) || t.isFavorite,
  }));
  return [...customWithFav, ...builtIn];
}

export async function duplicateTemplate(template: TemplateDefinition): Promise<TemplateDefinition> {
  const rawCopy: TemplateDefinition = JSON.parse(JSON.stringify(template));
  const nextId = createId('tpl');
  const nextManifest = templateDefinitionToManifest(rawCopy);
  nextManifest.id = nextId;
  nextManifest.name = `${template.name} Copy`;
  nextManifest.metadata.source = 'creator';
  nextManifest.metadata.createdAt = Date.now();

  const copy: TemplateDefinition = {
    ...rawCopy,
    id: nextId,
    name: `${template.name} Copy`,
    isBuiltIn: false,
    createdAt: Date.now(),
    manifest: nextManifest,
  };
  await saveCustomTemplate(copy);
  return copy;
}

export async function removeCustomTemplate(id: string): Promise<void> {
  await deleteCustomTemplate(id);
}

export async function importTemplateFromFile(file: File): Promise<TemplateDefinition> {
  const preview = await parseTemplateFileForPreview(file);
  if (!preview.valid) {
    throw new Error(preview.errors[0] ?? 'Invalid template file.');
  }
  return commitParsedTemplateImport(preview);
}

export function exportTemplateAsJson(template: TemplateDefinition): void {
  const manifest = templateDefinitionToManifest(template);
  const payload = JSON.stringify(manifest, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.cutflow-template.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function applyTemplateToProject(
  sourceProject: CutFlowProject,
  template: TemplateDefinition,
  resolution: '1080p' | '720p' = '1080p',
  options?: {
    aspectRatioOverride?: AspectRatio;
    analysisBundle?: SourceAnalysisBundle | null;
    enableSoundDesign?: boolean;
  }
): CutFlowProject {
  const targetRatio = options?.aspectRatioOverride ?? template.aspectRatio;
  const { width, height } = getDimensionsForAspectRatio(targetRatio, resolution);
  const totalDuration = Math.max(1, computeProjectDuration(sourceProject));

  const aspectRule = template.manifest?.adaptation.aspectOverrides[targetRatio];
  const effectiveInset = aspectRule?.frameInset ?? template.config.frameInset;
  const insetScale =
    Math.max(0.5, 1 - effectiveInset * 2) * (aspectRule?.scaleMul ?? 1);

  const cloned = cloneProject(sourceProject, {
    id: createId('proj'),
    name: `${sourceProject.name} — ${template.name}`,
    type: 'output',
    aspectRatio: targetRatio,
    width,
    height,
    templateId: template.id,
    sourceProjectId: sourceProject.id,
    exportSettings: {
      ...sourceProject.exportSettings,
      resolution,
    },
  });

  const g = { ...defaultColorAdjustments(), ...template.config.colorGrade };

  // Apply template visual styling & full color grade non-destructively onto cloned clips
  cloned.clips = cloned.clips.map((clip) => {
    if (clip.kind === 'audio') return clip;
    return {
      ...clip,
      transform: {
        ...clip.transform,
        fitMode: template.config.fitMode,
        scale: Number((clip.transform.scale * insetScale).toFixed(3)),
      },
      color: {
        ...clip.color,
        brightness: Math.max(-1, Math.min(1, clip.color.brightness + g.brightness)),
        contrast: Math.max(-1, Math.min(1, clip.color.contrast + g.contrast)),
        saturation: Math.max(-1, Math.min(1, clip.color.saturation + g.saturation)),
        blur: Math.max(0, clip.color.blur + g.blur),
        exposure: Math.max(-2, Math.min(2, (clip.color.exposure ?? 0) + (g.exposure ?? 0))),
        temperature: Math.max(-1, Math.min(1, (clip.color.temperature ?? 0) + (g.temperature ?? 0))),
        tint: Math.max(-1, Math.min(1, (clip.color.tint ?? 0) + (g.tint ?? 0))),
        highlights: Math.max(-1, Math.min(1, (clip.color.highlights ?? 0) + (g.highlights ?? 0))),
        shadows: Math.max(-1, Math.min(1, (clip.color.shadows ?? 0) + (g.shadows ?? 0))),
        whites: Math.max(-1, Math.min(1, (clip.color.whites ?? 0) + (g.whites ?? 0))),
        blacks: Math.max(-1, Math.min(1, (clip.color.blacks ?? 0) + (g.blacks ?? 0))),
        vibrance: Math.max(-1, Math.min(1, (clip.color.vibrance ?? 0) + (g.vibrance ?? 0))),
        gamma: Math.max(0.5, Math.min(2, (clip.color.gamma ?? 1) + ((g.gamma ?? 1) - 1))),
        vignette: Math.max(
          0,
          Math.min(1, (clip.color.vignette ?? 0) + Math.max(g.vignette ?? 0, template.config.vignetteStrength * 0.6))
        ),
        sharpen: Math.max(0, Math.min(1, (clip.color.sharpen ?? 0) + (g.sharpen ?? 0))),
        grain: Math.max(0, Math.min(1, (clip.color.grain ?? 0) + (g.grain ?? 0))),
        lift: Math.max(-0.5, Math.min(0.5, (clip.color.lift ?? 0) + (g.lift ?? 0))),
        gain: Math.max(0.5, Math.min(1.5, (clip.color.gain ?? 1) + ((g.gain ?? 1) - 1))),
      },
    };
  });

  const overlayTrackId =
    cloned.tracks.find((t) => t.kind === 'overlay')?.id ?? cloned.tracks[0]?.id ?? 'track_overlay_1';

  const newOverlays: OverlayLayer[] = [...cloned.overlayLayers];
  if (effectiveInset > 0 || (template.config.borderWidth ?? 0) > 0) {
    newOverlays.push({
      id: createId('ovl'),
      trackId: overlayTrackId,
      kind: 'shape',
      name: `${template.name} Frame`,
      shapeType: 'frame',
      fillColor: 'transparent',
      strokeColor: template.config.borderColor ?? 'rgba(255,255,255,0.2)',
      strokeWidth: template.config.borderWidth ?? 2,
      startTime: 0,
      duration: totalDuration,
      x: 0,
      y: 0,
      width: Math.min(0.98, 1 - effectiveInset * 2),
      height: Math.min(0.98, 1 - effectiveInset * 2),
      scale: 1,
      opacity: 1,
      rotation: 0,
    });
  }

  if (template.config.accentShape?.enabled) {
    const s = template.config.accentShape;
    newOverlays.push({
      id: createId('ovl'),
      trackId: overlayTrackId,
      kind: 'shape',
      name: `${template.name} Accent`,
      shapeType: s.shapeType,
      fillColor: s.fillColor,
      strokeColor: s.strokeColor,
      strokeWidth: s.strokeWidth,
      startTime: 0,
      duration: totalDuration,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      scale: 1,
      opacity: 1,
      rotation: 0,
    });
  }
  cloned.overlayLayers = newOverlays;

  const newTexts: TextLayer[] = [...cloned.textLayers];
  if (template.config.titleOverlay?.enabled) {
    const t = template.config.titleOverlay;
    newTexts.push({
      id: createId('txt'),
      trackId: overlayTrackId,
      text: t.defaultText,
      startTime: 0,
      duration: Math.min(totalDuration, 4.0),
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      color: t.color,
      backgroundColor: 'transparent',
      align: 'center',
      x: 0,
      y: t.y,
      scale: 1,
      opacity: 1,
      rotation: 0,
      role: 'annotation',
    });
  }

  // Re-adapt transcript captions & mouth-safe placement using cached analysis without re-running models
  const segments = options?.analysisBundle?.segments ?? sourceProject.transcriptSegments ?? [];
  const sceneMap = options?.analysisBundle?.sceneMap ?? sourceProject.sceneMap;
  if (sceneMap) cloned.sceneMap = sceneMap;
  if (segments.length > 0) {
    cloned.transcriptSegments = segments;
    const plan = buildEditorialPlan({
      projectId: cloned.id,
      segments,
      sceneMap,
      template,
    });
    cloned.editorialPlan = plan;
    const generated = editorialPlanToTimelineLayers({
      plan,
      segments,
      overlayTrackId,
      template,
      enableSoundDesign:
        options?.enableSoundDesign ?? template.config.soundProfile?.enabled ?? true,
    });

    // Replace previous auto-generated caption layers while preserving manual non-transcript titles
    const manualTexts = newTexts.filter((t) => !t.transcriptSegmentId);
    cloned.textLayers = [...manualTexts, ...generated.textLayers];
    cloned.soundCues = [...(cloned.soundCues ?? []), ...generated.soundCues];
  } else {
    cloned.textLayers = newTexts;
  }

  return cloned;
}
