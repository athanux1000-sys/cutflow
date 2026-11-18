import JSZip from 'jszip';
import {
  CFTemplatePackageManifest,
  CUTFLOW_TEMPLATE_FORMAT,
  CutFlowTemplateManifest,
  TemplateDefinition,
  UserFontRecord,
} from '../types/project';
import { createId, validateTemplateJson } from '../utils/timelineMath';
import { importCustomFontFile } from './fonts';
import { saveCustomTemplate } from './storage';
import {
  templateDefinitionToManifest,
  validateCutFlowTemplateManifest,
} from './templateSchema';

export interface ParsedTemplateImportPreview {
  valid: boolean;
  sourceFormat: 'cutflow.template-1.0.0' | 'cftemplate-zip' | 'legacy-v2-json';
  fileName: string;
  errors: string[];
  fontWarnings: string[];
  manifest?: CutFlowTemplateManifest;
  template?: TemplateDefinition;
  extractedFontFiles: Array<{ name: string; mimeType: string; data: ArrayBuffer }>;
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'cutflow_template';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

/**
 * Exports a validated `cutflow.template` 1.0.0 manifest as `.cutflow-template.json`.
 */
export function exportTemplateManifestJson(template: TemplateDefinition): void {
  const manifest = templateDefinitionToManifest(template);
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  });
  triggerBlobDownload(blob, `${slugifyName(template.name)}.cutflow-template.json`);
}

/**
 * Exports a real `.cftemplate` ZIP archive containing `manifest.json` (`cutflow.template` 1.0.0)
 * plus any matching imported custom font binaries referenced by the template.
 */
export async function exportTemplateAsCFTemplateZip(
  template: TemplateDefinition,
  customFonts: UserFontRecord[] = []
): Promise<void> {
  const manifest = templateDefinitionToManifest(template);
  const usedFamilies = new Set([
    manifest.typography.hero.fontFamily.toLowerCase(),
    manifest.typography.supporting.fontFamily.toLowerCase(),
    manifest.typography.standard.fontFamily.toLowerCase(),
    manifest.typography.annotation.fontFamily.toLowerCase(),
    manifest.typography.kicker.fontFamily.toLowerCase(),
  ]);

  const zip = new JSZip();
  const bundledAssets: CutFlowTemplateManifest['assets'] = [];

  for (const uf of customFonts) {
    if (usedFamilies.has(uf.familyName.toLowerCase())) {
      const path = `assets/fonts/${uf.fileName}`;
      zip.file(path, uf.data);
      bundledAssets.push({
        path,
        role: 'font',
        mimeType: uf.mimeType,
        optional: true,
      });
    }
  }

  const finalManifest: CutFlowTemplateManifest = {
    ...manifest,
    assets: bundledAssets,
  };

  zip.file('manifest.json', JSON.stringify(finalManifest, null, 2));
  const pkgMeta: CFTemplatePackageManifest = {
    packageFormat: 'cftemplate',
    manifestVersion: 1,
    template: finalManifest,
    assets: bundledAssets.map((a) => ({
      path: a.path,
      mimeType: a.mimeType,
      role: 'font',
    })),
  };
  zip.file('package.json', JSON.stringify(pkgMeta, null, 2));

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  triggerBlobDownload(zipBlob, `${slugifyName(template.name)}.cftemplate`);
}

/**
 * Parses either a `.cftemplate` ZIP archive or a `.json` / `.cutflow-template.json` file
 * without immediately writing to IndexedDB, so the UI can show a full Import Preview &
 * exact Ajv schema validation errors first.
 */
export async function parseTemplateFileForPreview(
  file: File,
  customFontFamilies: string[] = []
): Promise<ParsedTemplateImportPreview> {
  const lowerName = file.name.toLowerCase();
  const extractedFontFiles: Array<{ name: string; mimeType: string; data: ArrayBuffer }> = [];

  let rawJson: unknown;
  let detectedZip = false;

  if (lowerName.endsWith('.cftemplate') || lowerName.endsWith('.zip')) {
    const buf = await file.arrayBuffer();
    // Check ZIP magic bytes PK\x03\x04; fall back to JSON text if user uploaded .cftemplate JSON
    const header = new Uint8Array(buf.slice(0, 4));
    const isZipMagic = header[0] === 0x50 && header[1] === 0x4b;

    if (isZipMagic) {
      detectedZip = true;
      const zip = await JSZip.loadAsync(buf);
      const manifestEntry = zip.file('manifest.json') ?? zip.file('template.json');
      if (!manifestEntry) {
        return {
          valid: false,
          sourceFormat: 'cftemplate-zip',
          fileName: file.name,
          errors: ['Archive is missing manifest.json inside the .cftemplate ZIP package.'],
          fontWarnings: [],
          extractedFontFiles: [],
        };
      }
      const manifestText = await manifestEntry.async('string');
      try {
        rawJson = JSON.parse(manifestText);
      } catch {
        return {
          valid: false,
          sourceFormat: 'cftemplate-zip',
          fileName: file.name,
          errors: ['manifest.json inside .cftemplate archive is not valid JSON.'],
          fontWarnings: [],
          extractedFontFiles: [],
        };
      }

      // Safely extract any bundled font files (strictly data files, never scripts)
      for (const [entryPath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (/\.(ttf|otf|woff|woff2)$/i.test(entryPath)) {
          const data = await entry.async('arraybuffer');
          const baseName = entryPath.split('/').pop() ?? 'custom_font.woff2';
          extractedFontFiles.push({
            name: baseName,
            mimeType: 'font/' + (baseName.split('.').pop()?.toLowerCase() ?? 'woff2'),
            data,
          });
        }
      }
    } else {
      const text = new TextDecoder().decode(buf);
      try {
        rawJson = JSON.parse(text);
      } catch {
        return {
          valid: false,
          sourceFormat: 'cutflow.template-1.0.0',
          fileName: file.name,
          errors: ['Selected file is neither a valid ZIP archive nor valid JSON.'],
          fontWarnings: [],
          extractedFontFiles: [],
        };
      }
    }
  } else {
    const text = await file.text();
    try {
      rawJson = JSON.parse(text);
    } catch {
      return {
        valid: false,
        sourceFormat: 'cutflow.template-1.0.0',
        fileName: file.name,
        errors: ['Selected file is not valid JSON. Check syntax and try again.'],
        fontWarnings: [],
        extractedFontFiles: [],
      };
    }
  }

  // Unwrap CFTemplatePackageManifest if present
  let candidate: unknown = rawJson;
  if (
    rawJson &&
    typeof rawJson === 'object' &&
    (rawJson as Partial<CFTemplatePackageManifest>).packageFormat === 'cftemplate' &&
    (rawJson as Partial<CFTemplatePackageManifest>).template
  ) {
    candidate = (rawJson as CFTemplatePackageManifest).template;
  }

  // Add font families included in ZIP archive so validator knows they will be available
  const zipFontFamilies = extractedFontFiles.map((f) =>
    f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  );
  const availableFamilies = [...customFontFamilies, ...zipFontFamilies];

  const isManifest10 =
    Boolean(candidate && typeof candidate === 'object') &&
    ((candidate as Partial<CutFlowTemplateManifest>).format === CUTFLOW_TEMPLATE_FORMAT ||
      (candidate as Partial<CutFlowTemplateManifest>).schemaVersion === '1.0.0');

  if (isManifest10) {
    const result = validateCutFlowTemplateManifest(candidate, availableFamilies);
    return {
      valid: result.valid,
      sourceFormat: detectedZip ? 'cftemplate-zip' : 'cutflow.template-1.0.0',
      fileName: file.name,
      errors: result.errors,
      fontWarnings: result.fontWarnings,
      manifest: result.manifest,
      template: result.template,
      extractedFontFiles,
    };
  }

  // Fallback legacy v2 TemplateDefinition check
  const legacy = validateTemplateJson(candidate);
  if (!legacy.valid || !legacy.template) {
    return {
      valid: false,
      sourceFormat: detectedZip ? 'cftemplate-zip' : 'legacy-v2-json',
      fileName: file.name,
      errors: [legacy.error ?? 'Template JSON does not match cutflow.template 1.0.0 schema.'],
      fontWarnings: [],
      extractedFontFiles,
    };
  }

  const hydratedManifest = templateDefinitionToManifest(legacy.template);
  return {
    valid: true,
    sourceFormat: detectedZip ? 'cftemplate-zip' : 'legacy-v2-json',
    fileName: file.name,
    errors: [],
    fontWarnings: [],
    manifest: hydratedManifest,
    template: {
      ...legacy.template,
      id: createId('tpl'),
      manifest: hydratedManifest,
    },
    extractedFontFiles,
  };
}

/**
 * Commits an approved ParsedTemplateImportPreview to IndexedDB, also importing any
 * bundled font files inside the `.cftemplate` ZIP archive.
 */
export async function commitParsedTemplateImport(
  preview: ParsedTemplateImportPreview
): Promise<TemplateDefinition> {
  if (!preview.valid || !preview.template) {
    throw new Error(preview.errors[0] ?? 'Cannot save an invalid template.');
  }

  for (const fontAsset of preview.extractedFontFiles) {
    try {
      const file = new File([fontAsset.data], fontAsset.name, { type: fontAsset.mimeType });
      await importCustomFontFile(file);
    } catch {
      // Ignore duplicate or rejected optional font asset
    }
  }

  const toSave: TemplateDefinition = {
    ...preview.template,
    id: createId('tpl'),
    isBuiltIn: false,
    createdAt: Date.now(),
  };

  await saveCustomTemplate(toSave);
  return toSave;
}
