// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseOds } from '../src/lib/ods';
import { parseSharedStrings, parseSheetXml, parseXlsx } from '../src/lib/xlsx';

const fixture = (name: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures', name)));
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const sheet = (rows: string) => `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${rows}</sheetData></worksheet>`;

describe('XLSX: LibreOffice konverzija ODS krojnih listi', () => {
  for (const base of ['Kasmir Kronospan 012-010', 'Stone oak Kronospan 012-140']) {
    it(`${base}: isti redovi kao ODS`, () => {
      const xlsx = parseXlsx(fixture(`${base}.xlsx`));
      const ods = parseOds(fixture(`${base}.ods`));
      expect(xlsx.map((s) => s.rows)).toEqual(ods.map((s) => s.rows));
      expect(xlsx[0].rows.length).toBeGreaterThan(10);
    });
  }
});

describe('XLSX: ručni XML', () => {
  it('shared/inline stringovi, rich text, _xHHHH_, brojevi, boolean, formula, greška', () => {
    const shared = parseSharedStrings(
      `<sst xmlns="${NS}"><si><t>Šećer</t></si><si><r><t>pre </t></r><r><rPr/><t>kraj</t></r><rPh><t>X</t></rPh></si><si><t>a_x000D_b</t></si></sst>`,
    );
    expect(shared).toEqual(['Šećer', 'pre kraj', 'a\rb']);
    const rows = parseSheetXml(
      sheet(
        '<row r="1">' +
          '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>inl</t></is></c>' +
          '<c r="D1"><v>2.4500000000000002</v></c><c r="E1" t="n"><v>600</v></c>' +
          '</row>' +
          '<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="str"><f>A1&amp;"x"</f><v>Šećerx</v></c><c r="C2" t="e"><v>#N/A</v></c><c r="D2" t="s"><v>2</v></c></row>',
      ),
      shared,
    );
    expect(rows).toEqual([
      ['Šećer', 'pre kraj', 'inl', '2.45', '600'],
      ['true', 'Šećerx', '#N/A', 'a\rb'],
    ]);
  });

  it('praznine: preskočene kolone i redovi, odsečeni prazni krajevi, ćelije bez r', () => {
    const rows = parseSheetXml(
      sheet(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="D1"><v>1</v></c><c r="F1" s="3"/></row>' +
          '<row r="2"/>' +
          '<row r="4"><c r="B4"><v>5</v></c></row>' +
          '<row><c><v>7</v></c><c><v>8</v></c></row>' +
          '<row r="9"><c r="A9" s="1"/></row>',
      ),
    );
    expect(rows).toEqual([['a', '', '', '1'], [], [], ['', '5'], ['7', '8']]);
  });

  it('više listova preko relacija, strict namespace i relativne putanje', () => {
    const S = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
    const R = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
    const zip = zipSync({
      'xl/workbook.xml': strToU8(
        `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Prvi" sheetId="1" r:id="rB"/><sheet name="Drugi" sheetId="2" r:id="rA"/></sheets></workbook>`,
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rA" Target="worksheets/a.xml"/><Relationship Id="rB" Target="/xl/worksheets/b.xml"/>' +
          '<Relationship Id="rS" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/sharedStrings" Target="./strings.xml"/></Relationships>',
      ),
      'xl/strings.xml': strToU8(`<sst xmlns="${S}"><si><t>deljen</t></si></sst>`),
      'xl/worksheets/a.xml': strToU8(`<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>`),
      'xl/worksheets/b.xml': strToU8(`<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`),
    });
    expect(parseXlsx(zip)).toEqual([
      { name: 'Prvi', rows: [['deljen']] },
      { name: 'Drugi', rows: [['2']] },
    ]);
  });

  it('greške', () => {
    expect(() => parseXlsx(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => parseXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/workbook\.xml/);
  });
});
