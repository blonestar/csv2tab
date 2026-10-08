import { describe, expect, it } from 'vitest';
import {
  decodeAs,
  decodeAuto,
  decodeCp1250,
  detectEncoding,
  encodeCp1250,
  encodeOutput,
  fixMojibake,
} from '../src/lib/encoding';

const LETTERS = 'čćđšžČĆĐŠŽ';
const CP1250_BYTES = [0xe8, 0xe6, 0xf0, 0x9a, 0x9e, 0xc8, 0xc6, 0xd0, 0x8a, 0x8e];

describe('cp1250', () => {
  it('enkoder daje ispravne bajtove', () => {
    expect([...encodeCp1250(LETTERS).bytes]).toEqual(CP1250_BYTES);
  });
  it('dekoder', () => {
    expect(decodeCp1250(new Uint8Array(CP1250_BYTES))).toBe(LETTERS);
  });
  it('slaže se sa TextDecoder("windows-1250") za sve bajtove', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const ref = new TextDecoder('windows-1250').decode(all);
    const mine = decodeCp1250(all)!;
    for (let i = 0; i < 256; i++) {
      if ([0x81, 0x83, 0x88, 0x90, 0x98].includes(i)) continue;
      expect(mine[i]).toBe(ref[i]);
    }
  });
  it('round-trip svih mapiranih znakova', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const text = decodeCp1250(all)!.replace(/�/g, '');
    const { bytes, unmappable } = encodeCp1250(text);
    expect(unmappable).toBe(0);
    expect(decodeCp1250(bytes)).toBe(text);
  });
  it('nemapirani znakovi -> ?', () => {
    const r = encodeCp1250('a→b😀');
    expect(new TextDecoder().decode(r.bytes)).toBe('a?b?');
    expect(r.unmappable).toBe(2);
  });
  it('strogi režim odbija nedefinisan bajt', () => {
    expect(decodeCp1250(new Uint8Array([0x81]), true)).toBeNull();
  });
});

describe('detekcija', () => {
  it('UTF-8', () => {
    const b = new TextEncoder().encode(LETTERS);
    expect(detectEncoding(b)).toBe('utf-8');
    expect(decodeAuto(b).text).toBe(LETTERS);
  });
  it('UTF-8 sa BOM-om se skida', () => {
    const b = encodeOutput('a' + LETTERS, 'utf-8-bom').bytes;
    const r = decodeAuto(b);
    expect(r.text).toBe('a' + LETTERS);
    expect(r.hadBom).toBe(true);
  });
  it('windows-1250', () => {
    const b = new Uint8Array(CP1250_BYTES);
    expect(detectEncoding(b)).toBe('windows-1250');
    expect(decodeAuto(b).text).toBe(LETTERS);
  });
  it('latin-1 fallback kad cp1250 ne može', () => {
    const b = new Uint8Array([0x61, 0x81, 0x62]);
    expect(detectEncoding(b)).toBe('latin-1');
    expect(decodeAs(b, 'latin-1').text).toBe('a\u0081b');
  });
  it('ručno kodiranje', () => {
    expect(decodeAs(new Uint8Array(CP1250_BYTES), 'windows-1250').text).toBe(LETTERS);
  });
});

describe('izlaz', () => {
  it('utf-8 i BOM', () => {
    expect([...encodeOutput('a', 'utf-8').bytes]).toEqual([0x61]);
    expect([...encodeOutput('a', 'utf-8-bom').bytes]).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });
});

describe('mojibake', () => {
  const utf8 = new TextEncoder().encode('Čuvar šuma, ćevapi, đak, žaba. Ćirilica');
  it('UTF-8 pročitan kao cp1250', () => {
    const broken = decodeCp1250(utf8)!;
    expect(broken).not.toBe('Čuvar šuma, ćevapi, đak, žaba. Ćirilica');
    expect(fixMojibake(broken)).toBe('Čuvar šuma, ćevapi, đak, žaba. Ćirilica');
  });
  it('UTF-8 pročitan kao latin-1', () => {
    let s = '';
    for (const b of new TextEncoder().encode('šđčćž')) s += String.fromCharCode(b);
    expect(fixMojibake(s)).toBe('šđčćž');
  });
  it('ispravan tekst se ne dira', () => {
    expect(fixMojibake('Ćevapi i šljivovica')).toBe('Ćevapi i šljivovica');
    expect(fixMojibake('Äpfel')).toBe('Äpfel');
  });
});
