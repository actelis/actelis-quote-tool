/* pdf.js
 * Generates a PDF quotation that matches the layout of the original Access
 * "QuoteReport Letter" report (logo + address block, a 3-column quote-meta
 * header, a per-site BOM table, a Services/Warranty table, and totals), using
 * the vendored pdf-lib (js/vendor/pdf-lib.min.js — no network call, no CDN).
 *
 * Round-trip import: the full in-memory quote state (see Quote.serialize())
 * is embedded as base64 JSON in the PDF's Subject metadata field, prefixed
 * with a recognizable marker. Importing a PDF that was exported by this tool
 * reads that field back out and calls Quote.loadFromState(...) — nothing is
 * parsed from the visible page content, so formatting changes to the layout
 * below never break round-trip import.
 *
 * Foreign-PDF import: a PDF that has no such metadata (most notably a real,
 * historical quote printed by the original Access desktop tool's own
 * "QuoteReport" report — same visual layout, just no embedded JSON) is
 * parsed from its VISIBLE TEXT instead, using the vendored pdfjs-dist
 * (js/vendor/pdfjs.min.js, global `pdfjsLib`) to read each page's text items
 * with position data. See parseForeignPdf() below for the approach.
 *
 * Nothing here uploads or stores anything — the PDF is generated and parsed
 * entirely in the browser.
 */
const PdfExport = (() => {
  const META_PREFIX = 'ACTELIS_QUOTE_DATA_V1:';
  const PAGE_W = 612, PAGE_H = 792; // US Letter, points — used by our own generator
  const MARGIN = 40;

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdfjs.worker.min.js';
  }

  function money(n) {
    return '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
  }

  function b64EncodeUnicode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function b64DecodeUnicode(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function fetchBytes(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Could not load ${path}`);
    return res.arrayBuffer();
  }

  // Splits `text` into lines that each fit within `maxWidth` for the given
  // font/size (simple greedy word-wrap).
  function wrapText(text, font, size, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(w => {
      const trial = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = trial;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  async function generate() {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const data = Export.buildQuoteData();
    const meta = (typeof DataStore !== 'undefined' && DataStore.meta) || {};
    const state = Quote.serialize();

    const doc = await PDFDocument.create();
    doc.setTitle(`Actelis Quotation ${data.header.quotationNumber || ''}`.trim());
    doc.setProducer('Actelis Price & Quote Tool (online edition)');
    doc.setCreator('Actelis Price & Quote Tool (online edition)');
    doc.setSubject(META_PREFIX + b64EncodeUnicode(JSON.stringify(state)));

    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const helvOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

    let logoImage = null, logoDims = null;
    try {
      const logoBytes = await fetchBytes('assets/actelis-logo.png');
      logoImage = await doc.embedPng(logoBytes);
      logoDims = logoImage.scale(26 / logoImage.height);
    } catch (e) { /* logo optional — PDF still generates without it */ }

    const navy = rgb(0.063, 0.122, 0.235);
    const accent = rgb(0.933, 0.490, 0.122);
    const grey = rgb(0.35, 0.41, 0.46);
    const lightGrey = rgb(0.85, 0.88, 0.91);
    const black = rgb(0.12, 0.15, 0.19);

    const pages = [];
    let page, y;

    function drawFooterLater() { /* filled in after layout, see below */ }

    function addPage() {
      page = doc.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      y = PAGE_H - MARGIN;
      return page;
    }

    function ensureSpace(h) {
      if (y - h < MARGIN + 30) addPage();
    }

    function text(str, x, yy, opts = {}) {
      page.drawText(String(str == null ? '' : str), {
        x, y: yy, size: opts.size || 9, font: opts.font || helv,
        color: opts.color || black,
      });
    }
    function line(x1, yy1, x2, yy2, opts = {}) {
      page.drawLine({ start: { x: x1, y: yy1 }, end: { x: x2, y: yy2 }, thickness: opts.thickness || 0.75, color: opts.color || lightGrey });
    }
    function rightText(str, xRight, yy, opts = {}) {
      const f = opts.font || helv, size = opts.size || 9;
      const w = f.widthOfTextAtSize(String(str == null ? '' : str), size);
      text(str, xRight - w, yy, opts);
    }

    // ---- Page 1: logo + address block + 3-column quote meta ----
    addPage();
    if (logoImage) {
      page.drawImage(logoImage, { x: MARGIN, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });
    } else {
      text('ACTELIS', MARGIN, y - 16, { font: helvBold, size: 16, color: navy });
    }
    rightText('Actelis', PAGE_W - MARGIN, y - 8, { font: helvBold, size: 10, color: navy });
    rightText('4039 Clipper Court', PAGE_W - MARGIN, y - 20, { size: 8.5, color: grey });
    rightText('Fremont, CA 94538', PAGE_W - MARGIN, y - 31, { size: 8.5, color: grey });
    rightText('P: 510-545-1045', PAGE_W - MARGIN, y - 42, { size: 8.5, color: grey });
    rightText('F: 510-545-1075', PAGE_W - MARGIN, y - 53, { size: 8.5, color: grey });
    y -= 62;
    text('QUOTATION', MARGIN, y, { font: helvBold, size: 15, color: navy });
    y -= 8;
    line(MARGIN, y, PAGE_W - MARGIN, y, { thickness: 1.5, color: accent });
    y -= 20;

    const colW = (PAGE_W - MARGIN * 2) / 3;
    const col1 = MARGIN, col2 = MARGIN + colW, col3 = MARGIN + colW * 2;
    const metaTop = y;
    function metaField(x, yy, label, value) {
      text(label, x, yy, { font: helvBold, size: 7.5, color: grey });
      text(value || '—', x, yy - 11, { size: 9.5, color: black });
    }
    metaField(col1, metaTop, 'QUOTATION #', data.header.quotationNumber);
    metaField(col1, metaTop - 28, 'CUSTOMER NAME', data.header.customer);
    metaField(col1, metaTop - 56, 'STATUS', data.header.status);

    metaField(col2, metaTop, 'CUSTOMER CONTACT', data.header.customerContact);
    metaField(col2, metaTop - 28, 'ADDRESS', data.header.address);
    metaField(col2, metaTop - 56, 'PHONE / FAX', data.header.phone);
    metaField(col2, metaTop - 84, 'EMAIL', data.header.email);

    metaField(col3, metaTop, 'DATE', data.header.date);
    metaField(col3, metaTop - 28, 'QUOTE VALID UNTIL', data.header.expirationDate);
    metaField(col3, metaTop - 56, 'PAYMENT TERMS', data.header.paymentTerms);
    metaField(col3, metaTop - 84, 'SHIPPING TERMS', data.header.shippingTerms);
    metaField(col3, metaTop - 112, 'QUOTED BY', data.header.quotedBy);

    y = metaTop - 130;
    line(MARGIN, y, PAGE_W - MARGIN, y, { color: lightGrey });
    y -= 20;

    // ---- BOM table columns ----
    const bomCols = [
      { key: 'partNumber', label: 'Part Number', x: MARGIN, w: 90 },
      { key: 'description', label: 'Description', x: MARGIN + 90, w: 232 },
      { key: 'listPrice', label: 'Unit Price', x: MARGIN + 322, w: 60, num: true },
      { key: 'qty', label: 'Qty', x: MARGIN + 382, w: 40, num: true },
      { key: 'extended', label: 'Total Price', x: MARGIN + 422, w: PAGE_W - MARGIN - (MARGIN + 422), num: true },
    ];
    function tableHeader(cols, title) {
      ensureSpace(40);
      if (title) { text(title, MARGIN, y, { font: helvBold, size: 10.5, color: navy }); y -= 16; }
      cols.forEach(c => {
        const opts = { font: helvBold, size: 7.5, color: grey };
        if (c.num) rightText(c.label.toUpperCase(), c.x + c.w, y, opts);
        else text(c.label.toUpperCase(), c.x, y, opts);
      });
      y -= 4;
      line(MARGIN, y, PAGE_W - MARGIN, y, { color: grey, thickness: 1 });
      y -= 12;
    }
    function tableRow(cols, rowGetters) {
      const lineHeights = cols.map(c => wrapText(rowGetters[c.key](), helv, 8.5, c.w - 4).length);
      const nLines = Math.max(1, ...lineHeights);
      const rowH = nLines * 10 + 4;
      ensureSpace(rowH + 20);
      cols.forEach(c => {
        const wrapped = wrapText(rowGetters[c.key](), helv, 8.5, c.w - 4);
        wrapped.forEach((ln, i) => {
          const yy = y - i * 10;
          if (c.num) rightText(ln, c.x + c.w, yy, { size: 8.5 });
          else text(ln, c.x, yy, { size: 8.5 });
        });
      });
      y -= rowH;
      line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3, { color: lightGrey, thickness: 0.5 });
    }
    function totalRow(label, amount, opts = {}) {
      ensureSpace(20);
      y -= 6;
      const size = opts.size || 9.5;
      const font = opts.bold ? helvBold : helv;
      const amountStr = money(amount);
      const amountW = font.widthOfTextAtSize(amountStr, size);
      const labelMaxW = PAGE_W - MARGIN * 2 - amountW - 14;
      wrapText(label, font, size, labelMaxW).forEach((ln, i) => {
        text(ln, MARGIN, y - i * (size + 2), { font, size });
      });
      rightText(amountStr, PAGE_W - MARGIN, y, { font, size });
      if (opts.underline) {
        y -= 3;
        line(MARGIN, y, PAGE_W - MARGIN, y, { color: black, thickness: 1 });
      }
      y -= 14;
    }

    data.sites.forEach(site => {
      ensureSpace(60);
      tableHeader(bomCols, `Site Name: ${site.name}`);
      if (!site.lines.length) {
        text('(no line items)', MARGIN, y, { size: 8.5, color: grey });
        y -= 16;
      }
      site.lines.forEach(l => {
        tableRow(bomCols, {
          partNumber: () => l.partNumber,
          description: () => l.description,
          listPrice: () => l.listPrice == null ? '' : money(l.listPrice),
          qty: () => String(l.qty),
          extended: () => money(l.extended),
        });
      });
      totalRow('Total Site Price', site.subtotal, { bold: true });
      y -= 8;
    });

    totalRow(data.totals.labels.totalCustPrice + ' Excluding Services/Warranty', data.totals.bom, { bold: true, underline: true, size: 10.5 });

    if (data.header.comments) {
      ensureSpace(40);
      text('Additional Information:', MARGIN, y, { font: helvBold, size: 9 });
      y -= 12;
      wrapText(data.header.comments, helv, 8.5, PAGE_W - MARGIN * 2).forEach(ln => {
        ensureSpace(12);
        text(ln, MARGIN, y, { size: 8.5 });
        y -= 11;
      });
      y -= 6;
    }

    if (data.services.length) {
      const svcCols = [
        { key: 'partNumber', label: 'Part Number', x: MARGIN, w: 80 },
        { key: 'description', label: 'Description', x: MARGIN + 80, w: 210 },
        { key: 'pctOfLp', label: '% of LP', x: MARGIN + 290, w: 45, num: true },
        { key: 'qty', label: 'Qty', x: MARGIN + 335, w: 35, num: true },
        { key: 'unitPrice', label: 'Unit Price', x: MARGIN + 370, w: 55, num: true },
        { key: 'extended', label: 'Total Price', x: MARGIN + 425, w: PAGE_W - MARGIN - (MARGIN + 425), num: true },
      ];
      ensureSpace(60);
      y -= 6;
      tableHeader(svcCols, 'Services / Warranty:');
      data.services.forEach(s => {
        const unit = s.qty ? s.amount / s.qty : s.amount;
        tableRow(svcCols, {
          partNumber: () => s.partNumber,
          description: () => s.description,
          pctOfLp: () => s.isPercent ? `${Math.round(s.percent * 10000) / 100}%` : '—',
          qty: () => String(s.qty),
          unitPrice: () => money(unit),
          extended: () => money(s.amount),
        });
      });
      totalRow('Total Service/Warranty Price', data.totals.svc, { bold: true });
    }

    totalRow(data.totals.labels.totalIncl, data.totals.totalPrice, { bold: true, underline: true, size: 11 });

    if (data.session.salesTaxEnabled) {
      ensureSpace(20);
      text(`(includes ${money(data.totals.salesTax)} sales tax at ${Math.round(data.session.salesTaxPct * 10000) / 100}%, backed out of the total above)`, MARGIN, y, { size: 7.5, font: helvOblique, color: grey });
      y -= 14;
    }

    // ---- Footer on every page ----
    const todayStr = new Date().toLocaleDateString('en-US');
    pages.forEach((p, i) => {
      const oldPage = page; page = p;
      const fy = MARGIN - 16;
      line(MARGIN, fy + 14, PAGE_W - MARGIN, fy + 14, { color: lightGrey });
      text(todayStr, MARGIN, fy, { size: 7.5, color: grey });
      const mid = 'All prices are in USD';
      const midW = helv.widthOfTextAtSize(mid, 7.5);
      text(mid, (PAGE_W - midW) / 2, fy, { size: 7.5, color: grey });
      rightText(`Page ${i + 1} of ${pages.length}  ·  ${meta.toolVersion || 'V3.21'}`, PAGE_W - MARGIN, fy, { size: 7.5, color: grey });
      page = oldPage;
    });

    const bytes = await doc.save();
    return bytes;
  }

  async function downloadPdf(filename) {
    const bytes = await generate();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `quote-${(Quote.header.quotationNumber || 'draft')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Foreign-PDF (non-round-trip) text-extraction import ----
  //
  // Groups text items into visual rows by y-position, then — within a row —
  // buckets items into columns by their x-position as a FRACTION of the
  // page's width. This two-step approach is what makes the original report's
  // 3-column header (and the BOM/Services tables) parseable: a naive
  // top-to-bottom read of the raw text stream interleaves columns whenever
  // any field's value wraps across more than one line.
  function groupRows(items, tol = 2.5) {
    const sorted = items.slice().sort((a, b) => b.y - a.y); // descending y = top of page first
    const rows = [];
    let cur = null;
    sorted.forEach(it => {
      if (!cur || Math.abs(it.y - cur.y) > tol) {
        cur = { y: it.y, items: [it] };
        rows.push(cur);
      } else {
        cur.items.push(it);
      }
    });
    return rows;
  }

  function rowText(r) {
    return r.items.slice().sort((a, b) => a.x - b.x).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
  }

  // Buckets a row's items into zones by x-fraction of the page width.
  // `thresholds` is an ascending list of zone-boundary fractions; there is
  // one more zone than there are thresholds (the last zone is "> last
  // threshold"). Returns one joined, trimmed text string per zone.
  function bucketRow(r, thresholds) {
    const zones = thresholds.length + 1;
    const buckets = Array.from({ length: zones }, () => []);
    r.items.forEach(it => {
      const frac = it.x / r.pageWidth;
      let zi = thresholds.findIndex(t => frac < t);
      if (zi === -1) zi = zones - 1;
      buckets[zi].push(it);
    });
    return buckets.map(b => b.sort((a, b2) => a.x - b2.x).map(it => it.str).join(' ').trim());
  }

  // Extracts label:value fields from a single column's full (possibly
  // multi-line) text, given an ordered list of {key, pattern} label
  // definitions (pattern = a regex source, matched case-insensitively). Each
  // field's value is everything between its label and the NEXT label found
  // after it (or the end of the text) — this is what lets a value safely
  // wrap across several source lines without needing to know its length in
  // advance. A label that isn't found is simply left out of the result.
  function extractLabeledFields(text, labelDefs) {
    const starts = [];
    let searchFrom = 0;
    labelDefs.forEach(def => {
      const re = new RegExp(def.pattern, 'i');
      const m = text.slice(searchFrom).match(re);
      if (m) {
        const start = searchFrom + m.index;
        const end = start + m[0].length;
        starts.push({ key: def.key, start, end });
        searchFrom = end;
      }
    });
    const result = {};
    starts.forEach((m, i) => {
      const stop = i + 1 < starts.length ? starts[i + 1].start : text.length;
      result[m.key] = text.slice(m.end, stop).replace(/\s+/g, ' ').trim();
    });
    return result;
  }

  function parseMoney(s) {
    if (!s) return null;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  function parseQty(s) {
    const n = parseInt(String(s || '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // M/D/YYYY (as printed by the Access report) -> YYYY-MM-DD (as needed by
  // an HTML date input). Falls back to the original string if it doesn't
  // parse, rather than guessing.
  function convertDate(str) {
    const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return str;
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const FOREIGN_RE = {
    quotationNum: /quotation\s*#/i,
    siteName: /^site\s*name\s*:\s*(.*)$/i,
    pnHeader: /^part\s*number\b/i,
    totalSite: /^total\s+site\s+(?:transfer\s+)?price\b/i,
    totalExcl: /^total\s+.*price\s+excluding\b/i,
    servicesMarker: /^services\s*\/\s*warranty\s*:?\s*$/i,
    totalService: /^total\s+service\s*\/\s*warranty\s+price\b/i,
    totalIncl: /^total\s+.*price.*including\b/i,
    additionalInfo: /^additional\s+information\s*:?/i,
    footer: /all prices are in usd/i,
  };

  // Best-effort parse of a foreign (non-round-trip) PDF's VISIBLE text into
  // the same shape Quote.importForeignData() expects. Returns null if the
  // PDF doesn't look like an Actelis quote report at all (no "Quotation #"
  // field and no recognizable BOM/services tables found).
  async function parseForeignPdf(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      console.warn('PdfExport: pdfjsLib is not loaded — cannot parse a foreign PDF.');
      return null;
    }
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

    const allRows = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items
        .filter(it => it.str && it.str.trim())
        .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
      groupRows(items).forEach(r => allRows.push({ y: r.y, items: r.items, pageWidth: viewport.width }));
    }
    if (!allRows.length) return null;

    // ---- Header: 3-column quote-meta grid, between "Quotation #" and the
    // first "Site Name:" marker. Column boundaries (as fractions of page
    // width) were measured directly off the original Access report's fixed
    // control layout — see the reference QuoteReport PDF.
    const startIdx = allRows.findIndex(r => FOREIGN_RE.quotationNum.test(rowText(r)));
    const header = {};
    let firstSiteIdx = -1;
    if (startIdx >= 0) {
      firstSiteIdx = allRows.findIndex((r, i) => i > startIdx && FOREIGN_RE.siteName.test(rowText(r)));
      const endIdx = firstSiteIdx >= 0 ? firstSiteIdx : allRows.length;
      const headerRows = allRows.slice(startIdx, endIdx);
      const colTexts = ['', '', ''];
      headerRows.forEach(r => {
        const cols = bucketRow(r, [0.30, 0.55]);
        cols.forEach((t, ci) => { if (t) colTexts[ci] += (colTexts[ci] ? ' ' : '') + t; });
      });
      Object.assign(header, extractLabeledFields(colTexts[0], [
        { key: 'quotationNumber', pattern: 'quotation\\s*#\\s*:?' },
        { key: 'customer', pattern: 'customer\\s*name\\s*:?' },
      ]));
      Object.assign(header, extractLabeledFields(colTexts[1], [
        { key: 'customerContact', pattern: 'customer\\s*contact\\s*:?' },
        { key: 'address', pattern: 'address\\s*:?' },
        { key: 'phone', pattern: 'phone\\s*/?\\s*fax\\s*:?' },
        { key: 'email', pattern: 'email\\s*:?' },
      ]));
      Object.assign(header, extractLabeledFields(colTexts[2], [
        { key: 'date', pattern: 'date\\s*:?' },
        { key: 'expirationDate', pattern: 'quote\\s*valid\\s*until\\s*:?' },
        { key: 'paymentTerms', pattern: 'payment\\s*terms\\s*:?' },
        { key: 'shippingTerms', pattern: 'shipping\\s*terms\\s*:?' },
        { key: 'quotedBy', pattern: 'quoted\\s*by\\s*:?' },
      ]));
      if (header.date) header.date = convertDate(header.date);
      if (header.expirationDate) header.expirationDate = convertDate(header.expirationDate);
    }

    // ---- BOM (per site) / Services tables: a marker-driven state machine
    // walking the rows top-to-bottom (and page-to-page, in order). A row
    // "starts" a new line item when it has text in the part-number zone;
    // otherwise, if it has text in the description zone, it's a wrapped
    // continuation of the previous line's description.
    const sites = [];
    const services = [];
    let printedGrandTotal = null;
    let comments = '';
    let collectingComments = false;
    let state = 'seek'; // seek | bomHeader | bomRows | servicesHeader | servicesRows
    let currentSite = null;
    let currentLine = null;
    let currentService = null;

    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      const full = rowText(r);
      if (!full) continue;

      if (collectingComments) {
        if (FOREIGN_RE.footer.test(full)) { collectingComments = false; }
        else { comments += (comments ? ' ' : '') + full; continue; }
      }

      if (FOREIGN_RE.additionalInfo.test(full)) {
        const rest = full.replace(FOREIGN_RE.additionalInfo, '').trim();
        if (rest) comments += (comments ? ' ' : '') + rest;
        collectingComments = true;
        continue;
      }

      const siteMatch = full.match(FOREIGN_RE.siteName);
      if (siteMatch) {
        if (currentLine && currentSite) { currentSite.lines.push(currentLine); currentLine = null; }
        if (currentSite) sites.push(currentSite);
        currentSite = { name: siteMatch[1].trim() || `Site ${sites.length + 1}`, lines: [] };
        state = 'bomHeader';
        continue;
      }

      switch (state) {
        case 'bomHeader':
          if (FOREIGN_RE.pnHeader.test(full)) state = 'bomRows';
          break;

        case 'bomRows': {
          if (FOREIGN_RE.totalSite.test(full)) {
            if (currentLine && currentSite) currentSite.lines.push(currentLine);
            currentLine = null;
            if (currentSite) { sites.push(currentSite); currentSite = null; }
            state = 'seek';
            break;
          }
          const [pnText, descText, unitText, qtyText, totalText] = bucketRow(r, [0.15, 0.58, 0.70, 0.80]);
          if (pnText) {
            if (currentLine && currentSite) currentSite.lines.push(currentLine);
            currentLine = {
              partNumber: pnText, description: descText,
              unitPrice: parseMoney(unitText), qty: parseQty(qtyText) || 1,
              totalPrice: parseMoney(totalText),
            };
          } else if (descText && currentLine) {
            currentLine.description = (currentLine.description ? currentLine.description + ' ' : '') + descText;
          }
          break;
        }

        case 'seek':
          if (FOREIGN_RE.servicesMarker.test(full)) {
            if (currentService) { services.push(currentService); currentService = null; }
            state = 'servicesHeader';
          } else if (FOREIGN_RE.totalIncl.test(full)) {
            const m = full.match(/\$?\s*[\d,]+\.\d{2}/);
            if (m) printedGrandTotal = parseMoney(m[0]);
          }
          // FOREIGN_RE.totalExcl and any other stray rows between tables
          // (e.g. blank spacer lines) are informational only — ignored.
          break;

        case 'servicesHeader':
          if (FOREIGN_RE.pnHeader.test(full)) state = 'servicesRows';
          break;

        case 'servicesRows': {
          if (FOREIGN_RE.totalService.test(full)) {
            if (currentService) { services.push(currentService); currentService = null; }
            state = 'seek';
            break;
          }
          // % / Qty / Unit Price sub-columns are inconsistently populated
          // and positioned in real data, so they're merged into the
          // description zone here rather than parsed as separate fields —
          // a stray "3.0%" is stripped back out below.
          const [pnText, descRaw, totalText] = bucketRow(r, [0.15, 0.80]);
          const descText = descRaw.replace(/\d+(?:\.\d+)?%/g, '').replace(/\s+/g, ' ').trim();
          if (pnText) {
            if (currentService) services.push(currentService);
            currentService = { partNumber: pnText, description: descText, qty: 1, totalPrice: parseMoney(totalText) };
          } else if (descText && currentService) {
            currentService.description = (currentService.description ? currentService.description + ' ' : '') + descText;
          }
          break;
        }
      }
    }
    if (currentLine && currentSite) currentSite.lines.push(currentLine);
    if (currentSite) sites.push(currentSite);
    if (currentService) services.push(currentService);

    if (!Object.keys(header).length && !sites.length && !services.length) return null;

    // Map services' totalPrice -> unitPrice (qty is always 1 for a parsed
    // service line, since the original report's Qty sub-column isn't
    // reliably extractable — see above), so importForeignData's fallback
    // pricing (unitPrice ?? totalPrice/qty) works the same as for BOM lines.
    services.forEach(s => { s.unitPrice = s.totalPrice; });

    return { header, sites, services, printedGrandTotal, comments: comments.trim() };
  }

  // Tries to read a PDF as one of THIS tool's own exports first (exact,
  // via embedded metadata); if that fails, falls back to a best-effort
  // text-extraction parse for a foreign PDF (e.g. a real historical quote
  // printed by the original Access desktop tool). Returns:
  //   { kind: 'roundtrip', state }  — our own export, exact round-trip
  //   { kind: 'foreign', data }     — parsed from visible text, best-effort
  //   null                          — not a recognizable Actelis quote PDF
  async function parseFile(file) {
    const buf = await file.arrayBuffer();

    try {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(buf.slice(0), { ignoreEncryption: true, updateMetadata: false });
      const subject = doc.getSubject();
      if (subject && subject.startsWith(META_PREFIX)) {
        const json = b64DecodeUnicode(subject.slice(META_PREFIX.length));
        return { kind: 'roundtrip', state: JSON.parse(json) };
      }
    } catch (e) {
      console.warn('PdfExport: could not read this PDF with pdf-lib; will try foreign-PDF text extraction.', e);
    }

    try {
      const data = await parseForeignPdf(buf.slice(0));
      if (data) return { kind: 'foreign', data };
    } catch (e) {
      console.warn('PdfExport: foreign-PDF text extraction failed.', e);
    }

    return null;
  }

  // ---- Price List PDF (price-list.html "Export PDF") ----
  //
  // A category-grouped listing of whichever list is currently open on the
  // Price List page (Price List / Services-Warranty / Archive), using the
  // discount actually in effect for each row -- its per-item or
  // per-category override from PriceListPricing (pricelist.js), or the
  // standard region/customer-type default otherwise. Always the FULL list
  // for that tab: it deliberately ignores whatever is currently typed in
  // the search box or picked in the category filter, so "Export PDF"
  // always produces a complete price list rather than a partial one a
  // visitor might not realize was filtered.
  //
  // `payload` is a plain-data object built by app.js (see buildPriceListPdfData):
  //   { title, customerName, customerType, region, date, dealRegistration,
  //     categories: [ { category, rows: [ { partNumber, description,
  //       listPriceDisplay, discountDisplay, netDisplay } ] } ] }
  async function generatePriceList(payload) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const meta = (typeof DataStore !== 'undefined' && DataStore.meta) || {};

    const doc = await PDFDocument.create();
    doc.setTitle(`Actelis Price List${payload.customerName ? ' — ' + payload.customerName : ''}`);
    doc.setProducer('Actelis Price & Quote Tool (online edition)');
    doc.setCreator('Actelis Price & Quote Tool (online edition)');

    const helv = await doc.embedFont(StandardFonts.Helvetica);
    const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const helvOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

    let logoImage = null, logoDims = null;
    try {
      const logoBytes = await fetchBytes('assets/actelis-logo.png');
      logoImage = await doc.embedPng(logoBytes);
      logoDims = logoImage.scale(26 / logoImage.height);
    } catch (e) { /* logo optional -- PDF still generates without it */ }

    const navy = rgb(0.063, 0.122, 0.235);
    const accent = rgb(0.933, 0.490, 0.122);
    const grey = rgb(0.35, 0.41, 0.46);
    const lightGrey = rgb(0.85, 0.88, 0.91);
    const black = rgb(0.12, 0.15, 0.19);

    const pages = [];
    let page, y;

    function addPage() {
      page = doc.addPage([PAGE_W, PAGE_H]);
      pages.push(page);
      y = PAGE_H - MARGIN;
      return page;
    }
    function ensureSpace(h) {
      if (y - h < MARGIN + 30) addPage();
    }
    function text(str, x, yy, opts = {}) {
      page.drawText(String(str == null ? '' : str), {
        x, y: yy, size: opts.size || 9, font: opts.font || helv, color: opts.color || black,
      });
    }
    function line(x1, yy1, x2, yy2, opts = {}) {
      page.drawLine({ start: { x: x1, y: yy1 }, end: { x: x2, y: yy2 }, thickness: opts.thickness || 0.75, color: opts.color || lightGrey });
    }
    function rightText(str, xRight, yy, opts = {}) {
      const f = opts.font || helv, size = opts.size || 9;
      const w = f.widthOfTextAtSize(String(str == null ? '' : str), size);
      text(str, xRight - w, yy, opts);
    }

    // ---- Header: logo + Actelis address block (right), same as the Quote PDF ----
    addPage();
    if (logoImage) {
      page.drawImage(logoImage, { x: MARGIN, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });
    } else {
      text('ACTELIS', MARGIN, y - 16, { font: helvBold, size: 16, color: navy });
    }
    rightText('Actelis', PAGE_W - MARGIN, y - 8, { font: helvBold, size: 10, color: navy });
    rightText('4039 Clipper Court', PAGE_W - MARGIN, y - 20, { size: 8.5, color: grey });
    rightText('Fremont, CA 94538', PAGE_W - MARGIN, y - 31, { size: 8.5, color: grey });
    rightText('P: 510-545-1045', PAGE_W - MARGIN, y - 42, { size: 8.5, color: grey });
    rightText('F: 510-545-1075', PAGE_W - MARGIN, y - 53, { size: 8.5, color: grey });
    y -= 62;
    text(payload.title || 'PRICE LIST', MARGIN, y, { font: helvBold, size: 15, color: navy });
    y -= 8;
    line(MARGIN, y, PAGE_W - MARGIN, y, { thickness: 1.5, color: accent });
    y -= 20;

    // ---- "Prepared for" info block: customer name + the settings that ----
    // ---- actually drove the discounts shown (customer type, region) -----
    function metaField(x, yy, label, value) {
      text(label, x, yy, { font: helvBold, size: 7.5, color: grey });
      text(value || '—', x, yy - 11, { size: 9.5, color: black });
    }
    const colW = (PAGE_W - MARGIN * 2) / 4;
    metaField(MARGIN, y, 'PREPARED FOR', payload.customerName);
    metaField(MARGIN + colW, y, 'CUSTOMER TYPE', payload.customerType);
    metaField(MARGIN + colW * 2, y, 'REGION', payload.region);
    metaField(MARGIN + colW * 3, y, 'DATE', payload.date);
    y -= 30;
    if (payload.dealRegistration) {
      text('Includes NA Deal Registration bonus discount.', MARGIN, y, { size: 7.5, font: helvOblique, color: grey });
      y -= 14;
    }
    line(MARGIN, y, PAGE_W - MARGIN, y, { color: lightGrey });
    y -= 18;

    // ---- Item table, grouped by category ----
    const cols = [
      { key: 'partNumber', label: 'Part Number', x: MARGIN, w: 85 },
      { key: 'description', label: 'Description', x: MARGIN + 85, w: 230 },
      { key: 'listPrice', label: 'List Price', x: MARGIN + 315, w: 65, num: true },
      { key: 'discount', label: 'Discount', x: MARGIN + 380, w: 55, num: true },
      { key: 'netPrice', label: 'Your Price', x: MARGIN + 435, w: PAGE_W - MARGIN - (MARGIN + 435), num: true },
    ];
    function tableHeader(title) {
      ensureSpace(40);
      if (title) { text(title, MARGIN, y, { font: helvBold, size: 10, color: navy }); y -= 14; }
      cols.forEach(c => {
        const opts = { font: helvBold, size: 7.5, color: grey };
        if (c.num) rightText(c.label.toUpperCase(), c.x + c.w, y, opts);
        else text(c.label.toUpperCase(), c.x, y, opts);
      });
      y -= 4;
      line(MARGIN, y, PAGE_W - MARGIN, y, { color: grey, thickness: 1 });
      y -= 12;
    }
    function tableRow(getters) {
      const lineHeights = cols.map(c => wrapText(getters[c.key](), helv, 8.5, c.w - 4).length);
      const nLines = Math.max(1, ...lineHeights);
      const rowH = nLines * 10 + 4;
      ensureSpace(rowH + 20);
      cols.forEach(c => {
        wrapText(getters[c.key](), helv, 8.5, c.w - 4).forEach((ln, i) => {
          const yy = y - i * 10;
          if (c.num) rightText(ln, c.x + c.w, yy, { size: 8.5 });
          else text(ln, c.x, yy, { size: 8.5 });
        });
      });
      y -= rowH;
      line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3, { color: lightGrey, thickness: 0.5 });
    }

    (payload.categories || []).forEach(cat => {
      ensureSpace(50);
      y -= 6;
      tableHeader(cat.category);
      cat.rows.forEach(r => {
        tableRow({
          partNumber: () => r.partNumber,
          description: () => r.description,
          listPrice: () => r.listPriceDisplay,
          discount: () => r.discountDisplay,
          netPrice: () => r.netDisplay,
        });
      });
      y -= 6;
    });

    // ---- Footer on every page ----
    const todayStr = new Date().toLocaleDateString('en-US');
    pages.forEach((p, i) => {
      const oldPage = page; page = p;
      const fy = MARGIN - 16;
      line(MARGIN, fy + 14, PAGE_W - MARGIN, fy + 14, { color: lightGrey });
      text(todayStr, MARGIN, fy, { size: 7.5, color: grey });
      const mid = 'All prices are in USD — subject to change without notice';
      const midW = helv.widthOfTextAtSize(mid, 7.5);
      text(mid, (PAGE_W - midW) / 2, fy, { size: 7.5, color: grey });
      rightText(`Page ${i + 1} of ${pages.length}  ·  ${meta.toolVersion || 'V3.21'}`, PAGE_W - MARGIN, fy, { size: 7.5, color: grey });
      page = oldPage;
    });

    return doc.save();
  }

  async function downloadPriceListPdf(payload, filename) {
    const bytes = await generatePriceList(payload);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'actelis-price-list.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { generate, downloadPdf, parseFile, generatePriceList, downloadPriceListPdf };
})();
