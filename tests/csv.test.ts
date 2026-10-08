import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from '../src/lib/csv';
import { toTsv } from '../src/lib/tsv';

describe('parseCsv', () => {
  it('osnovni zarez', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('tačka-zarez', () => {
    expect(parseCsv('a;b\n1,5;2', ';')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
  it('navodnici i "" escape', () => {
    expect(parseCsv('"a,b","he said ""hi""",c')).toEqual([['a,b', 'he said "hi"', 'c']]);
  });
  it('novi red unutar navodnika', () => {
    expect(parseCsv('x,"l1\nl2",y\r\n1,2,3\r\n')).toEqual([['x', 'l1\nl2', 'y'], ['1', '2', '3']]);
  });
  it('CRLF, bez završnog novog reda, prazna polja', () => {
    expect(parseCsv('a,,c\r\n,,')).toEqual([['a', '', 'c'], ['', '', '']]);
  });
  it('završni separator', () => {
    expect(parseCsv('a,')).toEqual([['a', '']]);
  });
  it('prazan ulaz i prazan red', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });
  it('nezatvoren navodnik ne puca', () => {
    expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']]);
  });
  it('tab separator', () => {
    expect(parseCsv('a\tb\n1\t"2\t3"', '\t')).toEqual([['a', 'b'], ['1', '2\t3']]);
  });
  it('maxRows', () => {
    expect(parseCsv('1\n2\n3\n4', ',', 2)).toEqual([['1'], ['2']]);
  });
});

describe('detectDelimiter', () => {
  it('tačka-zarez sa decimalnim zarezom', () => {
    expect(detectDelimiter('naziv;cena\nA;1,5\nB;2,75\nC;3,10\n')).toBe(';');
  });
  it('zarez', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
  });
  it('tab', () => {
    expect(detectDelimiter('a\tb\n1,5\t2\n3,5\t4')).toBe('\t');
  });
  it('pipe', () => {
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
  });
  it('bez separatora -> zarez', () => {
    expect(detectDelimiter('jedna kolona\nopet')).toBe(',');
  });
});

describe('toTsv', () => {
  it('zamenjuje tab i novi red razmakom', () => {
    expect(toTsv([['a\tb', 'c\nd'], ['1', '2']])).toBe('a b\tc d\n1\t2\n');
  });
  it('CRLF', () => {
    expect(toTsv([['a', 'b']], { lineEnding: 'crlf', quoteSpecial: false })).toBe('a\tb\r\n');
  });
  it('quote režim', () => {
    expect(toTsv([['a\tb', 'x"y']], { lineEnding: 'lf', quoteSpecial: true })).toBe('"a\tb"\t"x""y"\n');
  });
});
