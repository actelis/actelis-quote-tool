/* app.js
 * DOM wiring for the three HTML pages (index.html has none). Depends on
 * data.js / discount.js / quote.js always; price-list.html needs only those;
 * quote-builder.html additionally needs the wizard-*.js, pdf.js, export.js
 * and admin.js files.
 */
const App = (() => {

  // ---------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------
  function money(n) {
    if (n == null || isNaN(n)) return '';
    return '$' + (Math.round(n * 100) / 100).toFixed(2);
  }
  function pct(n) {
    if (!n) return '0%';
    return (Math.round(n * 10000) / 100) + '%';
  }
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function optionLabel(row) {
    return `${row.partNumber} — ${row.description}`;
  }
  function parsePN(str) {
    if (!str) return null;
    const idx = str.indexOf(' — ');
    return (idx > -1 ? str.slice(0, idx) : str).trim() || null;
  }
  function fillSelect(selectEl, rows, { none = null, valueKey = 'partNumber', selected = null } = {}) {
    selectEl.innerHTML = '';
    if (none !== null) selectEl.appendChild(el('option', { value: 'None' }, none));
    rows.forEach(r => {
      const opt = el('option', { value: r[valueKey] }, optionLabel(r));
      if (selected && r[valueKey] === selected) opt.setAttribute('selected', 'selected');
      selectEl.appendChild(opt);
    });
  }
  function fillDatalist(datalistEl, rows) {
    datalistEl.innerHTML = '';
    rows.forEach(r => datalistEl.appendChild(el('option', { value: optionLabel(r) })));
  }
  function wireDropzone(zoneId, inputId, onFile) {
    const zone = document.getElementById(zoneId), input = document.getElementById(inputId);
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
  }

  // ---------------------------------------------------------------------
  // Common: session bar (customer type / region / deal registration)
  // ---------------------------------------------------------------------
  function wireSessionBar() {
    const ctSel = document.getElementById('customerType');
    const regionSel = document.getElementById('region');
    const dealChk = document.getElementById('dealRegistration');
    const dealField = document.getElementById('dealRegField');
    if (!ctSel) return;

    regionSel.innerHTML = '';
    DataStore.regions.forEach(r => regionSel.appendChild(el('option', { value: r.name }, r.name)));
    ctSel.value = Quote.session.customerType;
    regionSel.value = Quote.session.region;
    if (dealChk) dealChk.checked = !!Quote.session.dealRegistration;

    function syncDealVisibility() {
      const isEmeaApac = DiscountEngine.isEmeaApac(Quote.session.region);
      if (dealField) dealField.style.display = isEmeaApac ? 'none' : '';
      if (isEmeaApac && dealChk) { dealChk.checked = false; Quote.session.dealRegistration = false; }
    }
    syncDealVisibility();

    ctSel.addEventListener('change', () => { Quote.session.customerType = ctSel.value; Quote.save(); onSessionChange(); });
    regionSel.addEventListener('change', () => { Quote.session.region = regionSel.value; Quote.save(); syncDealVisibility(); onSessionChange(); });
    if (dealChk) dealChk.addEventListener('change', () => { Quote.session.dealRegistration = dealChk.checked; Quote.save(); onSessionChange(); });
  }

  // overridden per-page to re-render prices/totals when session changes
  let onSessionChange = () => {};

  // ---------------------------------------------------------------------
  // PRICE LIST PAGE
  // ---------------------------------------------------------------------
  function initPriceListPage() {
    DataStore.load().then(() => {
      wireSessionBar();

      const categoryFilter = document.getElementById('categoryFilter');
      DataStore.raw.categoryHeaders.forEach(c => {
        categoryFilter.appendChild(el('option', { value: c.category }, `${c.category} — ${c.description}`));
      });

      let activeList = 'priceList';
      const tabs = Array.from(document.querySelectorAll('.tab-btn'));
      tabs.forEach(btn => btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeList = btn.dataset.list;
        render();
      }));

      const searchBox = document.getElementById('searchBox');
      searchBox.addEventListener('input', debounce(render, 150));
      categoryFilter.addEventListener('change', render);
      onSessionChange = render;

      function render() {
        const body = document.getElementById('priceTableBody');
        const q = searchBox.value.trim().toLowerCase();
        const cat = categoryFilter.value;
        let rows = DataStore.raw[activeList] || [];
        rows = rows.filter(r => {
          if (r.showPriceList === false) return false;
          if (cat && r.category !== cat) return false;
          if (q && !(`${r.partNumber} ${r.description}`.toLowerCase().includes(q))) return false;
          return true;
        });
        body.innerHTML = '';
        const ctx = Quote.ctx();
        const isTypeD = activeList === 'typeD';

        rows.forEach(r => {
          let listPriceDisplay, netDisplay, discDisplay, addFn;
          if (isTypeD) {
            const isPercent = Quote.isPercentTypeD(r);
            listPriceDisplay = isPercent ? (r.listPriceString || '') : money(r.listPrice);
            netDisplay = isPercent ? '—' : money(r.listPrice);
            discDisplay = isPercent ? 'per BOM' : '—';
            addFn = () => { Quote.addService(r.partNumber); render(); };
          } else {
            const discount = DataStore.getPriceRow(r.partNumber) ? DiscountEngine.getCustomerDiscount(r.partNumber, 1, ctx) : 0;
            listPriceDisplay = money(r.listPrice);
            netDisplay = money(r.listPrice == null ? null : r.listPrice * (1 - discount));
            discDisplay = pct(discount);
            addFn = () => { Quote.addToQuote(r.partNumber, 1); render(); };
          }
          const repl = DataStore.getReplacement ? DataStore.getReplacement(r.partNumber) : null;
          const descCell = el('td', {}, r.description + (repl ? ` (replaced by ${repl.newPartNumber})` : ''));
          body.appendChild(el('tr', {}, [
            el('td', {}, r.partNumber),
            descCell,
            el('td', {}, DataStore.categoryDescription(r.category)),
            el('td', { class: 'num' }, listPriceDisplay),
            el('td', { class: 'num' }, netDisplay),
            el('td', { class: 'num' }, discDisplay),
            el('td', {}, el('button', { class: 'btn small secondary', onclick: addFn }, isTypeD ? 'Add Service' : 'Add')),
          ]));
        });
        document.getElementById('rowCount').textContent = `${rows.length} item(s)`;
      }

      render();
    });
  }

  // ---------------------------------------------------------------------
  // QUOTE BUILDER PAGE
  // ---------------------------------------------------------------------

  // Broad, best-effort PN-Type groupings used to filter model pickers.
  // These are UI convenience filters only — see wizard-node.js / wizard-
  // network.js header comments: the pricing math is correct regardless of
  // how permissive these filters are, since it always resolves through the
  // actual part number the user picked.
  const PNTYPES = {
    coCpe: ['PTMP CO', 'PTP', 'PTP TDM', 'PTP ML500', 'PTPR Fiber', 'PTPD Fiber',
      'PTP Bundle', 'PTMP Bundle', 'PTP ML620i CPE', 'PTP ML620i Bundle', 'PTP ML700 CO',
      'PTP ML700 CPE', 'PTP-D'],
    mlu: ['MLU'],
    sdu: ['SDU'],
    mounting: ['ML5xx Mounting', 'ML600 Mounting'],
    sfp: ['SFP'],
    acdc: ['PTP AC', 'PTP-D AC', 'PTP-D ACPOE', 'PTP ML620i AC', 'PTP ML650x AC', 'PTP ML700 AC'],
    acCable: ['AC Cable'],
    alarm: ['PTMP Alarm'],
    copper: ['ML600 Cable (No PFU)', 'CHS-2000B Cable'],
    pfu: ['PTMP PFU', 'PTP PFU'],
    pfuCable: ['PFU Cable', 'PFU Cable16'],
  };
  // Only offer parts that resolve to an actual price (current, type-D, or
  // archived) — AutoRepeaterInfo also lists some very old model variants
  // (superseded even in the archive) that would otherwise add as $0.00
  // "unknown part" lines.
  function priceable(rows) {
    return rows.filter(r => r.partNumber && DataStore.getPriceRow(r.partNumber));
  }
  function rowsByTypes(types) {
    return priceable(DataStore.raw.autoRepeaterInfo.filter(r => types.includes(r.pnType)))
      .sort((a, b) => a.description.localeCompare(b.description));
  }
  function allAriRows() {
    return priceable(DataStore.raw.autoRepeaterInfo).sort((a, b) => a.description.localeCompare(b.description));
  }

  // Which "Line Items" pill-tab is active — drives both the launcher grid
  // shown and what the big catalog search bar searches against.
  let currentLineItemsTab = 'hardware';
  let closeCatalogSearchFn = () => {};

  function initQuoteBuilderPage() {
    DataStore.load().then(() => {
      wireSessionBar();
      bindHeaderFields();
      populateTermsSelects();
      buildNodeWizard();
      buildNetworkWizard();
      buildEmsWizard();
      wireSiteControls();
      wireLineItemTabs();
      wireCatalogSearch();
      wireCustomAdd();
      wireFinancialOptions();
      wireServices();
      wireExportButtons();
      wireWizardModal();
      wireTopbar();
      wireAdminModal();
      wireReplacementsModal();

      onSessionChange = renderAll;
      renderAll();
    });
  }

  function renderAll() {
    renderSiteTabs();
    renderBOM();
    renderServicesTable();
    renderTotals();
    renderSummary();
    renderQuoteInfo();
  }

  // ---- Header fields ----
  function bindHeaderFields() {
    const map = {
      'q-quotationNumber': 'quotationNumber', 'q-customer': 'customer',
      'q-customerContact': 'customerContact', 'q-quotedBy': 'quotedBy',
      'q-date': 'date', 'q-expirationDate': 'expirationDate', 'q-comments': 'comments',
      'q-address': 'address', 'q-phone': 'phone', 'q-email': 'email',
    };
    Object.entries(map).forEach(([id, key]) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = Quote.header[key] || '';
      input.addEventListener('input', () => { Quote.header[key] = input.value; Quote.save(); renderSummary(); renderQuoteInfo(); });
    });

    const statusSel = document.getElementById('q-status');
    if (statusSel) {
      (DataStore.raw.quoteStatus || []).forEach(r => statusSel.appendChild(el('option', { value: r.name }, r.name)));
      statusSel.value = Quote.header.status || 'New';
      statusSel.addEventListener('change', () => { Quote.header.status = statusSel.value; Quote.save(); });
    }

    const salesTaxEnabled = document.getElementById('salesTaxEnabled');
    const salesTaxPct = document.getElementById('salesTaxPct');
    salesTaxEnabled.checked = !!Quote.session.salesTaxEnabled;
    salesTaxPct.value = (Quote.session.salesTaxPct || 0) * 100;
    salesTaxEnabled.addEventListener('change', () => { Quote.session.salesTaxEnabled = salesTaxEnabled.checked; Quote.save(); renderTotals(); renderSummary(); });
    salesTaxPct.addEventListener('input', () => { Quote.session.salesTaxPct = (parseFloat(salesTaxPct.value) || 0) / 100; Quote.save(); renderTotals(); renderSummary(); });
  }

  function populateTermsSelects() {
    const pay = document.getElementById('q-paymentTerms');
    const ship = document.getElementById('q-shippingTerms');
    (DataStore.raw.paymentTerms || []).forEach(r => pay.appendChild(el('option', { value: r.name }, r.name)));
    (DataStore.raw.shippingTerms || []).forEach(r => ship.appendChild(el('option', { value: r.name }, r.name)));
    pay.value = Quote.header.paymentTerms || '';
    ship.value = Quote.header.shippingTerms || '';
    pay.addEventListener('change', () => { Quote.header.paymentTerms = pay.value; Quote.save(); renderQuoteInfo(); });
    ship.addEventListener('change', () => { Quote.header.shippingTerms = ship.value; Quote.save(); renderQuoteInfo(); });
  }

  // Re-populates every form control from the current Quote state — used
  // after "New Quote" and after a successful PDF import, since both replace
  // the state wholesale rather than through the individual input handlers.
  function syncFormFieldsFromState() {
    const map = {
      'q-quotationNumber': 'quotationNumber', 'q-customer': 'customer',
      'q-customerContact': 'customerContact', 'q-quotedBy': 'quotedBy',
      'q-date': 'date', 'q-expirationDate': 'expirationDate', 'q-comments': 'comments',
      'q-address': 'address', 'q-phone': 'phone', 'q-email': 'email',
    };
    Object.entries(map).forEach(([id, key]) => { const inp = document.getElementById(id); if (inp) inp.value = Quote.header[key] || ''; });
    const statusSel = document.getElementById('q-status'); if (statusSel) statusSel.value = Quote.header.status || 'New';
    const pay = document.getElementById('q-paymentTerms'); if (pay) pay.value = Quote.header.paymentTerms || '';
    const ship = document.getElementById('q-shippingTerms'); if (ship) ship.value = Quote.header.shippingTerms || '';
    const ctSel = document.getElementById('customerType'); if (ctSel) ctSel.value = Quote.session.customerType;
    const regionSel = document.getElementById('region'); if (regionSel) regionSel.value = Quote.session.region;
    const dealChk = document.getElementById('dealRegistration'); if (dealChk) dealChk.checked = !!Quote.session.dealRegistration;
    const salesTaxEnabled = document.getElementById('salesTaxEnabled'); if (salesTaxEnabled) salesTaxEnabled.checked = !!Quote.session.salesTaxEnabled;
    const salesTaxPct = document.getElementById('salesTaxPct'); if (salesTaxPct) salesTaxPct.value = (Quote.session.salesTaxPct || 0) * 100;
    syncFinancialOptionCheckboxes();
  }

  // ---- Sites / BOM ----
  function renderSiteTabs() {
    const wrap = document.getElementById('siteTabs');
    wrap.innerHTML = '';
    Quote.sites.forEach((s, i) => {
      wrap.appendChild(el('button', {
        class: 'site-tab' + (i === Quote.activeSiteIndex ? ' active' : ''),
        onclick: () => { Quote.setActiveSite(i); renderAll(); },
      }, s.name));
    });
  }

  function renderBOM() {
    const site = Quote.activeSite();
    document.getElementById('activeSiteLabel').textContent = `${site.name} — Bill of Materials`;
    const body = document.getElementById('bomTableBody');
    body.innerHTML = '';
    site.lines.forEach(l => {
      const row = DataStore.getPriceRow(l.partNumber);
      const net = Quote.lineNetPrice(l);
      const descText = row ? row.description : (l.manual ? l.manualDescription : '(unknown part)');
      const descCell = el('td', {}, descText);
      const repl = DataStore.getReplacement ? DataStore.getReplacement(l.partNumber) : null;
      if (repl) {
        descCell.appendChild(el('div', { style: 'margin-top:4px' }, [
          el('span', { class: 'badge local', style: 'margin-right:6px' }, `Replaced by ${repl.newPartNumber}`),
          el('button', {
            class: 'btn tiny secondary',
            onclick: () => { Quote.removeLine(Quote.activeSiteIndex, l.partNumber); Quote.addToQuote(repl.newPartNumber, l.qty); renderAll(); },
          }, 'Swap'),
        ]));
      }
      body.appendChild(el('tr', {}, [
        el('td', {}, l.partNumber),
        descCell,
        el('td', { class: 'num' }, el('input', {
          type: 'number', min: '0', value: l.qty, style: 'width:70px;text-align:right',
          onchange: (e) => { Quote.setLineQty(Quote.activeSiteIndex, l.partNumber, parseFloat(e.target.value) || 0); renderAll(); },
        })),
        el('td', { class: 'num' }, money(net)),
        el('td', { class: 'num' }, money(net * l.qty)),
        el('td', {}, el('button', { class: 'btn small danger', onclick: () => { Quote.removeLine(Quote.activeSiteIndex, l.partNumber); renderAll(); } }, 'Remove')),
      ]));
    });
    document.getElementById('siteSubtotalCell').textContent = money(Quote.siteSubtotal(site));
  }

  function wireSiteControls() {
    document.getElementById('addSiteBtn').addEventListener('click', () => { Quote.addSite(); renderAll(); });
    document.getElementById('dupSiteBtn').addEventListener('click', () => { Quote.duplicateSite(); renderAll(); });
    document.getElementById('delSiteBtn').addEventListener('click', () => {
      if (Quote.sites.length <= 1) { alert('At least one site is required.'); return; }
      if (confirm('Delete the active site and all its line items?')) { Quote.deleteSite(Quote.activeSiteIndex); renderAll(); }
    });
  }

  // ---- Line Items: Hardware/Services tabs + catalog search + custom add ----
  function wireLineItemTabs() {
    const tabs = Array.from(document.querySelectorAll('#lineItemTabs .pill-tab'));
    tabs.forEach(btn => btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLineItemsTab = btn.dataset.tab;
      document.getElementById('hardwareLaunchers').style.display = currentLineItemsTab === 'hardware' ? '' : 'none';
      document.getElementById('servicesLaunchers').style.display = currentLineItemsTab === 'services' ? '' : 'none';
      const search = document.getElementById('catalogSearch');
      search.placeholder = currentLineItemsTab === 'hardware'
        ? '🔍 Search part #, description or category…'
        : '🔍 Search services, warranty or support plans…';
      search.value = '';
      closeCatalogSearchFn();
    }));
  }

  function computeSearchRows(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const source = currentLineItemsTab === 'hardware'
      ? DataStore.raw.priceList.filter(r => r.showPriceList !== false)
      : DataStore.raw.typeD;
    return source.filter(r => `${r.partNumber} ${r.description} ${r.category}`.toLowerCase().includes(q)).slice(0, 30);
  }

  function wireCatalogSearch() {
    const input = document.getElementById('catalogSearch');
    const resultsBox = document.getElementById('catalogSearchResults');
    function closeResults() { resultsBox.classList.remove('open'); resultsBox.innerHTML = ''; }
    closeCatalogSearchFn = closeResults;

    function renderResults() {
      const rows = computeSearchRows(input.value);
      resultsBox.innerHTML = '';
      if (!input.value.trim()) { closeResults(); return; }
      if (!rows.length) {
        resultsBox.appendChild(el('div', { class: 'search-result-empty' }, 'No matching items.'));
        resultsBox.classList.add('open');
        return;
      }
      const ctx = Quote.ctx();
      const isTypeD = currentLineItemsTab === 'services';
      rows.forEach(r => {
        const priceDisplay = isTypeD
          ? (Quote.isPercentTypeD(r) ? (r.listPriceString || '') : money(r.listPrice))
          : money(r.listPrice == null ? null : r.listPrice * (1 - (DataStore.getPriceRow(r.partNumber) ? DiscountEngine.getCustomerDiscount(r.partNumber, 1, ctx) : 0)));
        const repl = DataStore.getReplacement ? DataStore.getReplacement(r.partNumber) : null;
        resultsBox.appendChild(el('div', {
          class: 'search-result-row',
          onclick: () => {
            if (isTypeD) Quote.addService(r.partNumber); else Quote.addToQuote(r.partNumber, 1);
            input.value = ''; closeResults(); renderAll();
          },
        }, [
          el('div', { class: 'search-result-main' }, [
            el('div', { class: 'search-result-pn' }, r.partNumber + (repl ? ' ⚠ replaced' : '')),
            el('div', { class: 'search-result-desc' }, r.description),
          ]),
          el('div', { class: 'search-result-price' }, priceDisplay),
        ]));
      });
      resultsBox.classList.add('open');
    }
    input.addEventListener('input', debounce(renderResults, 120));
    input.addEventListener('focus', renderResults);
    document.addEventListener('click', (e) => { if (!resultsBox.contains(e.target) && e.target !== input) closeResults(); });
  }

  function wireCustomAdd() {
    const toggle = document.getElementById('customAddToggle');
    const form = document.getElementById('customAddForm');
    toggle.addEventListener('click', () => { form.style.display = form.style.display === 'none' ? '' : 'none'; });
    document.getElementById('customAddBtn').addEventListener('click', () => {
      const pn = document.getElementById('customPartNumber').value.trim() || ('CUSTOM-' + Date.now());
      const desc = document.getElementById('customDescription').value.trim() || 'Custom item';
      const price = parseFloat(document.getElementById('customPrice').value) || 0;
      const qty = parseFloat(document.getElementById('customQty').value) || 1;
      Quote.addManualLine(pn, desc, price, qty);
      document.getElementById('customPartNumber').value = '';
      document.getElementById('customDescription').value = '';
      document.getElementById('customPrice').value = '0';
      document.getElementById('customQty').value = '1';
      form.style.display = 'none';
      renderAll();
    });
  }

  // ---- Financial Options ----
  const FIN_CHECKBOX_MAP = { finShipping: 'shipping', finCreditCard: 'creditCard', finWarranty: 'extendedWarranty' };
  function wireFinancialOptions() {
    Object.entries(FIN_CHECKBOX_MAP).forEach(([id, key]) => {
      const chk = document.getElementById(id);
      if (!chk) return;
      chk.checked = !!Quote.session.financialOptions[key];
      chk.addEventListener('change', () => { Quote.setFinancialOption(key, chk.checked); renderAll(); });
    });
  }
  function syncFinancialOptionCheckboxes() {
    Object.entries(FIN_CHECKBOX_MAP).forEach(([id, key]) => {
      const chk = document.getElementById(id);
      if (chk) chk.checked = !!Quote.session.financialOptions[key];
    });
  }

  // ---- Services ----
  function wireServices() {
    const sel = document.getElementById('serviceSelect');
    if (sel) {
      DataStore.raw.typeD.forEach(r => sel.appendChild(el('option', { value: r.partNumber }, optionLabel(r))));
      const addBtn = document.getElementById('addServiceBtn');
      if (addBtn) addBtn.addEventListener('click', () => {
        const qty = parseFloat(document.getElementById('serviceQty').value) || 1;
        Quote.addService(sel.value, { qty });
        renderAll();
      });
    }
  }

  function renderServicesTable() {
    const body = document.getElementById('servicesTableBody');
    body.innerHTML = '';
    const bom = Quote.bomSubtotal();
    Quote.services.forEach((s, i) => {
      const amount = s.isPercent ? s.percent * bom * (s.qty || 1) : (s.manualPrice || 0) * (s.qty || 1);
      body.appendChild(el('tr', {}, [
        el('td', {}, s.partNumber),
        el('td', {}, s.description),
        el('td', { class: 'num' }, String(s.qty)),
        el('td', { class: 'num' }, money(amount)),
        el('td', {}, el('button', { class: 'btn small danger', onclick: () => { Quote.removeService(i); renderAll(); } }, 'Remove')),
      ]));
    });
  }

  // ---- Totals / Summary sidebar ----
  function renderTotals() {
    const t = Quote.totals();
    const body = document.getElementById('totalsBody');
    if (!body) return;
    body.innerHTML = '';
    const row = (label, value, cls) => el('tr', cls ? { class: cls } : {}, [el('td', {}, label), el('td', { class: 'num' }, value)]);
    body.appendChild(row('BOM Subtotal', money(t.bom)));
    body.appendChild(row('Services / Warranty Subtotal', money(t.svc)));
    if (Quote.session.salesTaxEnabled) {
      body.appendChild(row('Subtotal (before tax)', money(t.priceNoTax)));
      body.appendChild(row('Sales Tax', money(t.salesTax)));
    }
    body.appendChild(row(t.labels.totalIncl, money(t.totalPrice), 'grand-total'));
  }

  function renderSummary() {
    const badge = document.getElementById('summaryBadge');
    if (!badge) return; // this page has no summary sidebar
    badge.textContent = `${Quote.session.region} · ${Quote.session.customerType}`;
    const custEl = document.getElementById('summaryCustomer');
    custEl.textContent = Quote.header.customer ? Quote.header.customer : 'No customer yet';
    const totalLineItems = Quote.sites.reduce((s, site) => s + site.lines.length, 0) + Quote.services.length;
    document.getElementById('summaryLineItems').textContent = String(totalLineItems);
    let listTotal = 0;
    Quote.sites.forEach(site => site.lines.forEach(l => {
      const row = DataStore.getPriceRow(l.partNumber);
      const lp = row ? row.listPrice : (l.manual ? l.manualPrice : 0);
      listTotal += (lp || 0) * l.qty;
    }));
    document.getElementById('summaryListTotal').textContent = money(listTotal);
    document.getElementById('summaryHwSubtotal').textContent = money(Quote.bomSubtotal());
    document.getElementById('summaryGrandTotal').textContent = money(Quote.totals().totalPrice);
  }

  function renderQuoteInfo() {
    const el2 = document.getElementById('qiDate');
    if (!el2) return;
    document.getElementById('qiDate').textContent = Quote.header.date || '—';
    document.getElementById('qiExpires').textContent = Quote.header.expirationDate || '—';
    document.getElementById('qiPayment').textContent = Quote.header.paymentTerms || '—';
    document.getElementById('qiShipping').textContent = Quote.header.shippingTerms || '—';
  }

  // ---- Export ----
  function wireExportButtons() {
    const csvBtn = document.getElementById('exportCsvBtn');
    if (csvBtn) csvBtn.addEventListener('click', () => Export.downloadCSV());
    const xlsxBtn = document.getElementById('exportExcelBtn');
    if (xlsxBtn) xlsxBtn.addEventListener('click', () => Export.downloadXLSX());
    const pdfBtn = document.getElementById('exportPdfBtn');
    if (pdfBtn) pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true; const orig = pdfBtn.textContent; pdfBtn.textContent = 'Generating…';
      try { await PdfExport.downloadPdf(); }
      catch (e) { alert('Could not generate the PDF: ' + e.message); }
      finally { pdfBtn.disabled = false; pdfBtn.textContent = orig; }
    });
    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', () => Export.printQuote());
    const resetBtn = document.getElementById('resetQuoteBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (confirm('Clear the entire quote (all sites, BOM lines, and services)? This cannot be undone.')) {
        Quote.reset();
        syncFormFieldsFromState();
        renderAll();
      }
    });
  }

  // ---- Top bar: New Quote / Import PDF / Admin / Replacements ----
  function wireTopbar() {
    const newQuoteBtn = document.getElementById('newQuoteBtn');
    if (newQuoteBtn) newQuoteBtn.addEventListener('click', () => {
      if (confirm('Start a new quote? This clears all sites, BOM lines, services and quote details.')) {
        Quote.reset();
        syncFormFieldsFromState();
        renderAll();
      }
    });

    const importInput = document.getElementById('importPdfInput');
    const importBtn = document.getElementById('importPdfBtn');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', async () => {
        const file = importInput.files[0];
        importInput.value = '';
        if (!file) return;
        try {
          const state = await PdfExport.parseFile(file);
          if (!state) {
            alert('This PDF does not contain Actelis quote data that this tool recognizes (it may not have been exported by this tool).');
            return;
          }
          Quote.loadFromState(state);
          syncFormFieldsFromState();
          renderAll();
        } catch (e) {
          alert('Could not read that PDF: ' + e.message);
        }
      });
    }

    const adminBtn = document.getElementById('adminNavBtn');
    if (adminBtn) adminBtn.addEventListener('click', () => openAdminModal());
    const replBtn = document.getElementById('replacementsNavBtn');
    if (replBtn) replBtn.addEventListener('click', () => openReplacementsModal());

    const metaEl = document.getElementById('priceListMeta');
    if (metaEl && DataStore.meta) {
      const m = DataStore.meta;
      metaEl.textContent = (m.priceListVersion || m.priceListDate)
        ? `Price list ${m.priceListVersion || ''} · ${m.priceListDate || ''}`.trim()
        : 'Price list — bundled with this site';
    }
  }

  // ---- Wizard modal (Node / Network / EMS launched from Line Items cards) ----
  function wireWizardModal() {
    const overlay = document.getElementById('wizardModalOverlay');
    if (!overlay) return;
    const titleEl = document.getElementById('wizardModalTitle');
    const titles = { node: 'Node Configurator Wizard', network: 'Network / Repeater Configurator', ems: 'EMS Licensing Wizard' };
    function open(kind) {
      titleEl.textContent = titles[kind] || 'Configurator Wizard';
      ['nodeWizard', 'networkWizard', 'emsWizard'].forEach(id => {
        const node = document.getElementById(id);
        if (node) node.style.display = (id === kind + 'Wizard') ? '' : 'none';
      });
      overlay.classList.add('open');
    }
    function close() { overlay.classList.remove('open'); }
    document.querySelectorAll('.launcher-launch').forEach(btn => btn.addEventListener('click', () => open(btn.dataset.wizard)));
    const closeBtn = document.getElementById('wizardModalClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  // -----------------------------------------------------------------------
  // ADMIN — Price List Manager modal
  // -----------------------------------------------------------------------
  let adminHardwareResult = null;
  let adminDiscountResult = null;

  function setAdminStep(n) {
    document.querySelectorAll('#adminSteps .step-item').forEach(item => {
      const s = parseInt(item.dataset.step, 10);
      item.classList.toggle('active', s === n);
      item.classList.toggle('done', s < n);
    });
  }

  function openAdminModal() {
    setAdminStep(1);
    document.getElementById('adminDownloadBtn').disabled = true;
    document.getElementById('hardwarePreview').innerHTML = '';
    document.getElementById('discountPreview').innerHTML = '';
    adminHardwareResult = null; adminDiscountResult = null;
    document.getElementById('adminModalOverlay').classList.add('open');
  }
  function closeAdminModal() { document.getElementById('adminModalOverlay').classList.remove('open'); }

  function wireAdminModal() {
    const overlay = document.getElementById('adminModalOverlay');
    if (!overlay) return;
    document.getElementById('adminModalClose').addEventListener('click', closeAdminModal);
    document.getElementById('adminCancelBtn').addEventListener('click', closeAdminModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAdminModal(); });

    const tabs = Array.from(document.querySelectorAll('.admin-tab'));
    tabs.forEach(btn => btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.admintab;
      document.getElementById('adminHardwarePane').style.display = tab === 'hardware' ? '' : 'none';
      document.getElementById('adminDiscountPane').style.display = tab === 'discount' ? '' : 'none';
      document.getElementById('adminDownloadBtn').disabled = tab === 'hardware' ? !adminHardwareResult : !adminDiscountResult;
    }));

    wireDropzone('hardwareDropzone', 'hardwareFileInput', async (file) => {
      try {
        setAdminStep(2);
        const rawRows = await Admin.readFileAsRows(file);
        const { hardware, typeD, skipped } = Admin.parseHardwareRows(rawRows);
        const hardwareMerged = Admin.mergeHardware(hardware);
        const typeDMerged = Admin.mergeTypeD(typeD);
        const diffHw = Admin.diffByPartNumber(DataStore.raw.priceList, hardwareMerged, ['description', 'category', 'listPrice']);
        const diffTd = Admin.diffByPartNumber(DataStore.raw.typeD, typeDMerged, ['description', 'category', 'listPriceString', 'listPrice']);
        const container = document.getElementById('hardwarePreview');
        container.innerHTML = '';
        container.appendChild(el('h4', {}, `Hardware / Price List (A/B/C) — ${hardwareMerged.length} rows`));
        const hwDiffBox = el('div'); container.appendChild(hwDiffBox);
        Admin.renderDiffSummary(hwDiffBox, diffHw, 'Part Number');
        container.appendChild(el('h4', { style: 'margin-top:18px' }, `Services / Warranty (Type D) — ${typeDMerged.length} rows`));
        const tdDiffBox = el('div'); container.appendChild(tdDiffBox);
        Admin.renderDiffSummary(tdDiffBox, diffTd, 'Part Number');
        if (skipped.length) container.appendChild(el('p', { style: 'color:var(--text-muted);font-size:12px;margin-top:10px' }, `${skipped.length} row(s) skipped (missing Category or Part Number).`));
        adminHardwareResult = { hardwareMerged, typeDMerged };
        if (document.querySelector('.admin-tab.active').dataset.admintab === 'hardware') document.getElementById('adminDownloadBtn').disabled = false;
        setAdminStep(3);
      } catch (e) {
        alert('Could not parse that file: ' + e.message);
      }
    });

    wireDropzone('discountDropzone', 'discountFileInput', async (file) => {
      try {
        setAdminStep(2);
        const rawRows = await Admin.readFileAsRows(file);
        const discountRows = Admin.parseDiscountRows(rawRows);
        const diff = Admin.diffByPartNumber(
          DataStore.raw.discounts.map(r => ({ partNumber: r.category, ...r })),
          discountRows.map(r => ({ partNumber: r.category, ...r })),
          ['categoryType', 'discount', 'discountEndUser', 'registrationDiscount', 'discountEMEA', 'discountEndUserEMEA', 'warranty']
        );
        const container = document.getElementById('discountPreview');
        container.innerHTML = '';
        container.appendChild(el('h4', {}, `Discount Table — ${discountRows.length} rows`));
        const box = el('div'); container.appendChild(box);
        Admin.renderDiffSummary(box, diff, 'Category');
        adminDiscountResult = discountRows;
        if (document.querySelector('.admin-tab.active').dataset.admintab === 'discount') document.getElementById('adminDownloadBtn').disabled = false;
        setAdminStep(3);
      } catch (e) {
        alert('Could not parse that file: ' + e.message);
      }
    });

    document.getElementById('adminDownloadBtn').addEventListener('click', () => {
      const activeTab = document.querySelector('.admin-tab.active').dataset.admintab;
      if (activeTab === 'hardware' && adminHardwareResult) {
        Admin.downloadJSON('price-list.json', adminHardwareResult.hardwareMerged);
        Admin.downloadJSON('price-list-type-d.json', adminHardwareResult.typeDMerged);
      } else if (activeTab === 'discount' && adminDiscountResult) {
        Admin.downloadJSON('discounts.json', adminDiscountResult);
      }
      setAdminStep(4);
    });
  }

  // -----------------------------------------------------------------------
  // Replacements Manager modal
  // -----------------------------------------------------------------------
  let replacementsList = [];

  function renderReplacementsTable() {
    const body = document.getElementById('replacementsTableBody');
    body.innerHTML = '';
    replacementsList.forEach((r, i) => {
      body.appendChild(el('tr', {}, [
        el('td', {}, r.oldPartNumber),
        el('td', {}, r.newPartNumber),
        el('td', {}, r.notes || ''),
        el('td', {}, el('button', {
          class: 'btn small danger',
          onclick: () => { replacementsList.splice(i, 1); renderReplacementsTable(); },
        }, 'Remove')),
      ]));
    });
  }

  function openReplacementsModal() {
    replacementsList = (DataStore.raw.replacements || []).map(r => ({ ...r }));
    renderReplacementsTable();
    document.getElementById('replacementsModalOverlay').classList.add('open');
  }
  function closeReplacementsModal() { document.getElementById('replacementsModalOverlay').classList.remove('open'); }

  function wireReplacementsModal() {
    const overlay = document.getElementById('replacementsModalOverlay');
    if (!overlay) return;
    document.getElementById('replacementsModalClose').addEventListener('click', closeReplacementsModal);
    document.getElementById('replacementsCancelBtn').addEventListener('click', closeReplacementsModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeReplacementsModal(); });

    document.getElementById('replAddRowBtn').addEventListener('click', () => {
      const oldPn = document.getElementById('replOldPn').value.trim();
      const newPn = document.getElementById('replNewPn').value.trim();
      if (!oldPn || !newPn) { alert('Both Old and New part numbers are required.'); return; }
      replacementsList = replacementsList.filter(r => r.oldPartNumber !== oldPn);
      replacementsList.push({ oldPartNumber: oldPn, newPartNumber: newPn, notes: '' });
      document.getElementById('replOldPn').value = ''; document.getElementById('replNewPn').value = '';
      renderReplacementsTable();
    });

    wireDropzone('replacementsDropzone', 'replacementsFileInput', async (file) => {
      try {
        const rawRows = await Admin.readFileAsRows(file);
        const parsed = Admin.parseReplacementRows(rawRows);
        const byOld = new Map(replacementsList.map(r => [r.oldPartNumber, r]));
        parsed.forEach(p => byOld.set(p.oldPartNumber, p));
        replacementsList = Array.from(byOld.values());
        renderReplacementsTable();
      } catch (e) { alert('Could not parse that file: ' + e.message); }
    });

    document.getElementById('replacementsDownloadBtn').addEventListener('click', () => {
      Admin.downloadJSON('replacements.json', replacementsList);
    });
  }

  // -----------------------------------------------------------------------
  // Node Configurator wizard UI
  // -----------------------------------------------------------------------
  function buildNodeWizard() {
    const root = document.getElementById('nodeWizard');
    root.innerHTML = '';

    const coModelInput = el('input', { type: 'text', list: 'nodeCoModelList' });
    const coModelList = el('datalist', { id: 'nodeCoModelList' });
    fillDatalist(coModelList, rowsByTypes(PNTYPES.coCpe).length ? rowsByTypes(PNTYPES.coCpe) : allAriRows());

    const coQuantity = el('input', { type: 'number', min: '1', value: '1' });
    const craftCable = el('input', { type: 'checkbox' });
    const bundles = el('input', { type: 'checkbox' });
    const mluModelSel = el('select'); fillSelect(mluModelSel, rowsByTypes(PNTYPES.mlu), { none: '— None —' });
    const mluQtySel = el('select'); [1, 2, 3, 4].forEach(n => mluQtySel.appendChild(el('option', { value: n }, String(n))));
    const sduModelSel = el('select'); fillSelect(sduModelSel, rowsByTypes(PNTYPES.sdu), { none: '— None —' });
    const sduRedundancy = el('input', { type: 'checkbox' });
    const coPoweringSel = el('select', {}, [el('option', { value: 'AC' }, 'AC'), el('option', { value: 'DC' }, 'DC')]);
    const acdcModelSel = el('select'); fillSelect(acdcModelSel, rowsByTypes(PNTYPES.acdc), { none: '— None —' });
    const acCableSel = el('select'); fillSelect(acCableSel, rowsByTypes(PNTYPES.acCable), { none: '— None —' });
    const codcPower = el('input', { type: 'checkbox' });
    const alarmCableSel = el('select'); fillSelect(alarmCableSel, rowsByTypes(PNTYPES.alarm), { none: '— None —' });
    const mountingKit = el('input', { type: 'checkbox' });
    const mountingModelSel = el('select'); fillSelect(mountingModelSel, rowsByTypes(PNTYPES.mounting), { none: '— None —' });
    const coSfpModelSel = el('select'); fillSelect(coSfpModelSel, rowsByTypes(PNTYPES.sfp), { none: '— None —' });
    const sfpQuantity = el('input', { type: 'number', min: '1', value: '1' });
    const coFiberCableInput = el('input', { type: 'text', list: 'nodeFiberCableList' });
    const coFiberCableList = el('datalist', { id: 'nodeFiberCableList' });
    fillDatalist(coFiberCableList, allAriRows());
    const coCopperCableSel = el('select'); fillSelect(coCopperCableSel, rowsByTypes(PNTYPES.copper), { none: '— None —' });
    const ptmpCopperCables = el('input', { type: 'checkbox' });
    const cableTypeSel = el('select', {}, [el('option', { value: 'US Color Code (ft)' }, 'US Color Code (ft)'), el('option', { value: 'EU Color Code (m)' }, 'EU Color Code (m)')]);
    const cableLength = el('input', { type: 'text', placeholder: 'e.g. 25' });
    const mleExt = el('input', { type: 'checkbox' });

    const classifyInfo = el('div', { class: 'notice info', style: 'display:none' });

    function field(labelText, input, extra) {
      return el('div', { class: 'field' }, [el('label', {}, labelText), input, extra].filter(Boolean));
    }
    function checkboxField(labelText, input) {
      return el('div', { class: 'checkbox-field' }, [input, el('label', {}, labelText)]);
    }

    root.appendChild(el('div', {}, [
      classifyInfo,
      el('div', { class: 'two-col' }, [
        field('CO / Node Model', coModelInput, coModelList),
        field('Quantity', coQuantity),
      ]),
      checkboxField('Include craft cable', craftCable),
      checkboxField('Use PTMP bundle (if a matching bundle exists for chassis+SDU+MLU)', bundles),
      el('div', { class: 'two-col' }, [field('MLU Model (chassis only)', mluModelSel), field('MLU Qty per shelf', mluQtySel)]),
      el('div', { class: 'two-col' }, [field('SDU Model (chassis only)', sduModelSel), checkboxField('SDU Redundancy', sduRedundancy)]),
      el('div', { class: 'two-col' }, [field('CO Powering', coPoweringSel), field('AC/DC Adapter Model', acdcModelSel)]),
      el('div', { class: 'two-col' }, [field('AC Cable', acCableSel), checkboxField('Include DC power cable', codcPower)]),
      el('div', { class: 'two-col' }, [field('Alarm Cable (chassis only)', alarmCableSel), checkboxField('Include mounting kit', mountingKit)]),
      field('Mounting Kit Model', mountingModelSel),
      el('div', { class: 'two-col' }, [field('CO SFP Model', coSfpModelSel), field('SFP Quantity', sfpQuantity)]),
      field('CO Fiber Cable', coFiberCableInput, coFiberCableList),
      field('CO Copper Cable (ML500/600/700)', coCopperCableSel),
      checkboxField('Include PTMP copper (MLU) cables', ptmpCopperCables),
      el('div', { class: 'two-col' }, [field('Cable Type', cableTypeSel), field('Cable Length', cableLength)]),
      checkboxField('Add TDM/MLE-16E extension', mleExt),
    ]));

    let lastClassified = null;
    coModelInput.addEventListener('change', () => {
      const pn = parsePN(coModelInput.value);
      if (pn && DataStore.raw.autoRepeaterInfo.some(r => r.partNumber === pn)) {
        lastClassified = NodeWizard.classify(pn);
        classifyInfo.style.display = '';
        classifyInfo.textContent = `Recognized as: ${lastClassified.ptmpType} / ${lastClassified.ptmpModel}`;
      } else {
        lastClassified = null;
        classifyInfo.style.display = 'none';
      }
    });

    const templateBar = buildTemplateBar('node', () => collectState(), (state) => applyState(state));
    root.appendChild(templateBar);

    const addBtn = el('button', { class: 'btn', style: 'margin-top:12px' }, 'Add to Quote');
    const errBox = el('div', { class: 'notice', style: 'display:none;margin-top:10px' });
    root.appendChild(errBox);
    root.appendChild(addBtn);

    function collectState() {
      return {
        coModel: parsePN(coModelInput.value),
        coQuantity: parseFloat(coQuantity.value) || 1,
        craftCable: craftCable.checked,
        bundles: bundles.checked,
        mluModel: mluModelSel.value,
        mluQty: parseInt(mluQtySel.value, 10) || 1,
        sduModel: sduModelSel.value,
        sduRedundancy: sduRedundancy.checked,
        coPowering: coPoweringSel.value,
        acdcModel: acdcModelSel.value,
        acCable: acCableSel.value,
        codcPower: codcPower.checked,
        alarmCable: alarmCableSel.value,
        mountingKit: mountingKit.checked,
        mountingModel: mountingModelSel.value,
        coSfpModel: coSfpModelSel.value,
        sfpQuantity: parseFloat(sfpQuantity.value) || 1,
        coFiberCable: parsePN(coFiberCableInput.value) || 'None',
        coCopperCable: coCopperCableSel.value,
        ptmpCopperCables: ptmpCopperCables.checked,
        cableType: cableTypeSel.value,
        cableLength: cableLength.value,
        mleExt: mleExt.checked,
      };
    }
    function applyState(state) {
      coModelInput.value = state.coModel || '';
      coQuantity.value = state.coQuantity || 1;
      craftCable.checked = !!state.craftCable;
      bundles.checked = !!state.bundles;
      mluModelSel.value = state.mluModel || 'None';
      mluQtySel.value = state.mluQty || 1;
      sduModelSel.value = state.sduModel || 'None';
      sduRedundancy.checked = !!state.sduRedundancy;
      coPoweringSel.value = state.coPowering || 'AC';
      acdcModelSel.value = state.acdcModel || 'None';
      acCableSel.value = state.acCable || 'None';
      codcPower.checked = !!state.codcPower;
      alarmCableSel.value = state.alarmCable || 'None';
      mountingKit.checked = !!state.mountingKit;
      mountingModelSel.value = state.mountingModel || 'None';
      coSfpModelSel.value = state.coSfpModel || 'None';
      sfpQuantity.value = state.sfpQuantity || 1;
      coFiberCableInput.value = state.coFiberCable && state.coFiberCable !== 'None' ? state.coFiberCable : '';
      coCopperCableSel.value = state.coCopperCable || 'None';
      ptmpCopperCables.checked = !!state.ptmpCopperCables;
      cableTypeSel.value = state.cableType || 'US Color Code (ft)';
      cableLength.value = state.cableLength || '';
      mleExt.checked = !!state.mleExt;
      coModelInput.dispatchEvent(new Event('change'));
    }

    addBtn.addEventListener('click', () => {
      const state = collectState();
      errBox.style.display = 'none';
      if (!state.coModel || !DataStore.raw.autoRepeaterInfo.some(r => r.partNumber === state.coModel)) {
        errBox.textContent = 'Please pick a valid CO/Node model from the list.';
        errBox.style.display = '';
        return;
      }
      const classified = NodeWizard.classify(state.coModel);
      try {
        const note = NodeWizard.apply(state, classified, Quote.activeSiteIndex);
        renderAll();
        errBox.className = 'notice info';
        errBox.textContent = 'Added to quote. ' + note;
        errBox.style.display = '';
      } catch (e) {
        errBox.className = 'notice';
        errBox.textContent = e.message;
        errBox.style.display = '';
      }
    });
  }

  // -----------------------------------------------------------------------
  // Network / Repeater Configurator wizard UI
  // -----------------------------------------------------------------------
  function buildNetworkWizard() {
    const root = document.getElementById('networkWizard');
    root.innerHTML = '';

    function field(labelText, input, extra) {
      return el('div', { class: 'field' }, [el('label', {}, labelText), input, extra].filter(Boolean));
    }
    function checkboxField(labelText, input) {
      return el('div', { class: 'checkbox-field' }, [input, el('label', {}, labelText)]);
    }
    function searchField(labelText, listId, rows) {
      const input = el('input', { type: 'text', list: listId });
      const dl = el('datalist', { id: listId });
      fillDatalist(dl, rows);
      return { wrap: field(labelText, input, dl), input };
    }

    const configTypeSel = el('select', {}, [el('option', { value: 'PTP' }, 'Point-to-Point (PTP)'), el('option', { value: 'PTMP' }, 'Point-to-Multipoint (PTMP)')]);
    const co = searchField('CO Model', 'netCoModelList', rowsByTypes(PNTYPES.coCpe).length ? rowsByTypes(PNTYPES.coCpe) : allAriRows());
    const cpe = searchField('CPE Model', 'netCpeModelList', rowsByTypes(PNTYPES.coCpe).length ? rowsByTypes(PNTYPES.coCpe) : allAriRows());
    const coQuantity = el('input', { type: 'number', min: '1', value: '1' });
    const numLinks = el('input', { type: 'number', min: '1', value: '1' });
    const craftCable = el('input', { type: 'checkbox' });
    const bundles = el('input', { type: 'checkbox' });
    const mluModelSel = el('select'); fillSelect(mluModelSel, rowsByTypes(PNTYPES.mlu), { none: '— None —' });
    const mluQtySel = el('select'); [1, 2, 3, 4].forEach(n => mluQtySel.appendChild(el('option', { value: n }, String(n))));
    const sduModelSel = el('select'); fillSelect(sduModelSel, rowsByTypes(PNTYPES.sdu), { none: '— None —' });
    const sduRedundancy = el('input', { type: 'checkbox' });
    const mleExt = el('input', { type: 'checkbox' });
    const coPoweringSel = el('select', {}, [el('option', { value: 'AC' }, 'AC'), el('option', { value: 'DC' }, 'DC')]);
    const cpePoweringSel = el('select', {}, [el('option', { value: 'AC' }, 'AC'), el('option', { value: 'DC' }, 'DC')]);
    const acdcModelSel = el('select'); fillSelect(acdcModelSel, rowsByTypes(PNTYPES.acdc), { none: '— None —' });
    const acCableSel = el('select'); fillSelect(acCableSel, rowsByTypes(PNTYPES.acCable), { none: '— None —' });
    const codcPower = el('input', { type: 'checkbox' });
    const cpeDcPower = el('input', { type: 'checkbox' });

    const repeaterConfig = el('input', { type: 'checkbox' });
    const pfuModelSel = el('select'); fillSelect(pfuModelSel, rowsByTypes(PNTYPES.pfu), { none: '— None —' });
    const repeaterHops = el('input', { type: 'number', min: '1', value: '1' });
    const numPairs = el('input', { type: 'number', min: '1', value: '8' });
    const adapter = searchField('Adapter Model (repeater cross-connect; leave blank for a standalone repeater)', 'netAdapterList', allAriRows());
    const repeater = searchField('Repeater Model', 'netRepeaterList', allAriRows());
    const pfuDcCable = el('input', { type: 'checkbox' });
    const pfuCableLengthSel = el('select'); fillSelect(pfuCableLengthSel, rowsByTypes(PNTYPES.pfuCable), { none: '— None —' });

    const mountingKitSel = el('select');
    const mountingModelSel = el('select'); fillSelect(mountingModelSel, rowsByTypes(PNTYPES.mounting), { none: '— None —' });
    function refreshMountingOptions() {
      const opts = configTypeSel.value === 'PTP'
        ? ['None', 'CPE Only', 'CO Only', 'CO and CPE']
        : ['None', 'CPE Only', 'CO Only', 'CO Only (For PFU)', 'CO (For PFU) and CPE', 'CO and CPE'];
      mountingKitSel.innerHTML = '';
      opts.forEach(o => mountingKitSel.appendChild(el('option', { value: o }, o)));
    }
    refreshMountingOptions();
    configTypeSel.addEventListener('change', refreshMountingOptions);

    const coSfpModelSel = el('select'); fillSelect(coSfpModelSel, rowsByTypes(PNTYPES.sfp), { none: '— None —' });
    const sfpQuantity = el('input', { type: 'number', min: '1', value: '1' });
    const cpeSfpModelSel = el('select'); fillSelect(cpeSfpModelSel, rowsByTypes(PNTYPES.sfp), { none: '— None —' });
    const cpeSfpQuantity = el('input', { type: 'number', min: '1', value: '1' });
    const copperCableSel = el('select'); fillSelect(copperCableSel, rowsByTypes(PNTYPES.copper), { none: '— None —' });
    const coCopperCableSel = el('select'); fillSelect(coCopperCableSel, rowsByTypes(PNTYPES.copper), { none: '— None —' });
    const cableTypeSel = el('select', {}, [el('option', { value: 'US Color Code (ft)' }, 'US Color Code (ft)'), el('option', { value: 'EU Color Code (m)' }, 'EU Color Code (m)')]);
    const cableLength = el('input', { type: 'text', placeholder: 'e.g. 25' });
    const alarmCableSel = el('select'); fillSelect(alarmCableSel, rowsByTypes(PNTYPES.alarm), { none: '— None —' });

    const classifyInfo = el('div', { class: 'notice info', style: 'display:none' });

    root.appendChild(el('div', {}, [
      classifyInfo,
      el('div', { class: 'two-col' }, [field('Configuration Type', configTypeSel), field('Number of Links', numLinks)]),
      el('div', { class: 'two-col' }, [co.wrap, cpe.wrap]),
      field('Quantity (CO shelves)', coQuantity),
      checkboxField('Include craft cable', craftCable),
      checkboxField('Use PTMP bundle (chassis configs)', bundles),
      el('div', { class: 'two-col' }, [field('MLU Model (chassis)', mluModelSel), field('MLU Qty per shelf', mluQtySel)]),
      el('div', { class: 'two-col' }, [field('SDU Model (chassis)', sduModelSel), checkboxField('SDU Redundancy', sduRedundancy)]),
      checkboxField('Add TDM/MLE-16E extension', mleExt),
      el('h4', {}, 'Powering'),
      el('div', { class: 'two-col' }, [field('CO Powering', coPoweringSel), field('CPE Powering', cpePoweringSel)]),
      el('div', { class: 'two-col' }, [field('AC/DC Adapter Model', acdcModelSel), field('AC Cable', acCableSel)]),
      el('div', { class: 'two-col' }, [checkboxField('CO DC power cable', codcPower), checkboxField('CPE DC power cable', cpeDcPower)]),
      el('h4', {}, 'Repeater / PFU'),
      checkboxField('This link uses repeaters (PFU)', repeaterConfig),
      el('div', { class: 'two-col' }, [field('PFU Model', pfuModelSel), field('Repeater Hops', repeaterHops)]),
      el('div', { class: 'two-col' }, [field('Number of Pairs', numPairs), checkboxField('PFU DC power cable', pfuDcCable)]),
      adapter.wrap, repeater.wrap,
      field('PFU Monitor / Cable Model', pfuCableLengthSel),
      el('h4', {}, 'Mounting'),
      el('div', { class: 'two-col' }, [field('Mounting Kit Type', mountingKitSel), field('Mounting Kit Model', mountingModelSel)]),
      el('h4', {}, 'SFP / Fiber / Copper'),
      el('div', { class: 'two-col' }, [field('CO SFP Model', coSfpModelSel), field('CO SFP Qty', sfpQuantity)]),
      el('div', { class: 'two-col' }, [field('CPE SFP Model', cpeSfpModelSel), field('CPE SFP Qty', cpeSfpQuantity)]),
      el('div', { class: 'two-col' }, [field('Copper Cable (CPE side / chassis)', copperCableSel), field('CO Copper Cable', coCopperCableSel)]),
      el('div', { class: 'two-col' }, [field('Cable Type', cableTypeSel), field('Cable Length', cableLength)]),
      field('Alarm Cable (chassis)', alarmCableSel),
    ]));

    function updateClassifyInfo() {
      const pn = parsePN(co.input.value);
      if (pn && DataStore.raw.autoRepeaterInfo.some(r => r.partNumber === pn)) {
        const c = NodeWizard.classify(pn);
        classifyInfo.style.display = '';
        classifyInfo.textContent = `CO recognized as: ${c.ptmpType} / ${c.ptmpModel}`;
      } else {
        classifyInfo.style.display = 'none';
      }
    }
    co.input.addEventListener('change', updateClassifyInfo);

    root.appendChild(buildTemplateBar('network', () => collectState(), (state) => applyState(state)));

    const addBtn = el('button', { class: 'btn', style: 'margin-top:12px' }, 'Add to Quote');
    const errBox = el('div', { class: 'notice', style: 'display:none;margin-top:10px' });
    root.appendChild(errBox);
    root.appendChild(addBtn);

    function collectState() {
      return {
        configType: configTypeSel.value,
        coModel: parsePN(co.input.value),
        cpeModel: parsePN(cpe.input.value),
        coQuantity: parseFloat(coQuantity.value) || 1,
        numLinks: parseFloat(numLinks.value) || 1,
        craftCable: craftCable.checked,
        bundles: bundles.checked,
        mluModel: mluModelSel.value,
        mluQty: parseInt(mluQtySel.value, 10) || 1,
        sduModel: sduModelSel.value,
        sduRedundancy: sduRedundancy.checked,
        mleExt: mleExt.checked,
        coPowering: coPoweringSel.value,
        cpePowering: cpePoweringSel.value,
        acdcModel: acdcModelSel.value,
        acCable: acCableSel.value,
        codcPower: codcPower.checked,
        cpeDcPower: cpeDcPower.checked,
        repeaterConfig: repeaterConfig.checked,
        pfuModel: pfuModelSel.value,
        repeaterHops: parseFloat(repeaterHops.value) || 1,
        numPairs: parseFloat(numPairs.value) || 8,
        adapterModel: parsePN(adapter.input.value) || 'None',
        repeaterModel: parsePN(repeater.input.value) || 'None',
        pfuDcCable: pfuDcCable.checked,
        pfuCableLength: pfuCableLengthSel.value,
        mountingKit: mountingKitSel.value,
        mountingModel: mountingModelSel.value,
        coSfpModel: coSfpModelSel.value,
        sfpQuantity: parseFloat(sfpQuantity.value) || 1,
        cpeSfpModel: cpeSfpModelSel.value,
        cpeSfpQuantity: parseFloat(cpeSfpQuantity.value) || 1,
        copperCable: copperCableSel.value,
        coCopperCable: coCopperCableSel.value,
        cableType: cableTypeSel.value,
        cableLength: cableLength.value,
        alarmCable: alarmCableSel.value,
      };
    }
    function applyState(s) {
      configTypeSel.value = s.configType || 'PTP'; refreshMountingOptions();
      co.input.value = s.coModel || '';
      cpe.input.value = s.cpeModel || '';
      coQuantity.value = s.coQuantity || 1;
      numLinks.value = s.numLinks || 1;
      craftCable.checked = !!s.craftCable;
      bundles.checked = !!s.bundles;
      mluModelSel.value = s.mluModel || 'None';
      mluQtySel.value = s.mluQty || 1;
      sduModelSel.value = s.sduModel || 'None';
      sduRedundancy.checked = !!s.sduRedundancy;
      mleExt.checked = !!s.mleExt;
      coPoweringSel.value = s.coPowering || 'AC';
      cpePoweringSel.value = s.cpePowering || 'AC';
      acdcModelSel.value = s.acdcModel || 'None';
      acCableSel.value = s.acCable || 'None';
      codcPower.checked = !!s.codcPower;
      cpeDcPower.checked = !!s.cpeDcPower;
      repeaterConfig.checked = !!s.repeaterConfig;
      pfuModelSel.value = s.pfuModel || 'None';
      repeaterHops.value = s.repeaterHops || 1;
      numPairs.value = s.numPairs || 8;
      adapter.input.value = s.adapterModel && s.adapterModel !== 'None' ? s.adapterModel : '';
      repeater.input.value = s.repeaterModel && s.repeaterModel !== 'None' ? s.repeaterModel : '';
      pfuDcCable.checked = !!s.pfuDcCable;
      pfuCableLengthSel.value = s.pfuCableLength || 'None';
      mountingKitSel.value = s.mountingKit || 'None';
      mountingModelSel.value = s.mountingModel || 'None';
      coSfpModelSel.value = s.coSfpModel || 'None';
      sfpQuantity.value = s.sfpQuantity || 1;
      cpeSfpModelSel.value = s.cpeSfpModel || 'None';
      cpeSfpQuantity.value = s.cpeSfpQuantity || 1;
      copperCableSel.value = s.copperCable || 'None';
      coCopperCableSel.value = s.coCopperCable || 'None';
      cableTypeSel.value = s.cableType || 'US Color Code (ft)';
      cableLength.value = s.cableLength || '';
      alarmCableSel.value = s.alarmCable || 'None';
      updateClassifyInfo();
    }

    addBtn.addEventListener('click', () => {
      const state = collectState();
      errBox.style.display = 'none';
      if (!state.coModel || !DataStore.raw.autoRepeaterInfo.some(r => r.partNumber === state.coModel)) {
        errBox.textContent = 'Please pick a valid CO model from the list.';
        errBox.style.display = '';
        return;
      }
      if (!state.cpeModel || !DataStore.raw.autoRepeaterInfo.some(r => r.partNumber === state.cpeModel)) {
        errBox.textContent = 'Please pick a valid CPE model from the list.';
        errBox.style.display = '';
        return;
      }
      const classified = NetworkWizard.classify(state.coModel);
      try {
        const note = NetworkWizard.apply(state, classified, Quote.activeSiteIndex);
        renderAll();
        errBox.className = 'notice info';
        errBox.textContent = 'Added to quote. ' + note;
        errBox.style.display = '';
      } catch (e) {
        errBox.className = 'notice';
        errBox.textContent = e.message;
        errBox.style.display = '';
      }
    });
  }

  // -----------------------------------------------------------------------
  // EMS Licensing Wizard UI
  // -----------------------------------------------------------------------
  function buildEmsWizard() {
    const root = document.getElementById('emsWizard');
    root.innerHTML = '';

    function field(labelText, input) { return el('div', { class: 'field' }, [el('label', {}, labelText), input]); }
    function checkboxField(labelText, input) { return el('div', { class: 'checkbox-field' }, [input, el('label', {}, labelText)]); }

    const existingEMS = el('input', { type: 'checkbox' });
    const existingSiteLicenses = el('input', { type: 'text', placeholder: "number, '>1000', or 'Right to Use'" });
    const rtuLicense = el('input', { type: 'checkbox' });
    const siteLicenses = el('input', { type: 'number', min: '0', value: '100' });
    const nodeLicensesSel = el('select'); fillSelect(nodeLicensesSel, rowsByTypes(['EMSNODE']), { none: '— None —' });
    const aggregatorLicensesSel = el('select'); fillSelect(aggregatorLicensesSel, rowsByTypes(['EMSAGG']), { none: '— None —' });
    const thirdPartyLicensesSel = el('select'); fillSelect(thirdPartyLicensesSel, rowsByTypes(['PTMP EMS', 'PTMP ML230 EMS', 'PTP EMS']), { none: '— None —' });
    const clients = el('input', { type: 'number', min: '0', value: '0' });
    const redundancy = el('input', { type: 'checkbox' });
    const redundancyExtn = el('input', { type: 'checkbox' });
    const pmStats = el('input', { type: 'checkbox' });
    const pmQty = el('input', { type: 'number', min: '0', step: '100', value: '0' });
    const topology = el('input', { type: 'checkbox' });
    const snmpNB = el('input', { type: 'checkbox' });
    const xmlNB = el('input', { type: 'checkbox' });
    const restNB = el('input', { type: 'checkbox' });
    const emailAlarms = el('input', { type: 'checkbox' });
    const security = el('input', { type: 'checkbox' });

    root.appendChild(el('div', {}, [
      checkboxField('Customer already has EMS installed', existingEMS),
      field('Existing Site Licenses', existingSiteLicenses),
      checkboxField('Right-to-Use license (no incremental site license fee)', rtuLicense),
      field('Maximum Number of NEs / Site Licenses Required', siteLicenses),
      field('Node Licenses (3rd-party node type)', nodeLicensesSel),
      field('Aggregator Licenses', aggregatorLicensesSel),
      field('3rd-Party Licenses', thirdPartyLicensesSel),
      field('Number of EMS Clients', clients),
      checkboxField('Redundancy', redundancy),
      checkboxField('Redundancy is an extension to an existing installation', redundancyExtn),
      checkboxField('Performance Monitoring / Statistics', pmStats),
      field('PM/Stats NE Qty', pmQty),
      checkboxField('Topology Manager', topology),
      checkboxField('SNMP Northbound Interface', snmpNB),
      checkboxField('XML Northbound Interface', xmlNB),
      checkboxField('REST Northbound Interface', restNB),
      checkboxField('Email Alarms', emailAlarms),
      checkboxField('Enhanced Security (FIPS)', security),
    ]));

    root.appendChild(buildTemplateBar('ems', () => collectState(), (s) => applyState(s)));

    const addBtn = el('button', { class: 'btn', style: 'margin-top:12px' }, 'Add to Quote');
    const errBox = el('div', { class: 'notice', style: 'display:none;margin-top:10px' });
    root.appendChild(errBox);
    root.appendChild(addBtn);

    function collectState() {
      let existing = existingSiteLicenses.value.trim();
      if (existing !== '>1000' && existing !== 'Right to Use' && existing !== '') existing = Number(existing);
      return {
        existingEMS: existingEMS.checked,
        existingSiteLicenses: existing === '' ? null : existing,
        rtuLicense: rtuLicense.checked,
        siteLicenses: parseFloat(siteLicenses.value),
        nodeLicenses: nodeLicensesSel.value,
        aggregatorLicenses: aggregatorLicensesSel.value,
        thirdPartyLicenses: thirdPartyLicensesSel.value,
        clients: parseFloat(clients.value) || 0,
        redundancy: redundancy.checked,
        redundancyExtn: redundancyExtn.checked,
        pmStats: pmStats.checked,
        pmQty: parseFloat(pmQty.value) || 0,
        topology: topology.checked,
        snmpNB: snmpNB.checked,
        xmlNB: xmlNB.checked,
        restNB: restNB.checked,
        emailAlarms: emailAlarms.checked,
        security: security.checked,
      };
    }
    function applyState(s) {
      existingEMS.checked = !!s.existingEMS;
      existingSiteLicenses.value = s.existingSiteLicenses == null ? '' : s.existingSiteLicenses;
      rtuLicense.checked = !!s.rtuLicense;
      siteLicenses.value = s.siteLicenses || 0;
      nodeLicensesSel.value = s.nodeLicenses || 'None';
      aggregatorLicensesSel.value = s.aggregatorLicenses || 'None';
      thirdPartyLicensesSel.value = s.thirdPartyLicenses || 'None';
      clients.value = s.clients || 0;
      redundancy.checked = !!s.redundancy;
      redundancyExtn.checked = !!s.redundancyExtn;
      pmStats.checked = !!s.pmStats;
      pmQty.value = s.pmQty || 0;
      topology.checked = !!s.topology;
      snmpNB.checked = !!s.snmpNB;
      xmlNB.checked = !!s.xmlNB;
      restNB.checked = !!s.restNB;
      emailAlarms.checked = !!s.emailAlarms;
      security.checked = !!s.security;
    }

    addBtn.addEventListener('click', () => {
      errBox.style.display = 'none';
      try {
        const notes = EMSWizard.apply(collectState(), Quote.activeSiteIndex);
        renderAll();
        errBox.className = 'notice info';
        errBox.textContent = 'Added to quote.' + (notes.length ? ' ' + notes.join(' ') : '');
        errBox.style.display = '';
      } catch (e) {
        errBox.className = 'notice';
        errBox.textContent = e.message;
        errBox.style.display = '';
      }
    });
  }

  // -----------------------------------------------------------------------
  // Shared "save / load template" bar (localStorage, device-local — see
  // wizard-templates.js)
  // -----------------------------------------------------------------------
  function buildTemplateBar(wizardKey, getState, setState) {
    const sel = document.createElement('select');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Template name';
    nameInput.style.width = '160px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn small secondary';
    saveBtn.textContent = 'Save Template';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn small secondary';
    loadBtn.textContent = 'Load';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = 'Delete';

    function refresh() {
      sel.innerHTML = '';
      WizardTemplates.list(wizardKey).forEach(name => sel.appendChild(el('option', { value: name }, name)));
    }
    refresh();

    saveBtn.addEventListener('click', () => {
      try {
        WizardTemplates.save(wizardKey, nameInput.value, getState());
        nameInput.value = '';
        refresh();
      } catch (e) { alert(e.message); }
    });
    loadBtn.addEventListener('click', () => {
      if (!sel.value) return;
      const state = WizardTemplates.load(wizardKey, sel.value);
      if (state) setState(state);
    });
    delBtn.addEventListener('click', () => {
      if (!sel.value) return;
      if (confirm(`Delete template "${sel.value}"?`)) { WizardTemplates.remove(wizardKey, sel.value); refresh(); }
    });

    return el('div', { class: 'wizard-section' }, [
      el('div', {}, [el('span', { class: 'badge local' }, 'Saved on this device only')]),
      el('div', { class: 'actions-row' }, [
        el('div', { class: 'field', style: 'flex:1;min-width:160px' }, [el('label', {}, 'Saved Templates'), sel]),
        el('div', { class: 'field', style: 'flex:1;min-width:160px' }, [el('label', {}, 'New Template Name'), nameInput]),
      ]),
      el('div', { class: 'actions-row' }, [saveBtn, loadBtn, delBtn]),
    ]);
  }

  return { initPriceListPage, initQuoteBuilderPage };
})();
