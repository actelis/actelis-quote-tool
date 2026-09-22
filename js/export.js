/* export.js
 * CSV/Excel export and Print/PDF view for the in-memory Quote (js/quote.js).
 * No server round-trip: CSV is built as a Blob and downloaded client-side;
 * PDF export is simply "use the browser's Print dialog -> Save as PDF" on a
 * print-optimized view, which is the same approach the original Access
 * "Print Preview" -> PDF used under the hood.
 *
 * Nothing here writes to disk or a server. Nothing here is persisted beyond
 * the file the browser saves at the user's explicit request.
 */
const Export = (() => {

  function money(n) {
    return (Math.round((n || 0) * 100) / 100).toFixed(2);
  }

  function csvField(v) {
    const s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvRow(fields) {
    return fields.map(csvField).join(',') + '\r\n';
  }

  // ---- Build a flat description of the current quote (shared by CSV + print) ----
  function buildQuoteData() {
    const totals = Quote.totals();
    const sites = Quote.sites.map(site => {
      const lines = site.lines.map(l => {
        const row = DataStore.getPriceRow(l.partNumber);
        const listPrice = row ? row.listPrice : (l.manual ? l.manualPrice : null);
        const discount = row ? Quote.effectiveDiscount(l) : 0;
        const netPrice = Quote.lineNetPrice(l);
        return {
          partNumber: l.partNumber,
          description: row ? row.description : (l.manual ? l.manualDescription : '(unknown part)'),
          category: row ? DataStore.categoryDescription(row.category) : (l.manual ? 'Custom' : ''),
          qty: l.qty,
          listPrice,
          discountPct: discount,
          netPrice,
          extended: netPrice * l.qty,
        };
      });
      const subtotal = lines.reduce((s, l) => s + l.extended, 0);
      return { name: site.name, lines, subtotal };
    });
    const services = Quote.services.map(s => ({
      partNumber: s.partNumber,
      description: s.description,
      qty: s.qty,
      isPercent: s.isPercent,
      percent: s.percent,
      amount: s.isPercent ? s.percent * totals.bom * (s.qty || 1) : (s.manualPrice || 0) * (s.qty || 1),
    }));
    return { header: Quote.header, session: Quote.session, sites, services, totals };
  }

  // ---- CSV export ----
  function toCSV() {
    const data = buildQuoteData();
    let csv = '';
    csv += csvRow(['Actelis Price/Quote Tool - Export']);
    csv += csvRow(['Quotation #', data.header.quotationNumber || '']);
    csv += csvRow(['Customer', data.header.customer || '']);
    csv += csvRow(['Date', data.header.date || '']);
    csv += csvRow(['Customer Type', data.session.customerType]);
    csv += csvRow(['Region', data.session.region]);
    csv += csvRow([]);

    data.sites.forEach(site => {
      csv += csvRow([`Site: ${site.name}`]);
      csv += csvRow(['Part Number', 'Description', 'Category', 'Qty', 'List Price', 'Discount %', 'Net Price', 'Extended Price']);
      site.lines.forEach(l => {
        csv += csvRow([
          l.partNumber, l.description, l.category, l.qty,
          l.listPrice == null ? '' : money(l.listPrice),
          l.discountPct == null ? '' : (Math.round(l.discountPct * 10000) / 100) + '%',
          money(l.netPrice), money(l.extended),
        ]);
      });
      csv += csvRow(['', '', '', '', '', '', 'Site Subtotal', money(site.subtotal)]);
      csv += csvRow([]);
    });

    if (data.services.length) {
      csv += csvRow(['Services / Warranty']);
      csv += csvRow(['Part Number', 'Description', 'Qty', 'Type', 'Amount']);
      data.services.forEach(s => {
        csv += csvRow([s.partNumber, s.description, s.qty, s.isPercent ? `${Math.round(s.percent * 10000) / 100}% of BOM` : 'Flat', money(s.amount)]);
      });
      csv += csvRow([]);
    }

    const t = data.totals;
    csv += csvRow(['', '', '', '', '', '', 'BOM Subtotal', money(t.bom)]);
    csv += csvRow(['', '', '', '', '', '', 'Services Subtotal', money(t.svc)]);
    if (data.session.salesTaxEnabled) {
      csv += csvRow(['', '', '', '', '', '', t.labels.totalIncl + ' (before tax)', money(t.priceNoTax)]);
      csv += csvRow(['', '', '', '', '', '', 'Sales Tax', money(t.salesTax)]);
    }
    csv += csvRow(['', '', '', '', '', '', t.labels.totalIncl, money(t.totalPrice)]);

    return csv;
  }

  function downloadCSV(filename) {
    const csv = toCSV();
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `quote-${(Quote.header.quotationNumber || 'draft')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Real .xlsx export (SheetJS, vendored at js/vendor/xlsx.full.min.js) ----
  function toAOA() {
    const data = buildQuoteData();
    const rows = [];
    rows.push(['Actelis Price/Quote Tool - Export']);
    rows.push(['Quotation #', data.header.quotationNumber || '']);
    rows.push(['Customer', data.header.customer || '']);
    rows.push(['Date', data.header.date || '']);
    rows.push(['Customer Type', data.session.customerType]);
    rows.push(['Region', data.session.region]);
    rows.push([]);

    data.sites.forEach(site => {
      rows.push([`Site: ${site.name}`]);
      rows.push(['Part Number', 'Description', 'Category', 'Qty', 'List Price', 'Discount %', 'Net Price', 'Extended Price']);
      site.lines.forEach(l => {
        rows.push([
          l.partNumber, l.description, l.category, l.qty,
          l.listPrice == null ? '' : Number(money(l.listPrice)),
          l.discountPct == null ? '' : (Math.round(l.discountPct * 10000) / 100) + '%',
          Number(money(l.netPrice)), Number(money(l.extended)),
        ]);
      });
      rows.push(['', '', '', '', '', '', 'Site Subtotal', Number(money(site.subtotal))]);
      rows.push([]);
    });

    if (data.services.length) {
      rows.push(['Services / Warranty']);
      rows.push(['Part Number', 'Description', 'Qty', 'Type', 'Amount']);
      data.services.forEach(s => {
        rows.push([s.partNumber, s.description, s.qty, s.isPercent ? `${Math.round(s.percent * 10000) / 100}% of BOM` : 'Flat', Number(money(s.amount))]);
      });
      rows.push([]);
    }

    const t = data.totals;
    rows.push(['', '', '', '', '', '', 'BOM Subtotal', Number(money(t.bom))]);
    rows.push(['', '', '', '', '', '', 'Services Subtotal', Number(money(t.svc))]);
    if (data.session.salesTaxEnabled) {
      rows.push(['', '', '', '', '', '', t.labels.totalIncl + ' (before tax)', Number(money(t.priceNoTax))]);
      rows.push(['', '', '', '', '', '', 'Sales Tax', Number(money(t.salesTax))]);
    }
    rows.push(['', '', '', '', '', '', t.labels.totalIncl, Number(money(t.totalPrice))]);
    return rows;
  }

  function downloadXLSX(filename) {
    if (typeof XLSX === 'undefined') {
      console.warn('Export.downloadXLSX: SheetJS (xlsx) is not loaded on this page.');
      return;
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(toAOA());
    ws['!cols'] = [{ wch: 16 }, { wch: 38 }, { wch: 16 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Quote');
    XLSX.writeFile(wb, filename || `quote-${(Quote.header.quotationNumber || 'draft')}.xlsx`);
  }

  // ---- Print / PDF view ----
  // Renders a print-friendly HTML representation of the quote into the given
  // container element. The page's own CSS (see css/style.css @media print
  // rules) hides everything else and shows only #print-area when printing.
  function renderPrintable(containerEl) {
    const data = buildQuoteData();
    const isEndCustomer = data.session.customerType === 'End Customer';
    const priceHeader = isEndCustomer ? 'List Price' : 'List Price';
    const netHeader = isEndCustomer ? 'Your Price' : 'Transfer Price';

    let html = `
      <div class="print-header">
        <h1>Actelis Networks</h1>
        <h2>Quotation</h2>
        <table class="print-meta">
          <tr><td>Quotation #</td><td>${escapeHtml(data.header.quotationNumber || '')}</td>
              <td>Date</td><td>${escapeHtml(data.header.date || '')}</td></tr>
          <tr><td>Customer</td><td>${escapeHtml(data.header.customer || '')}</td>
              <td>Contact</td><td>${escapeHtml(data.header.customerContact || '')}</td></tr>
          <tr><td>Customer Type</td><td>${escapeHtml(data.session.customerType)}</td>
              <td>Region</td><td>${escapeHtml(data.session.region)}</td></tr>
        </table>
      </div>
    `;

    data.sites.forEach(site => {
      html += `<h3 class="print-site-title">${escapeHtml(site.name)}</h3>`;
      html += `<table class="print-table"><thead><tr>
          <th>Part Number</th><th>Description</th><th>Qty</th>
          <th>${priceHeader}</th><th>${netHeader}</th><th>Extended</th>
        </tr></thead><tbody>`;
      site.lines.forEach(l => {
        html += `<tr>
          <td>${escapeHtml(l.partNumber)}</td>
          <td>${escapeHtml(l.description)}</td>
          <td class="num">${l.qty}</td>
          <td class="num">${l.listPrice == null ? '' : '$' + money(l.listPrice)}</td>
          <td class="num">$${money(l.netPrice)}</td>
          <td class="num">$${money(l.extended)}</td>
        </tr>`;
      });
      html += `<tr class="print-subtotal"><td colspan="5">Site Subtotal</td><td class="num">$${money(site.subtotal)}</td></tr>`;
      html += `</tbody></table>`;
    });

    if (data.services.length) {
      html += `<h3 class="print-site-title">Services / Warranty</h3>`;
      html += `<table class="print-table"><thead><tr>
          <th>Part Number</th><th>Description</th><th>Qty</th><th>Amount</th>
        </tr></thead><tbody>`;
      data.services.forEach(s => {
        html += `<tr>
          <td>${escapeHtml(s.partNumber)}</td>
          <td>${escapeHtml(s.description)}</td>
          <td class="num">${s.qty}</td>
          <td class="num">$${money(s.amount)}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }

    const t = data.totals;
    html += `<table class="print-totals">`;
    html += `<tr><td>BOM Subtotal</td><td class="num">$${money(t.bom)}</td></tr>`;
    html += `<tr><td>Services Subtotal</td><td class="num">$${money(t.svc)}</td></tr>`;
    if (data.session.salesTaxEnabled) {
      html += `<tr><td>Subtotal (before tax)</td><td class="num">$${money(t.priceNoTax)}</td></tr>`;
      html += `<tr><td>Sales Tax</td><td class="num">$${money(t.salesTax)}</td></tr>`;
    }
    html += `<tr class="print-grand-total"><td>${escapeHtml(t.labels.totalIncl)}</td><td class="num">$${money(t.totalPrice)}</td></tr>`;
    html += `</table>`;

    if (data.header.comments) {
      html += `<div class="print-comments"><strong>Comments:</strong><br>${escapeHtml(data.header.comments).replace(/\n/g, '<br>')}</div>`;
    }

    html += `<div class="print-footer">This quotation was generated by the Actelis online price/quote tool and does not represent a binding offer unless countersigned by Actelis Networks. Prices are exclusive of shipping and applicable duties/taxes unless otherwise noted.</div>`;

    containerEl.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function printQuote(containerId = 'print-area') {
    const el = document.getElementById(containerId);
    if (!el) {
      console.warn(`Export.printQuote: no #${containerId} element found on this page.`);
      return;
    }
    renderPrintable(el);
    window.print();
  }

  return { buildQuoteData, toCSV, downloadCSV, toAOA, downloadXLSX, renderPrintable, printQuote };
})();
