import {
  CustomVocabEntry,
  RomanizationStyle,
  TranscriptSegment,
  TranscriptWordToken,
} from '../types/project';

const DEVANAGARI_RE = /[\u0900-\u097F]/;
const LATIN_RE = /[A-Za-z]/;
const NON_LATIN_OTHER_RE = /[\u0980-\u0D7F\u0600-\u06FF\u4E00-\u9FFF]/;

// Conversational natural Hinglish mappings for high-frequency function words & common terms
const NATURAL_HINGLISH_LEXICON: Record<string, string> = {
  'मुझे': 'mujhe',
  'मैं': 'main',
  'हम': 'hum',
  'तुम': 'tum',
  'आप': 'aap',
  'ये': 'ye',
  'यह': 'ye',
  'वो': 'wo',
  'वह': 'wo',
  'है': 'hai',
  'हैं': 'hain',
  'था': 'tha',
  'थी': 'thi',
  'थे': 'the',
  'हूँ': 'hoon',
  'हो': 'ho',
  'कहाँ': 'kahan',
  'यहाँ': 'yahan',
  'वहाँ': 'wahan',
  'कब': 'kab',
  'क्यों': 'kyun',
  'कैसे': 'kaise',
  'क्या': 'kya',
  'कौन': 'kaun',
  'और': 'aur',
  'लेकिन': 'lekin',
  'मगर': 'magar',
  'पर': 'par',
  'में': 'mein',
  'से': 'se',
  'को': 'ko',
  'का': 'ka',
  'की': 'ki',
  'के': 'ke',
  'लिए': 'liye',
  'साथ': 'saath',
  'बहुत': 'bahut',
  'अच्छा': 'achha',
  'अच्छी': 'achhi',
  'अच्छे': 'achhe',
  'बढ़िया': 'badhiya',
  'असली': 'asli',
  'जन्नत': 'jannat',
  'भाई': 'bhai',
  'यार': 'yaar',
  'दोस्त': 'dost',
  'करना': 'karna',
  'करने': 'karne',
  'करो': 'karo',
  'रहा': 'raha',
  'रही': 'rahi',
  'रहे': 'rahe',
  'जा': 'ja',
  'आ': 'aa',
  'नहीं': 'nahin',
  'ना': 'na',
  'हाँ': 'haan',
  'तो': 'toh',
  'भी': 'bhi',
  'ही': 'hi',
  'अब': 'ab',
  'जब': 'jab',
  'तब': 'tab',
  'अभी': 'abhi',
  'फिर': 'phir',
  'सब': 'sab',
  'कुछ': 'kuch',
  'थोड़ा': 'thoda',
  'ज्यादा': 'zyada',
  'वीडियो': 'video',
  'एडिट': 'edit',
  'कैमरा': 'camera',
  'एक्सपोर्ट': 'export',
  'फाइनल': 'final',
  'टेम्पलेट': 'template',
  'म्यूजिक': 'music',
  'साउंड': 'sound',
  'स्पीड': 'speed',
};

const VOWELS: Record<string, string> = {
  'अ': 'a',
  'आ': 'aa',
  'इ': 'i',
  'ई': 'ee',
  'उ': 'u',
  'ऊ': 'oo',
  'ऋ': 'ri',
  'ए': 'e',
  'ऐ': 'ai',
  'ओ': 'o',
  'औ': 'au',
};

const MATRAS: Record<string, string> = {
  'ा': 'a',
  'ि': 'i',
  'ी': 'ee',
  'ु': 'u',
  'ू': 'oo',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
};

const CONSONANTS: Record<string, string> = {
  'क': 'k',
  'ख': 'kh',
  'ग': 'g',
  'घ': 'gh',
  'ङ': 'ng',
  'च': 'ch',
  'छ': 'chh',
  'ज': 'j',
  'झ': 'jh',
  'ञ': 'ny',
  'ट': 't',
  'ठ': 'th',
  'ड': 'd',
  'ढ': 'dh',
  'ण': 'n',
  'त': 't',
  'थ': 'th',
  'द': 'd',
  'ध': 'dh',
  'न': 'n',
  'प': 'p',
  'फ': 'ph',
  'ब': 'b',
  'भ': 'bh',
  'म': 'm',
  'य': 'y',
  'र': 'r',
  'ल': 'l',
  'व': 'v',
  'श': 'sh',
  'ष': 'sh',
  'स': 's',
  'ह': 'h',
  'क़': 'q',
  'ख़': 'kh',
  'ग़': 'gh',
  'ज़': 'z',
  'ड़': 'r',
  'ढ़': 'rh',
  'फ़': 'f',
  'ड़्': 'r',
};

const HALANT = '्';
const NUKTA = '़';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';

const NUKTA_MAP: Record<string, string> = {
  'क': 'q',
  'ख': 'kh',
  'ग': 'gh',
  'ज': 'z',
  'ड': 'r',
  'ढ': 'rh',
  'फ': 'f',
};

export function transliterateDevanagariWord(
  word: string,
  style: RomanizationStyle = 'natural-hinglish'
): string {
  // Strip outer punctuation while preserving it
  const match = word.match(/^([^\p{L}\p{M}\p{N}]*)([\s\S]*?)([^\p{L}\p{M}\p{N}]*)$/u);
  const lead = match?.[1] ?? '';
  const core = match?.[2] ?? word;
  const trail = match?.[3] ?? '';

  if (!DEVANAGARI_RE.test(core)) {
    return word;
  }

  if (style === 'natural-hinglish' && NATURAL_HINGLISH_LEXICON[core]) {
    return `${lead}${NATURAL_HINGLISH_LEXICON[core]}${trail}`;
  }

  const chars = Array.from(core);
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (VOWELS[ch]) {
      out += style === 'phonetic-roman' && ch === 'आ' ? 'aa' : VOWELS[ch];
      continue;
    }

    if (CONSONANTS[ch]) {
      let base = CONSONANTS[ch];
      let step = 0;
      if (next === NUKTA) {
        base = NUKTA_MAP[ch] ?? base;
        step = 1;
      }
      const after = chars[i + 1 + step];

      if (after === HALANT) {
        out += base;
        i += 1 + step;
      } else if (after && MATRAS[after]) {
        let vowel = MATRAS[after];
        // Natural Hinglish preference: final 'ी' -> 'i', 'ा' -> 'a'
        if (style === 'natural-hinglish' && after === 'ी' && i + 2 + step >= chars.length) {
          vowel = 'i';
        }
        out += base + vowel;
        i += 1 + step;
      } else {
        // Inherent schwa 'a', deleted at word end for multi-char words
        const isLast = i + 1 + step >= chars.length;
        const isFollowedByNasalAtEnd =
          (after === ANUSVARA || after === CHANDRABINDU) && i + 2 + step >= chars.length;
        if (isLast && chars.length > 1) {
          out += base;
        } else if (isFollowedByNasalAtEnd && chars.length > 2) {
          out += base;
        } else {
          out += base + 'a';
        }
        i += step;
      }
      continue;
    }

    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      out += 'n';
      continue;
    }
    if (ch === VISARGA) {
      out += 'h';
      continue;
    }
    if (ch === '।') {
      out += '.';
      continue;
    }
    if (!MATRAS[ch] && ch !== HALANT && ch !== NUKTA) {
      out += ch;
    }
  }

  // Capitalize first char if sentence/lexicon didn't already
  return `${lead}${out}${trail}`;
}

export function applyCustomVocabulary(
  text: string,
  vocab: CustomVocabEntry[]
): string {
  if (!vocab.length) return text;
  let result = text;
  for (const entry of vocab) {
    const spoken = entry.spokenForm.trim();
    const target = entry.preferredSpelling.trim();
    if (!spoken || !target) continue;
    const escaped = spoken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, entry.caseSensitive ? 'g' : 'gi');
    result = result.replace(regex, target);
  }
  return result;
}

export function detectSegmentLanguageAndScript(rawText: string): {
  language: TranscriptSegment['language'];
  script: TranscriptSegment['script'];
  hasUncertainOtherScript: boolean;
} {
  const hasDev = DEVANAGARI_RE.test(rawText);
  const hasLat = LATIN_RE.test(rawText);
  const hasOther = NON_LATIN_OTHER_RE.test(rawText);

  if (hasDev && hasLat) {
    return { language: 'hi-en', script: 'mixed', hasUncertainOtherScript: hasOther };
  }
  if (hasDev) {
    return { language: 'hi', script: 'devanagari', hasUncertainOtherScript: hasOther };
  }
  if (hasLat) {
    return { language: 'en', script: 'latin', hasUncertainOtherScript: hasOther };
  }
  return { language: 'other', script: hasOther ? 'other' : 'latin', hasUncertainOtherScript: hasOther };
}

export function processTextToRomanHinglish(
  rawText: string,
  style: RomanizationStyle = 'natural-hinglish',
  customVocabulary: CustomVocabEntry[] = []
): {
  text: string;
  language: TranscriptSegment['language'];
  script: TranscriptSegment['script'];
  uncertain: boolean;
} {
  const meta = detectSegmentLanguageAndScript(rawText);
  const tokens = rawText.split(/(\s+)/);

  const converted = tokens
    .map((tok) => {
      if (/^\s+$/.test(tok) || !tok) return tok;
      if (style === 'preserve-english' && LATIN_RE.test(tok) && !DEVANAGARI_RE.test(tok)) {
        return tok;
      }
      if (DEVANAGARI_RE.test(tok)) {
        return transliterateDevanagariWord(tok, style);
      }
      // Keep non-Latin regional scripts intact rather than deleting them
      return tok;
    })
    .join('');

  // Sentence-case leading letter when transliterated from Devanagari
  const trimmed = converted.replace(/^\s+/, '');
  const normalized =
    meta.script === 'devanagari' && trimmed.length > 0
      ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
      : converted;

  const finalWithVocab = applyCustomVocabulary(normalized, customVocabulary)
    .replace(/\s+([,.!?])/g, '$1')
    .trim();

  return {
    text: finalWithVocab,
    language: meta.language,
    script: meta.script,
    uncertain: meta.hasUncertainOtherScript,
  };
}

export function buildWordTokensForSegment(params: {
  segmentId: string;
  text: string;
  startSec: number;
  endSec: number;
  modelWordChunks?: Array<{ text: string; timestamp: [number, number | null] }>;
  style: RomanizationStyle;
  customVocabulary: CustomVocabEntry[];
}): TranscriptWordToken[] {
  const { segmentId, text, startSec, endSec, modelWordChunks, style, customVocabulary } = params;

  if (modelWordChunks && modelWordChunks.length > 0) {
    const out: TranscriptWordToken[] = [];
    for (let i = 0; i < modelWordChunks.length; i++) {
      const ch = modelWordChunks[i];
      const raw = ch.text.trim();
      if (!raw) continue;
      const converted = processTextToRomanHinglish(raw, style, customVocabulary);
      const wStart = ch.timestamp[0] ?? startSec;
      const wEnd = ch.timestamp[1] ?? Math.min(endSec, wStart + 0.35);
      out.push({
        id: `${segmentId}_w_${i}`,
        word: converted.text,
        rawWord: raw,
        startSec: Number(Math.max(0, wStart).toFixed(3)),
        endSec: Number(Math.max(wStart + 0.05, wEnd).toFixed(3)),
        timingSource: 'model-aligned',
        uncertain: converted.uncertain,
      });
    }
    if (out.length > 0) return out;
  }

  // Fallback acoustic proportional estimation by character weight
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const totalSpan = Math.max(0.25, endSec - startSec);
  const weights = words.map((w) => Math.max(2, w.replace(/[^a-zA-Z0-9\u0900-\u097F]/g, '').length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  let cursor = startSec;
  return words.map((w, idx) => {
    const dur = (weights[idx] / totalWeight) * totalSpan;
    const wStart = cursor;
    const wEnd = idx === words.length - 1 ? endSec : cursor + dur;
    cursor = wEnd;
    return {
      id: `${segmentId}_w_${idx}`,
      word: w,
      startSec: Number(wStart.toFixed(3)),
      endSec: Number(Math.max(wStart + 0.04, wEnd).toFixed(3)),
      timingSource: 'estimated',
      uncertain: NON_LATIN_OTHER_RE.test(w),
    };
  });
}
