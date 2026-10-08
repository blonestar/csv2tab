// Kodiranja: detekcija, dekodiranje, ručni enkoder za windows-1250 i popravka mojibake-a.

export type InputEncoding = 'utf-8' | 'windows-1250' | 'latin-1';
export type OutputEncoding = 'utf-8' | 'utf-8-bom' | 'windows-1250';

// Znakovi za bajtove 0x80..0xFF. � = nedefinisan bajt.
const CP1250 =
  '€\uFFFD‚\uFFFD„…†‡\uFFFD‰Š‹ŚŤŽŹ\uFFFD‘’“”•–—\uFFFD™š›śťžź\u00A0ˇ˘Ł¤Ą¦§¨©Ş«¬\u00AD®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙';
const CP1252 =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ\u00A0¡¢£¤¥¦§¨©ª«¬\u00AD®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ';

function buildReverse(table: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < 128; i++) {
    const ch = table[i];
    if (ch !== '�') m.set(ch, 0x80 + i);
  }
  return m;
}
const CP1250_REV = buildReverse(CP1250);
const CP1252_REV = buildReverse(CP1252);

/** Dekoduje windows-1250. Vraća null ako postoji nedefinisan bajt (strogi režim). */
export function decodeCp1250(bytes: Uint8Array, strict = false): string | null {
  const parts: string[] = [];
  const CHUNK = 32768;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const codes = new Array<number>(end - start);
    for (let i = start; i < end; i++) {
      const b = bytes[i];
      if (b < 0x80) codes[i - start] = b;
      else {
        const ch = CP1250[b - 0x80];
        if (ch === '�' && strict) return null;
        codes[i - start] = ch.charCodeAt(0);
      }
    }
    parts.push(String.fromCharCode.apply(null, codes));
  }
  return parts.join('');
}

export function decodeLatin1(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 32768;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(start, start + CHUNK) as unknown as number[]));
  }
  return parts.join('');
}

export interface Cp1250Result {
  bytes: Uint8Array;
  /** Broj znakova koji ne postoje u windows-1250 (zamenjeni sa '?'). */
  unmappable: number;
}

/** Ručni enkoder za windows-1250 (TextEncoder zna samo UTF-8). */
export function encodeCp1250(text: string): Cp1250Result {
  const out = new Uint8Array(text.length); // svaki UTF-16 code unit -> najviše 1 bajt
  let n = 0;
  let unmappable = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      out[n++] = c;
      continue;
    }
    const b = CP1250_REV.get(text[i]);
    if (b !== undefined) out[n++] = b;
    else {
      out[n++] = 0x3f;
      unmappable++;
      // surrogate par je jedan znak
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) i++;
    }
  }
  return { bytes: out.slice(0, n), unmappable };
}

export function encodeOutput(
  text: string,
  encoding: OutputEncoding,
): { bytes: Uint8Array; unmappable: number } {
  if (encoding === 'windows-1250') return encodeCp1250(text);
  const body = new TextEncoder().encode(text);
  if (encoding === 'utf-8-bom') {
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf], 0);
    out.set(body, 3);
    return { bytes: out, unmappable: 0 };
  }
  return { bytes: body, unmappable: 0 };
}

export interface DecodeResult {
  text: string;
  encoding: InputEncoding;
  hadBom: boolean;
}

function hasBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** Dekodira u zadatom kodiranju (BOM se uvek skida). */
export function decodeAs(bytes: Uint8Array, encoding: InputEncoding): DecodeResult {
  const bom = hasBom(bytes);
  let text: string;
  if (encoding === 'utf-8') {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes); // skida BOM
  } else {
    text = encoding === 'windows-1250' ? (decodeCp1250(bytes) as string) : decodeLatin1(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  return { text, encoding, hadBom: bom };
}

/** Auto-detekcija: UTF-8 (strogo) -> windows-1250 (strogo) -> latin-1. */
export function detectEncoding(bytes: Uint8Array): InputEncoding {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    /* nije UTF-8 */
  }
  return decodeCp1250(bytes, true) !== null ? 'windows-1250' : 'latin-1';
}

export function decodeAuto(bytes: Uint8Array): DecodeResult {
  return decodeAs(bytes, detectEncoding(bytes));
}

// ---------- mojibake ----------

// Prvi znak tipičnog UTF-8 vođe (Ã, Ä, Å) pročitanog kao jednobajtno kodiranje.
const MOJIBAKE_HINT = /[ÃÄÅ][\u0080-¿Ā-žˇ˘˛˝‘-›]/;

export function looksLikeMojibake(s: string): boolean {
  return MOJIBAKE_HINT.test(s);
}

function tryReencode(s: string, rev: Map<string, number> | null): string | null {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes[i] = c;
    else if (rev === null) {
      if (c > 0xff) return null;
      bytes[i] = c;
    } else {
      const b = rev.get(s[i]);
      if (b === undefined) return null;
      bytes[i] = b;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Popravlja tekst koji je UTF-8 pročitan kao windows-1250 / windows-1252 / latin-1.
 * Vraća isti string ako nije mojibake ili popravka nije moguća.
 */
export function fixMojibake(s: string): string {
  if (!looksLikeMojibake(s)) return s;
  for (const rev of [CP1250_REV, CP1252_REV, null]) {
    const fixed = tryReencode(s, rev);
    if (fixed !== null && fixed !== s && !fixed.includes('�')) return fixed;
  }
  return s;
}
