// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { padRows, parseOds, parseOdsXml } from '../src/lib/ods';

const HEAD =
  '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>';
const TAIL = '</office:spreadsheet></office:body></office:document-content>';
const str = (t: string) => `<table:table-cell office:value-type="string"><text:p>${t}</text:p></table:table-cell>`;

describe('ODS: pravi LibreOffice fajl', () => {
  const sheets = parseOds(new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures/sample.ods'))));
  it('više listova sa imenima', () => {
    expect(sheets.map((s) => s.name)).toEqual(['Cene', 'Beleške']);
  });
  it('float je sirov broj, ponovljeni redovi, odsečeni prazni krajevi', () => {
    expect(sheets[0].rows).toEqual([
      ['Naziv', 'Cena', 'Datum'],
      ['Šećer', '12.5', '45356'], // fixture: LO je datum sačuvao kao float (datumi su pokriveni u ručnom XML testu)
      ['Čaj', '3'],
      ['Čaj', '3'],
    ]);
  });
  it('više paragrafa, text:s, text:tab, repeated kolone (LibreOffice boolean čuva kao broj)', () => {
    expect(sheets[1].rows).toEqual([
      ['red1\nred2', '1', '1'],
      ['', 'a   b\tc'],
    ]);
  });
});

describe('ODS: ručni XML', () => {
  it('number-columns-repeated / number-rows-repeated i veliki trailing repeat', () => {
    const xml =
      HEAD +
      '<table:table table:name="T">' +
      `<table:table-row>${str('a')}<table:table-cell table:number-columns-repeated="2"/>${str('b')}<table:table-cell table:number-columns-repeated="1048576"/></table:table-row>` +
      `<table:table-row table:number-rows-repeated="3"><table:table-cell office:value-type="float" office:value="1.5" table:number-columns-repeated="2"><text:p>1,5</text:p></table:table-cell></table:table-row>` +
      '<table:table-row table:number-rows-repeated="2"><table:table-cell/></table:table-row>' +
      `<table:table-row>${str('z')}</table:table-row>` +
      '<table:table-row table:number-rows-repeated="1048576"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>' +
      '</table:table>' +
      TAIL;
    const [t] = parseOdsXml(xml);
    expect(t.rows).toEqual([
      ['a', '', '', 'b'],
      ['1.5', '1.5'],
      ['1.5', '1.5'],
      ['1.5', '1.5'],
      [],
      [],
      ['z'],
    ]);
    expect(padRows(t.rows)[6]).toEqual(['z', '', '', '']);
  });

  it('percentage, currency, time, boolean, grupe redova, komentari, covered ćelije', () => {
    const xml =
      HEAD +
      '<table:table table:name="X"><table:table-row-group>' +
      '<table:table-row>' +
      '<table:table-cell office:value-type="percentage" office:value="0.25"><text:p>25%</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="currency" office:value="9.99"><text:p>9,99 RSD</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="time" office:time-value="PT01H30M00S"><text:p>1:30</text:p></table:table-cell>' +
      '<table:table-cell office:value-type="boolean" office:boolean-value="false"><text:p>FALSE</text:p></table:table-cell>' +
      '<table:covered-table-cell/>' +
      '<table:table-cell office:value-type="string"><office:annotation><text:p>KOMENTAR</text:p></office:annotation><text:p>pre <text:span>sred</text:span><text:line-break/>kraj</text:p></table:table-cell>' +
      '</table:table-row></table:table-row-group></table:table>' +
      TAIL;
    expect(parseOdsXml(xml)[0].rows).toEqual([
      ['0.25', '9.99', 'PT01H30M00S', 'false', '', 'pre sred\nkraj'],
    ]);
  });

  it('zip arhiva sa content.xml', () => {
    const xml = HEAD + `<table:table table:name="A"><table:table-row>${str('x')}</table:table-row></table:table>` + TAIL;
    const zip = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'), 'content.xml': strToU8(xml) });
    expect(parseOds(zip)).toEqual([{ name: 'A', rows: [['x']] }]);
  });

  it('greške', () => {
    expect(() => parseOds(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => parseOds(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/content\.xml/);
  });
});

describe('ODS: datum', () => {
  it('date-value', () => {
    const xml =
      HEAD +
      '<table:table table:name="D"><table:table-row><table:table-cell office:value-type="date" office:date-value="2024-03-05"><text:p>05.03.2024</text:p></table:table-cell></table:table-row></table:table>' +
      TAIL;
    expect(parseOdsXml(xml)[0].rows).toEqual([['2024-03-05']]);
  });
});
