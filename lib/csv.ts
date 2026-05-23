'use client';

/**
 * Trigger a browser download of CSV text.
 *
 * Uses a Blob URL + temporary <a download> approach which works on
 * desktop browsers and on iOS Safari (which downloads into Files).
 * On Android the file lands in the Downloads folder.
 *
 * The CSV is prepended with a UTF-8 BOM so Excel opens it with the
 * right encoding when double-clicked (otherwise £ and similar
 * characters mojibake).
 */
export function downloadCsv(filename: string, csvBody: string): void {
  // Prepend UTF-8 BOM so Excel opens it as UTF-8 rather than Windows-1252
  const blob = new Blob(['\ufeff' + csvBody], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Some browsers need the anchor in the DOM for the download to fire
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob after the click event has had time to dispatch
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Escape one cell value for CSV. Wraps in quotes if it contains a
 * comma, quote, newline, or leading/trailing whitespace; doubles
 * inner quotes.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s === '') return '';
  const needsQuoting = /[",\n\r]|^\s|\s$/.test(s);
  if (!needsQuoting) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Build a CSV row from an array of cell values. */
export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvCell).join(',');
}

/**
 * Suggested filename for a CSV download, with today's date appended.
 * E.g. csvFilename('spreading') → 'spreading-2026-05-23.csv'
 */
export function csvFilename(prefix: string, isoDate: string = new Date().toISOString().slice(0, 10)): string {
  // Sanitise the prefix — keep alphanumerics, dashes, underscores.
  const safe = prefix.replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${safe}-${isoDate}.csv`;
}
