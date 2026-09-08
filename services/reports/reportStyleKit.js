"use strict";

// Shared branding + layout helpers for the 7 downloadable system reports.
// The Excel half is extracted from the proven pattern already used in
// loan_dashboard_service.js / auction_report_service.js / investor_statement_service.js
// (not modified there — this is a new, parallel copy for new report code only).

const BRAND = "10B981"; // emerald
const DARK = "0F172A";
const HEADER = "064E3B"; // dark emerald
const SUB_HDR = "D1FAE5"; // light emerald
const ALT_ROW = "F0FDF4";
const WHITE = "FFFFFF";
const BORDER_COLOR = "CBD5E1";
const WARN = "FEF3C7"; // amber light
const DANGER = "FEE2E2"; // red light

const COLORS = { BRAND, DARK, HEADER, SUB_HDR, ALT_ROW, WHITE, BORDER_COLOR, WARN, DANGER };

// ── Excel ─────────────────────────────────────────────────────────────────

const thin = { style: "thin", color: { argb: `FF${BORDER_COLOR}` } };
const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

const hdrFont = { bold: true, size: 11, color: { argb: `FF${WHITE}` }, name: "Calibri" };
const bodyFont = { size: 10, name: "Calibri" };
const boldFont = { bold: true, size: 10, name: "Calibri" };

const centerAlign = { horizontal: "center", vertical: "middle" };
const leftAlign = { horizontal: "left", vertical: "middle" };
const rightAlign = { horizontal: "right", vertical: "middle" };

const NUMFMT = {
  USD: '"$"#,##0.00',
  PCT: '0.00"%"',
  NUM: "#,##0",
  DT: "yyyy-mm-dd",
};

function fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

function applyHdrStyle(row, bgArgb = `FF${HEADER}`) {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = hdrFont;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
    cell.border = cellBorder;
    cell.alignment = centerAlign;
  });
}

function applyAltRow(row, idx) {
  const bg = idx % 2 === 0 ? `FF${WHITE}` : `FF${ALT_ROW}`;
  row.height = 18;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = bodyFont;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.border = cellBorder;
    if (cell.alignment?.horizontal !== "right") cell.alignment = leftAlign;
  });
}

const STATUS_FILL_MAP = {
  active: "D1FAE5",
  overdue: "FEE2E2",
  defaulted: "FEE2E2",
  redeemed: "CCFBF1",
  cancelled: "FEF3C7",
  written_off: "F1F5F9",
  submitted: "DBEAFE",
  processing: "EDE9FE",
  approved: "BAE6FD",
  rejected: "FEE2E2",
  draft: "F1F5F9",
  in_grace: "DBEAFE",
  partially_paid: "CFFAFE",
  auction: "FDE68A",
  current: "D1FAE5",
};

function statusFill(status) {
  const key = String(status || "").toLowerCase().replace(/[\s-]+/g, "_");
  return STATUS_FILL_MAP[key] ? `FF${STATUS_FILL_MAP[key]}` : `FF${WHITE}`;
}

// Sheet-1-style title banner: row 1 = dark title, row 2 = emerald subtitle (period + generated-at).
function addTitleBanner(sheet, { title, start, end, generatedAt, cols = 6 }) {
  const lastCol = String.fromCharCode(64 + cols); // 6 -> 'F'
  sheet.mergeCells(`A1:${lastCol}1`);
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16, color: { argb: `FF${WHITE}` }, name: "Calibri" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK}` } };
  titleCell.alignment = centerAlign;
  sheet.getRow(1).height = 36;

  sheet.mergeCells(`A2:${lastCol}2`);
  const subCell = sheet.getCell("A2");
  subCell.value = `Report Period: ${fmtDate(start)} to ${fmtDate(end)}   |   Generated: ${fmtDate(generatedAt || new Date())}`;
  subCell.font = { size: 10, color: { argb: `FF${WHITE}` }, name: "Calibri" };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER}` } };
  subCell.alignment = centerAlign;
  sheet.getRow(2).height = 20;
  sheet.addRow([]);
}

// Generic "Breakdowns" style section: a bold section header row, a column-header row,
// then data rows — used to stack several small labeled tables vertically on one sheet.
function addBreakdownSection(sheet, title, colHeaders, rows, { numFmts = [] } = {}) {
  const titleRow = sheet.addRow([title]);
  sheet.mergeCells(`A${titleRow.number}:${String.fromCharCode(64 + colHeaders.length)}${titleRow.number}`);
  applyHdrStyle(titleRow);

  const hdrRow = sheet.addRow(colHeaders);
  applyHdrStyle(hdrRow, `FF${SUB_HDR}`);
  hdrRow.eachCell((c) => {
    c.font = { bold: true, size: 10, name: "Calibri", color: { argb: `FF${DARK}` } };
  });

  rows.forEach((rowValues, idx) => {
    const r = sheet.addRow(rowValues);
    applyAltRow(r, idx);
    numFmts.forEach((fmt, colIdx) => {
      if (fmt) r.getCell(colIdx + 1).numFmt = fmt;
    });
  });

  sheet.addRow([]);
}

const excelKit = {
  ExcelJS: require("exceljs"),
  COLORS,
  cellBorder,
  hdrFont,
  bodyFont,
  boldFont,
  centerAlign,
  leftAlign,
  rightAlign,
  NUMFMT,
  fmtDate,
  applyHdrStyle,
  applyAltRow,
  statusFill,
  addTitleBanner,
  addBreakdownSection,
};

// ── PDF (pdfkit) ──────────────────────────────────────────────────────────
// pdfkit lays out documents imperatively (draw at x/y) — there's no CSS flow, so these
// helpers exist purely to keep that bookkeeping (column offsets, pagination, repeated
// headers) in one place instead of every report re-deriving it.

const PDF_MARGIN = 40;
const PDF_PAGE_SIZE = "A4"; // 595.28 x 841.89 pt

function hex(c) {
  return `#${c}`;
}

function newPdfDoc(PDFDocument) {
  return new PDFDocument({ size: PDF_PAGE_SIZE, margin: PDF_MARGIN, bufferPages: true });
}

// Dark title band + emerald subtitle band, mirroring the Excel sheet-1 banner.
function drawTitleBanner(doc, { title, start, end, generatedAt }) {
  const width = doc.page.width - PDF_MARGIN * 2;
  let y = PDF_MARGIN;

  doc.rect(PDF_MARGIN, y, width, 34).fill(hex(DARK));
  doc
    .fillColor(hex(WHITE))
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(title, PDF_MARGIN + 12, y + 9, { width: width - 24 });
  y += 34;

  doc.rect(PDF_MARGIN, y, width, 20).fill(hex(HEADER));
  doc
    .fillColor(hex(WHITE))
    .font("Helvetica")
    .fontSize(9)
    .text(
      `Report Period: ${fmtDate(start)} to ${fmtDate(end)}   |   Generated: ${fmtDate(generatedAt || new Date())}`,
      PDF_MARGIN + 12,
      y + 6,
      { width: width - 24 },
    );
  y += 20 + 14;

  doc.fillColor(hex(DARK));
  return y;
}

// A responsive grid of {label, value} KPI tiles, 3 per row.
function drawKpiGrid(doc, kpiPairs, startY) {
  const width = doc.page.width - PDF_MARGIN * 2;
  const perRow = 3;
  const gap = 10;
  const tileW = (width - gap * (perRow - 1)) / perRow;
  const tileH = 46;
  let y = startY;

  kpiPairs.forEach((kpi, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) y += tileH + gap;
    const x = PDF_MARGIN + col * (tileW + gap);

    doc.rect(x, y, tileW, tileH).fillAndStroke(hex(ALT_ROW), hex(BORDER_COLOR));
    doc
      .fillColor(hex("475569"))
      .font("Helvetica")
      .fontSize(8)
      .text(kpi.label.toUpperCase(), x + 8, y + 7, { width: tileW - 16 });
    doc
      .fillColor(hex(HEADER))
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(kpi.value, x + 8, y + 21, { width: tileW - 16 });
  });

  return y + tileH + 20;
}

// Truncates text with an ellipsis so it always fits on ONE line within maxWidth — table
// rows are drawn at a fixed height, so any wrapped second line would silently overlap
// the row below it (pdfkit has no built-in single-line-with-ellipsis text mode).
function truncateToWidth(doc, text, maxWidth) {
  if (text == null) return "";
  let str = String(text);
  if (doc.widthOfString(str) <= maxWidth) return str;
  const ellipsis = "…";
  while (str.length > 0 && doc.widthOfString(str + ellipsis) > maxWidth) {
    str = str.slice(0, -1);
  }
  return str + ellipsis;
}

function checkPageBreak(doc, y, neededHeight, onNewPage) {
  const bottom = doc.page.height - PDF_MARGIN;
  if (y + neededHeight <= bottom) return y;
  doc.addPage();
  let newY = PDF_MARGIN;
  if (onNewPage) newY = onNewPage(doc, newY);
  return newY;
}

// columns: [{ header, key, width, align }]. Draws the dark-emerald header row and
// returns the y position for the first data row.
function drawTableHeader(doc, columns, y) {
  const rowH = 20;
  let x = PDF_MARGIN;
  doc.rect(PDF_MARGIN, y, columns.reduce((s, c) => s + c.width, 0), rowH).fill(hex(HEADER));
  doc.font("Helvetica-Bold").fontSize(8).fillColor(hex(WHITE));
  columns.forEach((col) => {
    // Extra safety margin beyond the padding alone — truncateToWidth measures with
    // doc.widthOfString(), and leaving headroom avoids any renderer whose glyph
    // metrics land a hair wider, which could otherwise wrap a "single line" of text.
    const usable = col.width - 12;
    const text = truncateToWidth(doc, col.header, usable);
    doc.text(text, x + 4, y + 6, { width: usable, align: col.align || "left", lineBreak: false });
    x += col.width;
  });
  return y + rowH;
}

function drawTableRow(doc, columns, values, y, altIndex) {
  const rowH = 16;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const bg = altIndex % 2 === 0 ? WHITE : ALT_ROW;
  doc.rect(PDF_MARGIN, y, totalW, rowH).fillAndStroke(hex(bg), hex(BORDER_COLOR));

  let x = PDF_MARGIN;
  doc.font("Helvetica").fontSize(8).fillColor(hex("1E293B"));
  columns.forEach((col) => {
    const v = values[col.key];
    // Always single-line: a wrapped second line would silently overlap the row below,
    // since rows are drawn at a fixed height (see truncateToWidth). The extra margin
    // (beyond the 8pt padding) guards against any renderer measuring glyphs a hair
    // wider than doc.widthOfString() did.
    const usable = col.width - 12;
    const text = truncateToWidth(doc, v == null ? "" : String(v), usable);
    doc.text(text, x + 4, y + 4, { width: usable, align: col.align || "left", lineBreak: false });
    x += col.width;
  });
  return y + rowH;
}

function fmtCurrency(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `-$${abs}` : `$${abs}`;
}

function drawFooter(doc, pageNum, pageCount) {
  const width = doc.page.width - PDF_MARGIN * 2;
  const y = doc.page.height - PDF_MARGIN + 8;

  // pdfkit auto-inserts a new page if text at this y (inside the bottom margin, by
  // design for a footer) would "overflow" the margin box — a well-known gotcha.
  // Zeroing the bottom margin just for this draw call disables that heuristic.
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(hex("94A3B8"))
    .text("Real Time Capital — Confidential", PDF_MARGIN, y, { width: width / 2, align: "left", lineBreak: false })
    .text(`Page ${pageNum} of ${pageCount}`, PDF_MARGIN + width / 2, y, { width: width / 2, align: "right", lineBreak: false });

  doc.page.margins.bottom = originalBottomMargin;
}

// Stamps a footer with correct page numbers on every buffered page — must be called
// right before doc.end() (requires the doc to have been created with bufferPages:true).
function finalizeWithFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i - range.start + 1, range.count);
  }
}

const pdfKit = {
  PDF_MARGIN,
  PDF_PAGE_SIZE,
  newPdfDoc,
  drawTitleBanner,
  drawKpiGrid,
  drawTableHeader,
  drawTableRow,
  checkPageBreak,
  finalizeWithFooters,
  fmtCurrency,
  fmtDate,
};

module.exports = { COLORS, excelKit, pdfKit };
