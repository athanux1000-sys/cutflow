import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
  templateDefinitionToManifest,
  validateCutFlowTemplateManifest,
} from './templateSchema';
import { BUILT_IN_TEMPLATES } from './templates';
import { parseTemplateFileForPreview } from './templatePackage';

test('validateCutFlowTemplateManifest accepts GEMINI_EXAMPLE_TEMPLATE_MANIFEST and all 8 built-in templates', () => {
  const geminiResult = validateCutFlowTemplateManifest(GEMINI_EXAMPLE_TEMPLATE_MANIFEST);
  assert.equal(geminiResult.valid, true, geminiResult.errors.join('; '));
  assert.equal(geminiResult.fontWarnings.length, 0);
  assert.ok(geminiResult.template);

  for (const tpl of BUILT_IN_TEMPLATES) {
    const manifest = templateDefinitionToManifest(tpl);
    const res = validateCutFlowTemplateManifest(manifest);
    assert.equal(res.valid, true, `Built-in ${tpl.name} failed validation: ${res.errors.join('; ')}`);
    assert.equal(res.fontWarnings.length, 0, `Built-in ${tpl.name} has missing bundled font: ${res.fontWarnings.join('; ')}`);
  }
});

test('validateCutFlowTemplateManifest rejects malformed manifests with exact schema paths and blocks script payloads', () => {
  const badAspect = {
    ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
    aspectRatios: ['16:9'],
    defaultAspectRatio: '9:16',
  };
  const aspectRes = validateCutFlowTemplateManifest(badAspect);
  assert.equal(aspectRes.valid, false);
  assert.ok(aspectRes.errors.some((e) => e.includes('/defaultAspectRatio')));

  const missingHeroWeight = {
    ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
    typography: {
      ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST.typography,
      hero: {
        ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST.typography.hero,
        fontWeight: 999,
      },
    },
  };
  const weightRes = validateCutFlowTemplateManifest(missingHeroWeight);
  assert.equal(weightRes.valid, false);
  assert.ok(weightRes.errors.some((e) => e.includes('/typography/hero/fontWeight')));

  const scriptPayload = {
    ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
    description: '<script>alert("xss")</script>',
  };
  const scriptRes = validateCutFlowTemplateManifest(scriptPayload);
  assert.equal(scriptRes.valid, false);
  assert.ok(scriptRes.errors[0].toLowerCase().includes('script'));
});

test('validateCutFlowTemplateManifest warns on unbundled fonts unless listed in customFontFamilies', () => {
  const customFontManifest = {
    ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
    typography: {
      ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST.typography,
      hero: {
        ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST.typography.hero,
        fontFamily: 'Uninstalled Boutique Serif',
      },
    },
  };

  const missingRes = validateCutFlowTemplateManifest(customFontManifest, []);
  assert.equal(missingRes.valid, true);
  assert.ok(missingRes.fontWarnings.some((w) => w.includes('Uninstalled Boutique Serif')));

  const installedRes = validateCutFlowTemplateManifest(customFontManifest, ['Uninstalled Boutique Serif']);
  assert.equal(installedRes.valid, true);
  assert.equal(installedRes.fontWarnings.length, 0);
});

test('parseTemplateFileForPreview extracts manifest.json and font assets from .cftemplate ZIP packages', async () => {
  const manifest = {
    ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
    name: 'Packaged Reel Style',
    typography: {
      ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST.typography,
      hero: {
        ...GEMINI_EXAMPLE_TEMPLATE_MANIFEST.typography.hero,
        fontFamily: 'Brand Display',
      },
    },
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('assets/fonts/Brand-Display.woff2', new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
  const zipBytes = await zip.generateAsync({ type: 'arraybuffer' });

  const file = new File([zipBytes], 'packaged_reel.cftemplate', { type: 'application/zip' });
  const preview = await parseTemplateFileForPreview(file);

  assert.equal(preview.valid, true, preview.errors.join('; '));
  assert.equal(preview.sourceFormat, 'cftemplate-zip');
  assert.equal(preview.template?.name, 'Packaged Reel Style');
  assert.equal(preview.extractedFontFiles.length, 1);
  assert.equal(preview.extractedFontFiles[0].name, 'Brand-Display.woff2');
  // Since Brand-Display.woff2 is included inside the archive, no missing font warning should emit
  assert.equal(preview.fontWarnings.length, 0);
});
