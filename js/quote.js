/* quote.js
 * In-memory quote/BOM state and totals engine. No server, no localStorage of
 * customer data — everything here lives only for the life of the browser tab
 * unless the user explicitly exports it (CSV/PDF) or saves a device-local
 * "template" (see export.js / wizard template save, which is opt-in and
 * clearly labelled as browser-local only).
 *
 * Ported from:
 *  - General.txt: AddToQuote (BOM line add/merge)
 *  - Report_QuoteReport A4 / Report_QuoteSubReport control sources (totals —
 *    extracted directly from the Access report design, not visible in VBA)
 */
const Quote = (() => {
  // Working-quote state (customer type/region/BOM/services — never a customer
  // name+PII combo that would count as "stored customer data") is mirrored to
  // sessionStorage so it survives navigation between this multi-page site's
  // HTML files within the same browser tab. sessionStorage is cleared when
  // the tab/window closes, unlike localStorage (used only for opt-in, named
  // wizard templates in wizard-templates.js). Nothing here is sent anywhere.
  const STORAGE_KEY = 'actelis-quote-state';

  const session = {
    customerType: 'End Customer',   // 'End Customer' | 'Reseller'
    region: 'NA',                   // NA | EMEA | APAC | CALA | Enterprise | All
    dealRegistration: false,        // NA-only bonus discount
    includeLegacy: false,
    salesTaxEnabled: false,
    salesTaxPct: 0,                 // fraction, e.g. 0.08
  };

  const header = {
    quotationNumber: '',
    customer: '',
    customerContact: '',
    date: new Date().toISOString().slice(0, 10),
    expirationDate: '',
    paymentTerms: '',
    shippingTerms: '',
    quotedBy: '',
    comments: '',
  };

  // sites: [{ name, lines: [{ partNumber, qty }] }]
  let sites = [{ name: 'Site 1', lines: [] }];
  let activeSiteIndex = 0;

  // services: [{ partNumber, qty, isPercent, percent, manualPrice }]
  let services = [];

  function persist() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        session, header, sites, activeSiteIndex, services,
      }));
    } catch (e) {
      // sessionStorage unavailable (private mode, quota, etc.) — quote still
      // works for the current page, it just won't survive navigation.
      console.warn('Quote: could not persist to sessionStorage.', e);
    }
  }

  function restore() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.session) Object.assign(session, d.session);
      if (d.header) Object.assign(header, d.header);
      if (Array.isArray(d.sites) && d.sites.length) sites = d.sites;
      if (Number.isInteger(d.activeSiteIndex)) activeSiteIndex = d.activeSiteIndex;
      if (Array.isArray(d.services)) services = d.services;
    } catch (e) {
      console.warn('Quote: could not restore from sessionStorage.', e);
    }
  }
  restore();

  function ctx() {
    return {
      customerType: session.customerType,
      region: session.region,
      dealRegistration: session.dealRegistration,
    };
  }

  function activeSite() {
    return sites[activeSiteIndex];
  }

  function addSite(name) {
    sites.push({ name: name || `Site ${sites.length + 1}`, lines: [] });
    activeSiteIndex = sites.length - 1;
    persist();
    return activeSite();
  }

  function duplicateSite(name) {
    const src = activeSite();
    const copy = { name: name || `${src.name} copy`, lines: src.lines.map(l => ({ ...l })) };
    sites.push(copy);
    activeSiteIndex = sites.length - 1;
    persist();
    return copy;
  }

  function deleteSite(index) {
    if (sites.length <= 1) return false;
    sites.splice(index, 1);
    if (activeSiteIndex >= sites.length) activeSiteIndex = sites.length - 1;
    persist();
    return true;
  }

  function setActiveSite(index) {
    if (index >= 0 && index < sites.length) { activeSiteIndex = index; persist(); }
  }

  // Mirrors AddToQuote(PartNumber, Qty): merges into an existing line for the
  // active site, or creates a new one. Qty may be negative (line removal /
  // reduction), matching how the wizards call AddToQuote with negative deltas.
  function addToQuote(partNumber, qty, siteIndex = activeSiteIndex) {
    if (!partNumber || !qty) return;
    const site = sites[siteIndex];
    const existing = site.lines.find(l => l.partNumber === partNumber);
    if (existing) {
      existing.qty += qty;
      if (existing.qty === 0) {
        site.lines = site.lines.filter(l => l !== existing);
      }
    } else if (qty !== 0) {
      site.lines.push({ partNumber, qty });
    }
    persist();
  }

  function setLineQty(siteIndex, partNumber, qty) {
    const site = sites[siteIndex];
    const existing = site.lines.find(l => l.partNumber === partNumber);
    if (qty <= 0) {
      site.lines = site.lines.filter(l => l !== existing);
      persist();
      return;
    }
    if (existing) existing.qty = qty;
    else site.lines.push({ partNumber, qty });
    persist();
  }

  function removeLine(siteIndex, partNumber) {
    const site = sites[siteIndex];
    site.lines = site.lines.filter(l => l.partNumber !== partNumber);
    persist();
  }

  // ---- Services (Type-D) ----
  // A Type-D row whose "List Price String" mentions a percentage is treated
  // as a percent-of-BOM-subtotal line (mirrors the Access QuoteTable-Part D
  // "negative Qty means percent line" convention — see Report_QuoteSubReport
  // control source: Cost = IIf(Qty<0, Percent * TotalPrice, Total Cust Price)).
  function isPercentTypeD(row) {
    return !!(row.listPriceString && row.listPriceString.includes('%'));
  }

  function addService(partNumber, opts = {}) {
    const row = DataStore.raw.typeD.find(r => r.partNumber === partNumber);
    if (!row) return;
    const percentBased = isPercentTypeD(row);
    services.push({
      partNumber,
      description: row.description,
      qty: opts.qty ?? row.defaultQty ?? 1,
      isPercent: percentBased,
      percent: percentBased ? (row.listPrice || 0) : 0,
      manualPrice: opts.manualPrice ?? (row.listPrice == null ? 0 : row.listPrice),
    });
    persist();
  }

  function removeService(index) {
    services.splice(index, 1);
    persist();
  }

  // ---- Totals (Report_QuoteReport A4 / QuoteSubReport control sources) ----
  function lineNetPrice(partNumber) {
    return DiscountEngine.netPrice(partNumber, 1, ctx());
  }

  function siteSubtotal(site) {
    return site.lines.reduce((sum, l) => sum + l.qty * lineNetPrice(l.partNumber), 0);
  }

  function bomSubtotal() {
    return sites.reduce((sum, s) => sum + siteSubtotal(s), 0);
  }

  function servicesSubtotal() {
    const bom = bomSubtotal();
    return services.reduce((sum, s) => {
      if (s.isPercent) return sum + s.percent * bom * (s.qty || 1);
      return sum + (s.manualPrice || 0) * (s.qty || 1);
    }, 0);
  }

  // Total Price is treated as TAX-INCLUSIVE in the original report — sales
  // tax is backed out of it, not added on top. See Report_QuoteReport A4:
  //   PriceNoTax = TotalPrice / (1+pct); SalesTax = TotalPrice*pct/(1+pct)
  function totals() {
    const bom = bomSubtotal();
    const svc = servicesSubtotal();
    const totalPrice = bom + svc;
    let priceNoTax = totalPrice, salesTax = 0;
    if (session.salesTaxEnabled && session.salesTaxPct) {
      priceNoTax = totalPrice / (1 + session.salesTaxPct);
      salesTax = totalPrice - priceNoTax;
    }
    const isEndCustomer = session.customerType === 'End Customer';
    return {
      bom, svc, totalPrice, priceNoTax, salesTax,
      labels: {
        totalCustPrice: isEndCustomer ? 'Total Price' : 'Total Xfer Price',
        totalSitePrice: isEndCustomer ? 'Total Site Price' : 'Total Site Transfer Price',
        totalIncl: isEndCustomer ? 'Total Price Including Services/Warranty' : 'Total Transfer Price Including Services/Warranty',
      },
    };
  }

  function reset() {
    sites = [{ name: 'Site 1', lines: [] }];
    activeSiteIndex = 0;
    services = [];
    persist();
  }

  return {
    session, header,
    get sites() { return sites; },
    get services() { return services; },
    get activeSiteIndex() { return activeSiteIndex; },
    activeSite, addSite, duplicateSite, deleteSite, setActiveSite,
    addToQuote, setLineQty, removeLine,
    addService, removeService, isPercentTypeD,
    lineNetPrice, siteSubtotal, bomSubtotal, servicesSubtotal, totals,
    reset, ctx,
    save: persist, // call after directly mutating session/header fields from the UI
  };
})();
