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
 * Nothing here uploads or stores anything — the PDF is generated and parsed
 * entirely in the browser.
 */
const PdfExport = (() => {
  const META_PREFIX = 'ACTELIS_QUOTE_DATA_V1:';
  const PAGE_W = 612, PAGE_H = 792; // US Letter, points
  const MARGIN = 40;

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

  // Reads a previously-exported PDF's embedded quote state back out. Returns
  // the parsed state object, or null if the PDF has no recognizable Actelis
  // quote metadata (e.g. it's some other PDF entirely).
  async function parseFile(file) {
    const { PDFDocument } = PDFLib;
    const buf = await file.arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    const subject = doc.getSubject();
    if (!subject || !subject.startsWith(META_PREFIX)) return null;
    const json = b64DecodeUnicode(subject.slice(META_PREFIX.length));
    return JSON.parse(json);
  }

  return { generate, downloadPdf, parseFile };
})();
