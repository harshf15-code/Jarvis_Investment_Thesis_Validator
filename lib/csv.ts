/**
 * A small RFC 4180 CSV reader, for broker holdings exports.
 *
 * Hand-rolled rather than a dependency, because the alternative is ~45KB of
 * papaparse in a CLIENT bundle to do what a state machine does in sixty lines
 * -- the file is parsed in the browser so a broker export's account numbers,
 * ISINs and P&L columns never leave the trader's machine. Hand-rolling is only
 * dangerous when it isn't tested; the cases that actually bite (a company name
 * containing a comma, a doubled quote, CRLF, a BOM, a ragged row) each have a
 * test in `lib/__tests__/csv.test.ts`.
 */

export type ParsedCsv = {
  /** The first non-empty record. Empty when the file had no content. */
  headers: string[];
  /** Every record after the header. Ragged rows are preserved, not padded --
   *  the caller reports "this row is missing the price column", which is more
   *  useful than an invented empty string. */
  rows: string[][];
};

/**
 * Splits `text` into records and fields.
 *
 * Handles: quoted fields containing commas and newlines, `""` as an escaped
 * quote inside a quoted field, LF / CRLF / lone-CR line endings, and a UTF-8
 * BOM. Does NOT handle European decimal notation (`1.234,56`) -- see
 * `parseNumber`.
 */
export function parseCsv(text: string): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  // Distinguishes `""` (an empty quoted field) from an untouched field, so a
  // quoted empty string still produces a field rather than being dropped.
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      // Both CRLF and a lone CR end the record; the LF is consumed with it.
      if (src[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }

  // A file that does not end in a newline still has one last record. A file
  // that does ends with an empty field we must not turn into a phantom row.
  if (field !== "" || fieldStarted || record.length > 0) endRecord();

  const meaningful = records.filter((r) => r.some((f) => f.trim() !== ""));
  const [headers = [], ...rows] = meaningful;
  return { headers: headers.map((h) => h.trim()), rows };
}

/**
 * Reads a number out of a spreadsheet cell.
 *
 * Strips currency symbols, thousands separators (both `1,234,567` and India's
 * `12,34,567`) and surrounding whitespace. Returns `null` rather than `NaN`
 * for anything that isn't a number, so a caller cannot accidentally propagate
 * one into arithmetic.
 */
export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/[^0-9.eE+-]/g, "");
  if (cleaned === "" || !/[0-9]/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
