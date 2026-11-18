import { UserFontRecord } from '../types/project';
import { createId } from '../utils/timelineMath';
import { deleteUserFontRecord, listUserFontRecords, saveUserFontRecord } from './storage';

export interface CuratedFontEntry {
  family: string;
  label: string;
  category: 'sans' | 'condensed' | 'serif' | 'mono' | 'display';
  weights: number[];
  license: string;
  bundled: true;
  bestFor: string;
}

export const CURATED_BUNDLED_FONTS: CuratedFontEntry[] = [
  {
    family: 'Inter',
    label: 'Inter',
    category: 'sans',
    weights: [400, 500, 600, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Clean UI & neutral podcast / explainer subtitles',
  },
  {
    family: 'IBM Plex Sans',
    label: 'IBM Plex Sans',
    category: 'sans',
    weights: [400, 500, 600, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Technical annotations & structured explainers',
  },
  {
    family: 'IBM Plex Mono',
    label: 'IBM Plex Mono',
    category: 'mono',
    weights: [400, 500, 600, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Kickers, timestamps, data callouts & monospace captions',
  },
  {
    family: 'Barlow Condensed',
    label: 'Barlow Condensed',
    category: 'condensed',
    weights: [500, 600, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'High-density kinetic stacks & punchy vertical reels',
  },
  {
    family: 'Space Grotesk',
    label: 'Space Grotesk',
    category: 'display',
    weights: [500, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Modern editorial display headers & tech storytelling',
  },
  {
    family: 'DM Sans',
    label: 'DM Sans',
    category: 'sans',
    weights: [400, 500, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Conversational Hinglish & creator video captions',
  },
  {
    family: 'Playfair Display',
    label: 'Playfair Display',
    category: 'serif',
    weights: [600, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Cinematic editorial headlines & storytelling emphasis',
  },
  {
    family: 'Source Serif 4',
    label: 'Source Serif 4',
    category: 'serif',
    weights: [400, 600, 700],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Documentary pull quotes & literary subtitles',
  },
  {
    family: 'Archivo Black',
    label: 'Archivo Black',
    category: 'display',
    weights: [400],
    license: 'SIL Open Font License 1.1',
    bundled: true,
    bestFor: 'Bold hero words & high-impact emphasis blocks',
  },
];

const loadedCustomFamilies = new Set<string>();

export async function ensureAllLocalFontsLoaded(): Promise<{
  bundledCount: number;
  customFamilies: string[];
}> {
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore in non-browser tests
    }
  }

  const userFonts = await listUserFontRecords().catch(() => []);
  const customFamilies: string[] = [];

  for (const uf of userFonts) {
    const ok = await registerFontFaceInBrowser(uf);
    if (ok) customFamilies.push(uf.familyName);
  }

  return {
    bundledCount: CURATED_BUNDLED_FONTS.length,
    customFamilies,
  };
}

export async function registerFontFaceInBrowser(record: UserFontRecord): Promise<boolean> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
  if (loadedCustomFamilies.has(record.familyName)) return true;

  try {
    const face = new FontFace(record.familyName, record.data.slice(0));
    const loaded = await face.load();
    document.fonts.add(loaded);
    loadedCustomFamilies.add(record.familyName);
    return true;
  } catch {
    return false;
  }
}

export async function importCustomFontFile(file: File, customFamilyName?: string): Promise<UserFontRecord> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
    throw new Error('Unsupported font format. Upload a .ttf, .otf, .woff, or .woff2 file.');
  }

  const familyName = (
    customFamilyName?.trim() ||
    file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  ).slice(0, 60);

  if (!familyName) {
    throw new Error('Please provide a valid font family name.');
  }

  const data = await file.arrayBuffer();
  const record: UserFontRecord = {
    id: createId('font'),
    familyName,
    fileName: file.name,
    mimeType: file.type || `font/${ext}`,
    sizeBytes: data.byteLength,
    licenseNote: 'User-imported local font',
    data,
    createdAt: Date.now(),
  };

  const loaded = await registerFontFaceInBrowser(record);
  if (!loaded) {
    throw new Error('Browser rejected this font binary. Verify the font file is valid.');
  }

  await saveUserFontRecord(record);
  return record;
}

export async function removeCustomFont(id: string): Promise<void> {
  await deleteUserFontRecord(id);
}

export async function listAvailableFontFamilies(): Promise<
  Array<{ family: string; label: string; category: string; bundled: boolean; license: string }>
> {
  const custom = await listUserFontRecords().catch(() => []);
  return [
    ...CURATED_BUNDLED_FONTS.map((f) => ({
      family: f.family,
      label: f.label,
      category: f.category,
      bundled: true,
      license: f.license,
    })),
    ...custom.map((c) => ({
      family: c.familyName,
      label: `${c.familyName} (Imported)`,
      category: 'custom',
      bundled: false,
      license: c.licenseNote ?? 'User-imported font',
    })),
  ];
}

export function isFontAvailableInRuntime(family: string, customFamilies: string[] = []): boolean {
  const clean = family.replace(/['"]/g, '').trim().toLowerCase();
  if (!clean) return false;
  if (CURATED_BUNDLED_FONTS.some((f) => f.family.toLowerCase() === clean)) return true;
  if (customFamilies.some((c) => c.toLowerCase() === clean)) return true;
  if (['sans-serif', 'serif', 'monospace', 'system-ui'].includes(clean)) return true;
  return false;
}
