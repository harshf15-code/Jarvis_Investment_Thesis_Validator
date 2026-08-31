import { parseNumber } from "@/lib/csv";
import type { ExchangeCode } from "@/lib/types";

/**
 * Pure logic for the CSV holdings import: which column is which, what a row
 * has to look like to be importable, and the row shapes the client, the
 * resolve route and the commit route all agree on.
 *
 * No I/O here on purpose -- the parts that can silently be wrong (guessing a
 * column from a header name, deciding a row is unimportable) are the parts
 * worth testing without a network or a database.
 */

/** A batch is one reviewed upload, not a bulk-loading tool. */
export const MAX_IMPORT_ROWS = 200;

/**
 * Rows per `/api/portfolio/resolve` call. Each row costs up to one Yahoo quote
 * per exchange in the chosen market, so a 200-row book resolved in one request
 * would outlive the function timeout. The client sends chunks and shows
 * progress instead.
 */
export const RESOLVE_CHUNK = 25;

export type ImportColumnKey = "ticker" | "quantity" | "averagePrice" | "date";

/** Column index per logical field, or `null` when nothing matched. */
export type ColumnMapping = Record<ImportColumnKey, number | null>;

export const IMPORT_COLUMN_LABELS: Record<ImportColumnKey, string> = {
  ticker: "Ticker / symbol",
  quantity: "Quantity",
  averagePrice: "Average cost",
  date: "Purchase date (optional)",
};

/**
 * Header synonyms, most specific first -- `average price` must win over `cost`
 * when a file has both.
 *
 * Matching is EXACT against the normalised header, never a substring. A
 * substring rule would map "Previous Closing Price" to average cost, and a
 * mapping that is confidently wrong is worse than one the trader has to set
 * themselves: the preview shows a plausible number either way.
 *
 * Deliberately absent: anything name-shaped ("Stock Name", "Company"). Some
 * exports carry a company name instead of a symbol, and there is no
 * name -> ticker resolver in this app, so such a file must fail the mapping
 * step visibly rather than resolve to nothing row after row.
 */
const SYNONYMS: Record<ImportColumnKey, string[]> = {
  ticker: [
    "tradingsymbol", "instrument", "symbol", "ticker", "scrip", "scripcode",
    "scripname", "stocksymbol", "nsecode", "bsecode", "securityid",
  ],
  quantity: [
    "quantityavailable", "qtyavailable", "quantitylongterm", "quantity",
    "qty", "shares", "units", "holdingquantity", "netqty", "sharesheld",
  ],
  averagePrice: [
    "averagebuyprice", "avgbuyprice", "averageprice", "avgprice", "averagecost",
    "avgcost", "buyaverage", "buyprice", "costbasis", "avg", "cost",
  ],
  date: [
    "purchasedate", "buydate", "tradedate", "dateadded", "entrydate",
    "transactiondate", "date",
  ],
};

/** `Avg. cost` -> `avgcost`, `Qty.` -> `qty`, `P&L` -> `pl`. */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best guess at the mapping for `headers`. A key with no exact synonym match
 * comes back `null` and the trader picks the column themselves; a column
 * already claimed by an earlier key is never claimed twice.
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {
    ticker: null,
    quantity: null,
    averagePrice: null,
    date: null,
  };

  // Order matters: `ticker` and `quantity` claim their columns before
  // `averagePrice` can reach for a loose synonym like `cost`.
  for (const key of ["ticker", "quantity", "averagePrice", "date"] as const) {
    for (const synonym of SYNONYMS[key]) {
      const index = normalized.findIndex((h, i) => h === synonym && !taken.has(i));
      if (index !== -1) {
        mapping[key] = index;
        taken.add(index);
        break;
      }
    }
  }
  return mapping;
}

/**
 * Strips an exchange prefix (`NSE:INFY`) or a Yahoo suffix (`INFY.NS`) and
 * uppercases. Both appear in real exports, and neither is a ticker this app
 * would ever resolve as written.
 */
export function normalizeTicker(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^(?:NSE|BSE|NASDAQ|NYSE|BOM|NS)[:_]/, "")
    .replace(/\.(?:NS|BO)$/, "")
    .trim();
}

/**
 * Reads a date only from formats that cannot be misread: ISO `2026-03-04`, and
 * a named month (`04-Mar-2026`, `4 March 2026`). `03/04/2026` is deliberately
 * REJECTED -- it means March 4th to an American export and April 3rd to an
 * Indian one, and a cost basis silently dated four weeks wrong is worse than
 * one openly dated "as of the import".
 */
export function parseImportDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = value.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{4})$/);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (month === -1) return null;
    const day = Number(named[1]);
    if (day < 1 || day > 31) return null;
    return `${named[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** One CSV row reduced to the four fields this feature cares about. */
export type DraftImportRow = {
  /** Position in the CSV body, 0-based. Shown to the trader as `index + 2`
   *  (header is line 1) so a flagged row is findable in their spreadsheet. */
  index: number;
  ticker: string;
  quantity: number | null;
  averagePrice: number | null;
  date: string | null;
};

export type ImportRowStatus = "resolved" | "unresolved" | "duplicate" | "invalid";

/** A draft row after the server has priced it and checked it for collisions. */
export type ResolvedImportRow = DraftImportRow & {
  status: ImportRowStatus;
  /** Why it is not `resolved`. Always set when status is not `resolved`. */
  reason: string | null;
  companyName: string | null;
  exchange: ExchangeCode | null;
  yahooSymbol: string | null;
  lastPrice: number | null;
};

/**
 * Why this row cannot become a position, or `null` if it can.
 *
 * `entries` carries `check (quantity > 0)` and `check (price > 0)`, so a
 * zero-cost holding (bonus or gifted shares) is refused BY THE SCHEMA. Better
 * to say so in the preview, where the trader can enter a real cost basis, than
 * to surface it as a failed insert after they hit confirm.
 */
export function rowValidationError(row: DraftImportRow): string | null {
  if (row.ticker === "") return "No ticker in this row";
  if (row.quantity === null) return "Quantity is not a number";
  if (row.quantity <= 0) return "Quantity must be greater than zero";
  if (row.averagePrice === null) return "Average cost is not a number";
  if (row.averagePrice <= 0) {
    return "Average cost must be greater than zero — enter a real cost basis for gifted or bonus shares";
  }
  return null;
}

/** Indices of rows whose ticker already appeared earlier in the same batch. */
export function repeatedTickerIndices(tickers: string[]): Set<number> {
  const seen = new Set<string>();
  const repeats = new Set<number>();
  tickers.forEach((ticker, i) => {
    const key = ticker.toUpperCase();
    if (key === "") return;
    if (seen.has(key)) repeats.add(i);
    else seen.add(key);
  });
  return repeats;
}

/**
 * Turns parsed CSV rows plus a mapping into draft rows. Rows with no ticker at
 * all are dropped here rather than carried as errors -- they are almost always
 * a broker's total/footer line, not a holding the trader lost.
 */
export function buildDraftRows(rows: string[][], mapping: ColumnMapping): DraftImportRow[] {
  const at = (row: string[], index: number | null) =>
    index === null ? undefined : row[index];

  return rows
    .map((row, index) => ({
      index,
      ticker: normalizeTicker(at(row, mapping.ticker) ?? ""),
      quantity: parseNumber(at(row, mapping.quantity)),
      averagePrice: parseNumber(at(row, mapping.averagePrice)),
      date: parseImportDate(at(row, mapping.date)),
    }))
    .filter((row) => row.ticker !== "");
}
