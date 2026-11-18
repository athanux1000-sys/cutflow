import Ajv, { ErrorObject } from 'ajv';
import {
  AnimationPreset,
  AspectRatio,
  ColorAdjustments,
  CUTFLOW_TEMPLATE_FORMAT,
  CUTFLOW_TEMPLATE_MANIFEST_VERSION,
  CutFlowTemplateManifest,
  LayoutAnchorId,
  TEMPLATE_SCHEMA_VERSION,
  TemplateDefinition,
  TypographyRoleRule,
} from '../types/project';
import { createId, defaultColorAdjustments } from '../utils/timelineMath';
import { CURATED_BUNDLED_FONTS, isFontAvailableInRuntime } from './fonts';

const ALLOWED_ASPECT_RATIOS: AspectRatio[] = ['9:16', '1:1', '16:9'];
const ALLOWED_ANCHORS: LayoutAnchorId[] = [
  'upper-left',
  'top-center',
  'upper-right',
  'center-left',
  'center',
  'center-right',
  'lower-left',
  'lower-center',
  'lower-right',
];
const ALLOWED_ANIMATIONS: AnimationPreset[] = [
  'none',
  'fade',
  'slide-up',
  'spring-pop',
  'impact',
  'word-reveal',
  'kinetic-cascade',
  'type-on',
  'mask-reveal',
  'tracking-reveal',
  'stagger',
  'bounce',
  'shake',
  'emphasis-pulse',
  'motion-trail',
];

const roleRuleSchema = {
  type: 'object',
  required: ['fontFamily', 'fontWeight', 'sizeRatio', 'color'],
  additionalProperties: false,
  properties: {
    fontFamily: { type: 'string', minLength: 1, maxLength: 80 },
    fontWeight: { type: 'integer', enum: [400, 500, 600, 700] },
    sizeRatio: { type: 'number', minimum: 0.4, maximum: 3.5 },
    color: { type: 'string', minLength: 1, maxLength: 40 },
    backgroundColor: { type: 'string', maxLength: 40 },
    textCase: { type: 'string', enum: ['none', 'upper', 'title'] },
    letterSpacing: { type: 'number', minimum: -4, maximum: 24 },
    lineHeight: { type: 'number', minimum: 0.85, maximum: 2.2 },
  },
} as const;

export const CUTFLOW_TEMPLATE_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CUTflow Template Manifest (cutflow.template 1.0.0)',
  type: 'object',
  required: [
    'format',
    'schemaVersion',
    'id',
    'name',
    'description',
    'category',
    'tags',
    'aspectRatios',
    'defaultAspectRatio',
    'version',
    'designSystem',
    'typography',
    'layout',
    'adaptation',
    'animation',
    'colour',
    'audio',
    'assets',
    'preview',
    'metadata',
  ],
  additionalProperties: false,
  properties: {
    format: { const: CUTFLOW_TEMPLATE_FORMAT },
    schemaVersion: { const: CUTFLOW_TEMPLATE_MANIFEST_VERSION },
    id: { type: 'string', minLength: 2, maxLength: 80 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 320 },
    category: { type: 'string', minLength: 1, maxLength: 40 },
    tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 32 } },
    aspectRatios: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: ALLOWED_ASPECT_RATIOS },
    },
    defaultAspectRatio: { type: 'string', enum: ALLOWED_ASPECT_RATIOS },
    version: { type: 'string', minLength: 1, maxLength: 24 },
    designSystem: {
      type: 'object',
      required: [
        'mood',
        'backgroundColor',
        'accentColor',
        'secondaryColor',
        'frameInset',
        'frameRadius',
        'fitMode',
        'vignetteStrength',
      ],
      additionalProperties: false,
      properties: {
        mood: { type: 'string', maxLength: 80 },
        backgroundColor: { type: 'string', maxLength: 40 },
        accentColor: { type: 'string', maxLength: 40 },
        secondaryColor: { type: 'string', maxLength: 40 },
        frameInset: { type: 'number', minimum: 0, maximum: 0.25 },
        frameRadius: { type: 'number', minimum: 0, maximum: 64 },
        borderColor: { type: 'string', maxLength: 40 },
        borderWidth: { type: 'number', minimum: 0, maximum: 16 },
        fitMode: { type: 'string', enum: ['fit', 'fill', 'stretch'] },
        vignetteStrength: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    typography: {
      type: 'object',
      required: ['pairingName', 'hero', 'supporting', 'standard', 'annotation', 'kicker'],
      additionalProperties: false,
      properties: {
        pairingName: { type: 'string', minLength: 1, maxLength: 80 },
        hero: roleRuleSchema,
        supporting: roleRuleSchema,
        standard: roleRuleSchema,
        annotation: roleRuleSchema,
        kicker: roleRuleSchema,
      },
    },
    layout: {
      type: 'object',
      required: [
        'preferredAnchors',
        'faceSafeMargin',
        'avoidMouth',
        'avoidOcr',
        'maxLinesPerBlock',
        'splitPacingStyle',
      ],
      additionalProperties: false,
      properties: {
        preferredAnchors: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: ALLOWED_ANCHORS },
        },
        faceSafeMargin: { type: 'number', minimum: 0, maximum: 0.25 },
        avoidMouth: { type: 'boolean' },
        avoidOcr: { type: 'boolean' },
        maxLinesPerBlock: { type: 'integer', minimum: 1, maximum: 4 },
        splitPacingStyle: {
          type: 'string',
          enum: ['balanced', 'punchy', 'split-screen', 'editorial'],
        },
        accentShape: {
          type: 'object',
          required: [
            'enabled',
            'shapeType',
            'fillColor',
            'strokeColor',
            'strokeWidth',
            'x',
            'y',
            'width',
            'height',
          ],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            shapeType: {
              type: 'string',
              enum: ['rectangle', 'circle', 'frame', 'lower-third', 'line'],
            },
            fillColor: { type: 'string', maxLength: 40 },
            strokeColor: { type: 'string', maxLength: 40 },
            strokeWidth: { type: 'number', minimum: 0, maximum: 24 },
            x: { type: 'number', minimum: -0.5, maximum: 0.5 },
            y: { type: 'number', minimum: -0.5, maximum: 0.5 },
            width: { type: 'number', minimum: 0.02, maximum: 1 },
            height: { type: 'number', minimum: 0.01, maximum: 1 },
          },
        },
        titleOverlay: {
          type: 'object',
          required: ['enabled', 'defaultText', 'fontFamily', 'fontSize', 'fontWeight', 'color', 'y'],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            defaultText: { type: 'string', maxLength: 100 },
            fontFamily: { type: 'string', maxLength: 80 },
            fontSize: { type: 'number', minimum: 12, maximum: 120 },
            fontWeight: { type: 'integer', enum: [500, 600, 700] },
            color: { type: 'string', maxLength: 40 },
            y: { type: 'number', minimum: -0.5, maximum: 0.5 },
          },
        },
      },
    },
    adaptation: {
      type: 'object',
      required: ['aspectOverrides', 'autoWrapMaxWidthRatio', 'orphanAvoidance', 'longSentenceStrategy'],
      additionalProperties: false,
      properties: {
        aspectOverrides: {
          type: 'object',
          additionalProperties: false,
          properties: {
            '9:16': {
              type: 'object',
              additionalProperties: false,
              properties: {
                frameInset: { type: 'number', minimum: 0, maximum: 0.25 },
                scaleMul: { type: 'number', minimum: 0.4, maximum: 2 },
                fontSizeScale: { type: 'number', minimum: 0.6, maximum: 1.6 },
              },
            },
            '1:1': {
              type: 'object',
              additionalProperties: false,
              properties: {
                frameInset: { type: 'number', minimum: 0, maximum: 0.25 },
                scaleMul: { type: 'number', minimum: 0.4, maximum: 2 },
                fontSizeScale: { type: 'number', minimum: 0.6, maximum: 1.6 },
              },
            },
            '16:9': {
              type: 'object',
              additionalProperties: false,
              properties: {
                frameInset: { type: 'number', minimum: 0, maximum: 0.25 },
                scaleMul: { type: 'number', minimum: 0.4, maximum: 2 },
                fontSizeScale: { type: 'number', minimum: 0.6, maximum: 1.6 },
              },
            },
          },
        },
        autoWrapMaxWidthRatio: { type: 'number', minimum: 0.4, maximum: 0.94 },
        orphanAvoidance: { type: 'boolean' },
        longSentenceStrategy: {
          type: 'string',
          enum: ['split-phrases', 'scale-down', 'stack-vertical'],
        },
      },
    },
    animation: {
      type: 'object',
      required: [
        'preferredPreset',
        'heroPreset',
        'supportingPreset',
        'springStiffness',
        'springDamping',
        'springMass',
        'anticipationMs',
        'motionBlurStrength',
        'staggerMs',
      ],
      additionalProperties: false,
      properties: {
        preferredPreset: { type: 'string', enum: ALLOWED_ANIMATIONS },
        heroPreset: { type: 'string', enum: ALLOWED_ANIMATIONS },
        supportingPreset: { type: 'string', enum: ALLOWED_ANIMATIONS },
        springStiffness: { type: 'number', minimum: 40, maximum: 600 },
        springDamping: { type: 'number', minimum: 4, maximum: 60 },
        springMass: { type: 'number', minimum: 0.3, maximum: 4 },
        anticipationMs: { type: 'number', minimum: 0, maximum: 150 },
        motionBlurStrength: { type: 'number', minimum: 0, maximum: 1 },
        staggerMs: { type: 'number', minimum: 15, maximum: 250 },
      },
    },
    colour: {
      type: 'object',
      required: [
        'brightness',
        'contrast',
        'saturation',
        'blur',
        'exposure',
        'temperature',
        'tint',
        'highlights',
        'shadows',
        'whites',
        'blacks',
        'vibrance',
        'gamma',
        'vignette',
        'sharpen',
        'grain',
      ],
      additionalProperties: false,
      properties: {
        brightness: { type: 'number', minimum: -1, maximum: 1 },
        contrast: { type: 'number', minimum: -1, maximum: 1 },
        saturation: { type: 'number', minimum: -1, maximum: 1 },
        blur: { type: 'number', minimum: 0, maximum: 20 },
        exposure: { type: 'number', minimum: -2, maximum: 2 },
        temperature: { type: 'number', minimum: -1, maximum: 1 },
        tint: { type: 'number', minimum: -1, maximum: 1 },
        highlights: { type: 'number', minimum: -1, maximum: 1 },
        shadows: { type: 'number', minimum: -1, maximum: 1 },
        whites: { type: 'number', minimum: -1, maximum: 1 },
        blacks: { type: 'number', minimum: -1, maximum: 1 },
        vibrance: { type: 'number', minimum: -1, maximum: 1 },
        gamma: { type: 'number', minimum: 0.5, maximum: 2 },
        vignette: { type: 'number', minimum: 0, maximum: 1 },
        sharpen: { type: 'number', minimum: 0, maximum: 1 },
        grain: { type: 'number', minimum: 0, maximum: 1 },
        lift: { type: 'number', minimum: -0.5, maximum: 0.5 },
        gain: { type: 'number', minimum: 0.5, maximum: 1.5 },
      },
    },
    audio: {
      type: 'object',
      required: ['enabled', 'heroSfx', 'transitionSfx', 'cueVolume'],
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        heroSfx: {
          type: 'string',
          enum: ['none', 'soft-pop', 'impact-hit', 'whoosh-in', 'subtle-tick'],
        },
        transitionSfx: {
          type: 'string',
          enum: ['none', 'soft-pop', 'impact-hit', 'whoosh-in', 'subtle-tick'],
        },
        cueVolume: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'role', 'mimeType'],
        additionalProperties: false,
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 180 },
          role: { type: 'string', enum: ['font', 'overlay', 'lut', 'preview'] },
          mimeType: { type: 'string', minLength: 3, maxLength: 80 },
          optional: { type: 'boolean' },
        },
      },
    },
    preview: {
      type: 'object',
      required: ['sampleTitle', 'sampleHeroWord', 'sampleCaption', 'sampleKicker'],
      additionalProperties: false,
      properties: {
        sampleTitle: { type: 'string', maxLength: 80 },
        sampleHeroWord: { type: 'string', maxLength: 40 },
        sampleCaption: { type: 'string', maxLength: 120 },
        sampleKicker: { type: 'string', maxLength: 40 },
      },
    },
    metadata: {
      type: 'object',
      required: ['author', 'source', 'license', 'createdAt'],
      additionalProperties: false,
      properties: {
        author: { type: 'string', maxLength: 80 },
        source: {
          type: 'string',
          enum: ['built-in', 'creator', 'imported', 'gemini-assisted', 'video-cloned'],
        },
        license: { type: 'string', maxLength: 80 },
        createdAt: { type: 'number' },
        notes: { type: 'string', maxLength: 300 },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateManifestAjv = ajv.compile<CutFlowTemplateManifest>(CUTFLOW_TEMPLATE_JSON_SCHEMA);

function containsUnsafeScriptPattern(value: unknown): boolean {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('<script') ||
      lower.includes('javascript:') ||
      lower.includes('eval(') ||
      lower.includes('new function') ||
      /on(?:load|error|click)\s*=/.test(lower)
    );
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafeScriptPattern);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsUnsafeScriptPattern);
  }
  return false;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((err) => {
    const path = err.instancePath ? err.instancePath : '/';
    const extra =
      err.keyword === 'additionalProperties' && err.params?.additionalProperty
        ? ` (unexpected property "${String(err.params.additionalProperty)}")`
        : err.keyword === 'required' && err.params?.missingProperty
          ? ` (missing "${String(err.params.missingProperty)}")`
          : '';
    return `${path}: ${err.message ?? 'Invalid value'}${extra}`;
  });
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  fontWarnings: string[];
  manifest?: CutFlowTemplateManifest;
  template?: TemplateDefinition;
}

export function collectManifestFontDependencies(
  manifest: CutFlowTemplateManifest,
  customFontFamilies: string[] = []
): { usedFonts: string[]; missingFonts: string[] } {
  const used = new Set<string>([
    manifest.typography.hero.fontFamily,
    manifest.typography.supporting.fontFamily,
    manifest.typography.standard.fontFamily,
    manifest.typography.annotation.fontFamily,
    manifest.typography.kicker.fontFamily,
  ]);
  if (manifest.layout.titleOverlay?.fontFamily) {
    used.add(manifest.layout.titleOverlay.fontFamily);
  }
  const usedFonts = [...used].filter(Boolean);
  const missingFonts = usedFonts.filter(
    (font) => !isFontAvailableInRuntime(font, customFontFamilies)
  );
  return { usedFonts, missingFonts };
}

export function manifestToTemplateDefinition(
  manifest: CutFlowTemplateManifest,
  overrides?: {
    id?: string;
    isBuiltIn?: boolean;
    isFavorite?: boolean;
    createdAt?: number;
  }
): TemplateDefinition {
  const aspectRatio = manifest.defaultAspectRatio ?? manifest.aspectRatios[0] ?? '9:16';
  const colorGrade: ColorAdjustments = {
    ...defaultColorAdjustments(),
    ...manifest.colour,
  };

  return {
    id: overrides?.id ?? manifest.id ?? createId('tpl'),
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    tags: manifest.tags,
    aspectRatio,
    version: manifest.version,
    previewImage: '',
    isFavorite: overrides?.isFavorite ?? false,
    isBuiltIn: overrides?.isBuiltIn ?? manifest.metadata.source === 'built-in',
    createdAt: overrides?.createdAt ?? manifest.metadata.createdAt ?? Date.now(),
    assetReferences: manifest.assets.map((a) => a.path),
    license: manifest.metadata.license,
    config: {
      aspectRatio,
      backgroundColor: manifest.designSystem.backgroundColor,
      frameInset: manifest.designSystem.frameInset,
      frameRadius: manifest.designSystem.frameRadius,
      borderColor: manifest.designSystem.borderColor,
      borderWidth: manifest.designSystem.borderWidth ?? 0,
      fitMode: manifest.designSystem.fitMode,
      vignetteStrength: manifest.designSystem.vignetteStrength,
      colorGrade,
      typography: {
        heroFont: manifest.typography.hero.fontFamily,
        bodyFont: manifest.typography.standard.fontFamily,
        annotationFont: manifest.typography.annotation.fontFamily,
        kickerFont: manifest.typography.kicker.fontFamily,
        heroColor: manifest.typography.hero.color,
        bodyColor: manifest.typography.standard.color,
        panelColor:
          manifest.typography.standard.backgroundColor ?? 'rgba(11,12,14,0.72)',
        preferredAnimation: manifest.animation.preferredPreset,
        springStiffness: manifest.animation.springStiffness,
        springDamping: manifest.animation.springDamping,
        anticipationMs: manifest.animation.anticipationMs,
      },
      soundProfile: {
        enabled: manifest.audio.enabled,
        heroSfx: manifest.audio.heroSfx,
        transitionSfx: manifest.audio.transitionSfx,
      },
      preferredAnchors: manifest.layout.preferredAnchors,
      titleOverlay: manifest.layout.titleOverlay,
      accentShape: manifest.layout.accentShape,
    },
    manifest,
  };
}

export function templateDefinitionToManifest(
  tpl: TemplateDefinition
): CutFlowTemplateManifest {
  if (tpl.manifest) {
    return {
      ...tpl.manifest,
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      category: tpl.category,
      tags: tpl.tags,
      defaultAspectRatio: tpl.aspectRatio,
      version: tpl.version,
    };
  }

  const c = tpl.config;
  const heroFont = c.typography?.heroFont ?? 'Space Grotesk';
  const bodyFont = c.typography?.bodyFont ?? 'Inter';
  const kickerFont = c.typography?.kickerFont ?? 'IBM Plex Mono';
  const roleDefaults = (
    fontFamily: string,
    weight: 400 | 500 | 600 | 700,
    sizeRatio: number,
    color: string
  ): TypographyRoleRule => ({
    fontFamily,
    fontWeight: weight,
    sizeRatio,
    color,
    backgroundColor: c.typography?.panelColor ?? 'rgba(11,12,14,0.72)',
    textCase: 'none',
    letterSpacing: 0,
    lineHeight: 1.25,
  });

  return {
    format: CUTFLOW_TEMPLATE_FORMAT,
    schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
    id: tpl.id,
    name: tpl.name,
    description: tpl.description || 'Custom CUTflow template',
    category: tpl.category || 'Custom',
    tags: tpl.tags.length ? tpl.tags : [tpl.aspectRatio],
    aspectRatios: [tpl.aspectRatio],
    defaultAspectRatio: tpl.aspectRatio,
    version: tpl.version || '1.0.0',
    designSystem: {
      mood: tpl.category || 'Custom',
      backgroundColor: c.backgroundColor,
      accentColor: c.typography?.heroColor ?? '#14B8A6',
      secondaryColor: c.typography?.bodyColor ?? '#CBD5E1',
      frameInset: c.frameInset,
      frameRadius: c.frameRadius,
      borderColor: c.borderColor ?? 'rgba(255,255,255,0.2)',
      borderWidth: c.borderWidth ?? 1,
      fitMode: c.fitMode,
      vignetteStrength: c.vignetteStrength,
    },
    typography: {
      pairingName: `${heroFont} + ${bodyFont}`,
      hero: roleDefaults(heroFont, 700, 1.35, c.typography?.heroColor ?? '#FACC15'),
      supporting: roleDefaults(bodyFont, 600, 1.0, c.typography?.bodyColor ?? '#FFFFFF'),
      standard: roleDefaults(bodyFont, 500, 0.95, c.typography?.bodyColor ?? '#F4F5F7'),
      annotation: roleDefaults(bodyFont, 500, 0.78, c.typography?.bodyColor ?? '#CBD5E1'),
      kicker: roleDefaults(kickerFont, 600, 0.72, c.typography?.heroColor ?? '#14B8A6'),
    },
    layout: {
      preferredAnchors: c.preferredAnchors ?? ['lower-center', 'top-center'],
      faceSafeMargin: 0.05,
      avoidMouth: true,
      avoidOcr: true,
      maxLinesPerBlock: 2,
      splitPacingStyle: 'balanced',
      accentShape: c.accentShape,
      titleOverlay: c.titleOverlay,
    },
    adaptation: {
      aspectOverrides: {
        '9:16': { frameInset: c.frameInset, scaleMul: 1, fontSizeScale: 1 },
        '1:1': { frameInset: Math.min(c.frameInset, 0.05), scaleMul: 0.96, fontSizeScale: 0.95 },
        '16:9': { frameInset: Math.min(c.frameInset, 0.03), scaleMul: 0.92, fontSizeScale: 0.9 },
      },
      autoWrapMaxWidthRatio: 0.82,
      orphanAvoidance: true,
      longSentenceStrategy: 'split-phrases',
    },
    animation: {
      preferredPreset: c.typography?.preferredAnimation ?? 'spring-pop',
      heroPreset: c.typography?.preferredAnimation ?? 'impact',
      supportingPreset: 'slide-up',
      springStiffness: c.typography?.springStiffness ?? 260,
      springDamping: c.typography?.springDamping ?? 18,
      springMass: 1,
      anticipationMs: c.typography?.anticipationMs ?? 40,
      motionBlurStrength: 0.3,
      staggerMs: 65,
    },
    colour: { ...defaultColorAdjustments(), ...c.colorGrade },
    audio: {
      enabled: c.soundProfile?.enabled ?? true,
      heroSfx: c.soundProfile?.heroSfx ?? 'soft-pop',
      transitionSfx: c.soundProfile?.transitionSfx ?? 'whoosh-in',
      cueVolume: 0.25,
    },
    assets: [],
    preview: {
      sampleTitle: c.titleOverlay?.defaultText || tpl.name.toUpperCase(),
      sampleHeroWord: 'JANNAT',
      sampleCaption: 'Ye asli jannat hai bhai!',
      sampleKicker: '01 // CUTFLOW',
    },
    metadata: {
      author: 'CutFlow User',
      source: tpl.isBuiltIn ? 'built-in' : 'creator',
      license: tpl.license ?? 'CutFlow Template License',
      createdAt: tpl.createdAt || Date.now(),
    },
  };
}

export function validateCutFlowTemplateManifest(
  raw: unknown,
  customFontFamilies: string[] = []
): ManifestValidationResult {
  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      errors: ['/: Manifest root must be a JSON object.'],
      fontWarnings: [],
    };
  }

  if (containsUnsafeScriptPattern(raw)) {
    return {
      valid: false,
      errors: ['/: Rejected template because executable script patterns are not permitted.'],
      fontWarnings: [],
    };
  }

  const ok = validateManifestAjv(raw);
  if (!ok) {
    return {
      valid: false,
      errors: formatAjvErrors(validateManifestAjv.errors),
      fontWarnings: [],
    };
  }

  const manifest = raw as CutFlowTemplateManifest;
  if (!manifest.aspectRatios.includes(manifest.defaultAspectRatio)) {
    return {
      valid: false,
      errors: ['/defaultAspectRatio: defaultAspectRatio must be included in aspectRatios.'],
      fontWarnings: [],
    };
  }

  const { missingFonts } = collectManifestFontDependencies(manifest, customFontFamilies);
  const fontWarnings = missingFonts.map(
    (font) =>
      `Font "${font}" is not bundled or imported locally. CUTflow will fall back to "Inter" until you import it in Settings -> Local Fonts.`
  );

  const template = manifestToTemplateDefinition(manifest, {
    id: createId('tpl'),
    isBuiltIn: false,
    createdAt: Date.now(),
  });

  return {
    valid: true,
    errors: [],
    fontWarnings,
    manifest,
    template,
  };
}

export const GEMINI_EXAMPLE_TEMPLATE_MANIFEST: CutFlowTemplateManifest = {
  format: CUTFLOW_TEMPLATE_FORMAT,
  schemaVersion: CUTFLOW_TEMPLATE_MANIFEST_VERSION,
  id: 'tpl_gemini_kinetic_breakdown',
  name: 'Creator Breakdown Pulse',
  description:
    'Gemini-assisted rule approximation extracted from a fast-paced talking-head breakdown reel with crisp contrast, teal kicker tags, and spring-pop emphasis.',
  category: 'Kinetic',
  tags: ['9:16', 'breakdown', 'hinglish', 'gemini-assisted'],
  aspectRatios: ['9:16', '1:1', '16:9'],
  defaultAspectRatio: '9:16',
  version: '1.0.0',
  designSystem: {
    mood: 'Crisp Technical Editorial',
    backgroundColor: '#0D1014',
    accentColor: '#14B8A6',
    secondaryColor: '#E2E8F0',
    frameInset: 0.04,
    frameRadius: 12,
    borderColor: 'rgba(20,184,166,0.32)',
    borderWidth: 2,
    fitMode: 'fill',
    vignetteStrength: 0.24,
  },
  typography: {
    pairingName: 'Space Grotesk + Inter + IBM Plex Mono',
    hero: {
      fontFamily: 'Space Grotesk',
      fontWeight: 700,
      sizeRatio: 1.4,
      color: '#FACC15',
      backgroundColor: 'rgba(11,12,14,0.82)',
      textCase: 'upper',
      letterSpacing: 1,
      lineHeight: 1.12,
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
      backgroundColor: 'rgba(11,12,14,0.7)',
      textCase: 'none',
      letterSpacing: 0,
      lineHeight: 1.25,
    },
    annotation: {
      fontFamily: 'IBM Plex Sans',
      fontWeight: 500,
      sizeRatio: 0.78,
      color: '#94A3B8',
      backgroundColor: 'rgba(11,12,14,0.65)',
      textCase: 'none',
      letterSpacing: 0.2,
      lineHeight: 1.2,
    },
    kicker: {
      fontFamily: 'IBM Plex Mono',
      fontWeight: 600,
      sizeRatio: 0.7,
      color: '#2DD4BF',
      backgroundColor: 'rgba(13,16,20,0.85)',
      textCase: 'upper',
      letterSpacing: 1.6,
      lineHeight: 1.15,
    },
  },
  layout: {
    preferredAnchors: ['lower-center', 'top-center', 'upper-left', 'upper-right'],
    faceSafeMargin: 0.06,
    avoidMouth: true,
    avoidOcr: true,
    maxLinesPerBlock: 2,
    splitPacingStyle: 'punchy',
    accentShape: {
      enabled: true,
      shapeType: 'line',
      fillColor: 'transparent',
      strokeColor: '#14B8A6',
      strokeWidth: 3,
      x: 0,
      y: 0.42,
      width: 0.36,
      height: 0.02,
    },
    titleOverlay: {
      enabled: true,
      defaultText: 'BREAKDOWN // 01',
      fontFamily: 'IBM Plex Mono',
      fontSize: 28,
      fontWeight: 600,
      color: '#2DD4BF',
      y: -0.41,
    },
  },
  adaptation: {
    aspectOverrides: {
      '9:16': { frameInset: 0.04, scaleMul: 1, fontSizeScale: 1 },
      '1:1': { frameInset: 0.04, scaleMul: 0.96, fontSizeScale: 0.94 },
      '16:9': { frameInset: 0.02, scaleMul: 0.92, fontSizeScale: 0.88 },
    },
    autoWrapMaxWidthRatio: 0.82,
    orphanAvoidance: true,
    longSentenceStrategy: 'split-phrases',
  },
  animation: {
    preferredPreset: 'spring-pop',
    heroPreset: 'impact',
    supportingPreset: 'mask-reveal',
    springStiffness: 300,
    springDamping: 17,
    springMass: 1,
    anticipationMs: 40,
    motionBlurStrength: 0.35,
    staggerMs: 60,
  },
  colour: {
    ...defaultColorAdjustments(),
    contrast: 0.12,
    vibrance: 0.16,
    shadows: 0.06,
    vignette: 0.22,
    sharpen: 0.15,
    grain: 0.04,
  },
  audio: {
    enabled: true,
    heroSfx: 'soft-pop',
    transitionSfx: 'whoosh-in',
    cueVolume: 0.25,
  },
  assets: [],
  preview: {
    sampleTitle: 'BREAKDOWN // 01',
    sampleHeroWord: 'ASLI',
    sampleCaption: 'Ye asli jannat hai bhai!',
    sampleKicker: 'LOCAL WORKFLOW',
  },
  metadata: {
    author: 'Gemini + CutFlow User',
    source: 'gemini-assisted',
    license: 'Creative Commons CC0',
    createdAt: 1700000010000,
    notes: 'Generated as an editable cutflow.template 1.0.0 rule approximation.',
  },
};

export const GEMINI_TEMPLATE_PROMPT = `You are helping design a declarative video template for CUTflow.
Analyze the reference video I have attached in this Gemini conversation and output ONLY a single valid JSON object matching CUTflow Template Schema "cutflow.template" version "1.0.0".

Important rules:
1. Do NOT invent unsupported APIs, scripts, shaders, keyframes, or executable code.
2. Output strictly valid JSON (no markdown commentary outside JSON if possible).
3. Use ONLY these bundled offline CUTflow font families (unless specifying a font file the user will import):
   ${CURATED_BUNDLED_FONTS.map((f) => `"${f.family}"`).join(', ')}
4. Allowed "animation.preferredPreset" / "heroPreset" / "supportingPreset":
   "none", "fade", "slide-up", "spring-pop", "impact", "word-reveal", "kinetic-cascade", "type-on", "mask-reveal", "tracking-reveal", "stagger", "bounce", "shake", "emphasis-pulse", "motion-trail"
5. Allowed "layout.preferredAnchors":
   "upper-left", "top-center", "upper-right", "center-left", "center", "center-right", "lower-left", "lower-center", "lower-right"
6. Remember: extracted templates are an editable rule-based approximation inside CUTflow.

Required JSON template structure:
${JSON.stringify(GEMINI_EXAMPLE_TEMPLATE_MANIFEST, null, 2)}
`;
