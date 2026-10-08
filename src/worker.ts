// Web Worker: dekodiranje, detekcija i parsiranje CSV-a van glavne niti.
import { detectDelimiter, parseCsv } from './lib/csv';
import { decodeAs, detectEncoding, type InputEncoding } from './lib/encoding';
import { analyze, type Stats } from './lib/analyze';

export interface WorkerRequest {
  reqId: number;
  buffer: ArrayBuffer;
  encoding: 'auto' | InputEncoding;
  delimiter: 'auto' | string;
}

export type WorkerResponse =
  | {
      reqId: number;
      ok: true;
      rows: string[][];
      encoding: InputEncoding;
      delimiter: string;
      hadBom: boolean;
      stats: Stats;
    }
  | { reqId: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { reqId, buffer, encoding, delimiter } = e.data;
  try {
    const bytes = new Uint8Array(buffer);
    const enc = encoding === 'auto' ? detectEncoding(bytes) : encoding;
    const dec = decodeAs(bytes, enc);
    const delim = delimiter === 'auto' ? detectDelimiter(dec.text) : delimiter;
    const rows = parseCsv(dec.text, delim);
    const stats = analyze(rows);
    const msg: WorkerResponse = { reqId, ok: true, rows, encoding: enc, delimiter: delim, hadBom: dec.hadBom, stats };
    (self as unknown as Worker).postMessage(msg);
  } catch (err) {
    const msg: WorkerResponse = { reqId, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
