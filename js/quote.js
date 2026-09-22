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
    // Financial Options (bottom of the Quote Builder page) — each toggle
    // simply adds/removes a real Type-D catalog line via addService/
    // removeServicesByPn below, so the amounts always come from the same
    // global price list everyone else sees (see FIN_OPTION_PARTS).
    financialOptions: { shipping: false, creditCard: false, extendedWarranty: false },
  };

  const header = {
    quotationNumber: '',
    status: 'New',
    customer: '',
    customerContact: '',
    address: '',
    phone: '',
    email: '',
    date: new Date().toISOString().slice(0, 10),
    expirationDate: '',
    paymentTerms: '',
    shippingTerms: '',
    quotedBy: '',
    comments: '',
  };

  // Maps each Financial Options toggle to the real Type-D part number(s) it
  // adds to the Services/Warranty section (see data/price-list-type-d.json:
  // SVC-FREIGHT = "Shipping Costs, 2% of product price", SVC-CC = "Credit
  // Card Costs, 3% of product price", SVC-HW2WT/SVC-SW2WT = the standard
  // included HW/SW warranty lines, added at $0 purely so they show up in the
  // exported quote when "Extended Warranty" is toggled on).
  const FIN_OPTION_PARTS = {
    shipping: ['SVC-FREIGHT'],
    creditCard: ['SVC-CC'],
    extendedWarranty: ['SVC-HW2WT', 'SVC-SW2WT'],
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
      if (d.session) {
        const fin = { ...session.financialOptions, ...(d.session.financialOptions || {}) };
        Object.assign(session, d.session);
        session.financialOptions = fin;
      }
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

  // Adds a custom / non-catalog BOM line with a manually-entered description
  // and unit price (see the "Line Items" card's "+ Add" custom-item form).
  // Unlike addToQuote(), this never merges into an existing line — each
  // manual add is its own line, since two manual lines might share a made-up
  // part number but mean different things.
  function addManualLine(partNumber, description, price, qty, siteIndex = activeSiteIndex) {
    if (!partNumber || !qty) return;
    sites[siteIndex].lines.push({ partNumber, qty, manual: true, manualDescription: description, manualPrice: price });
    persist();
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

  // Overrides the default region/customer-type discount (see discount.js)
  // for one BOM line, so a user can negotiate a different discount on a
  // per-line basis without that affecting every other quote. Passing
  // `discount` as null/undefined/NaN clears the override and reverts the
  // line to the standard discount matrix. Does nothing for a manual/custom
  // line (addManualLine) — those already carry their own directly-entered
  // price and have no catalog discount to override.
  function setLineDiscount(siteIndex, partNumber, discount) {
    const site = sites[siteIndex];
    const line = site.lines.find(l => l.partNumber === partNumber);
    if (!line || line.manual) return;
    if (discount == null || Number.isNaN(discount)) delete line.discountOverride;
    else line.discountOverride = discount;
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

  // Adds a service/warranty line that isn't a recognized Type-D catalog part
  // number (used when importing a foreign PDF — see js/pdf.js — whose line
  // items no longer exist in the current catalog). Carries its own
  // description and flat price, same shape as a manual BOM line.
  function addManualService(partNumber, description, price, qty = 1) {
    services.push({ partNumber, description, qty, isPercent: false, percent: 0, manualPrice: price || 0 });
    persist();
  }

  function removeService(index) {
    services.splice(index, 1);
    persist();
  }

  function removeServicesByPn(partNumbers) {
    services = services.filter(s => !partNumbers.includes(s.partNumber));
    persist();
  }

  // ---- Financial Options (Shipping / Credit Card / Extended Warranty) ----
  // Turning a toggle on adds the corresponding real Type-D catalog line(s)
  // (see FIN_OPTION_PARTS) to Services/Warranty if not already present;
  // turning it off removes exactly those lines. This keeps the amounts tied
  // to the same globally-maintained price list every visitor sees, rather
  // than a hard-coded percentage baked into the UI.
  function setFinancialOption(key, enabled) {
    const partNumbers = FIN_OPTION_PARTS[key];
    if (!partNumbers) return;
    session.financialOptions[key] = !!enabled;
    if (enabled) {
      partNumbers.forEach(pn => {
        if (!services.some(s => s.partNumber === pn) && DataStore.raw.typeD.some(r => r.partNumber === pn)) {
          addService(pn);
        }
      });
    } else {
      removeServicesByPn(partNumbers);
    }
    persist();
  }

  // ---- Totals (Report_QuoteReport A4 / QuoteSubReport control sources) ----
  // Accepts either a plain part number (legacy call sites) or a BOM line
  // object — a manual/custom line (see addManualLine) carries its own
  // manually-entered price instead of a catalog lookup, and a line with a
  // discountOverride (see setLineDiscount) prices off the catalog's list
  // price at that discount instead of the standard discount-matrix lookup.
  function lineNetPrice(lineOrPn) {
    if (lineOrPn && typeof lineOrPn === 'object') {
      if (lineOrPn.manual) return lineOrPn.manualPrice || 0;
      if (lineOrPn.discountOverride != null) {
        const row = DataStore.getPriceRow(lineOrPn.partNumber);
        if (!row || row.listPrice == null) return 0;
        return row.listPrice * (1 - lineOrPn.discountOverride);
      }
      return DiscountEngine.netPrice(lineOrPn.partNumber, 1, ctx());
    }
    return DiscountEngine.netPrice(lineOrPn, 1, ctx());
  }

  // The discount actually in effect for a BOM line: its override if one is
  // set, otherwise the standard region/customer-type default from the
  // discount matrix. Used by the UI to populate/reset the Discount column.
  function effectiveDiscount(line) {
    if (!line || line.manual) return 0;
    if (line.discountOverride != null) return line.discountOverride;
    return DiscountEngine.getCustomerDiscount(line.partNumber, line.qty, ctx());
  }

  function siteSubtotal(site) {
    return site.lines.reduce((sum, l) => sum + l.qty * lineNetPrice(l), 0);
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
    session.financialOptions = { shipping: false, creditCard: false, extendedWarranty: false };
    Object.assign(header, {
      quotationNumber: '', status: 'New', customer: '', customerContact: '',
      address: '', phone: '', email: '',
      date: new Date().toISOString().slice(0, 10), expirationDate: '',
      paymentTerms: '', shippingTerms: '', quotedBy: '', comments: '',
    });
    persist();
  }

  // ---- Full-state serialize / restore, used for the PDF round-trip ----
  // (js/pdf.js embeds the object returned by serialize() as JSON inside the
  // exported PDF's metadata, and loadFromState() rehydrates it on import.)
  function serialize() {
    return JSON.parse(JSON.stringify({ session, header, sites, activeSiteIndex, services }));
  }

  function loadFromState(data) {
    if (!data) return;
    if (data.session) {
      const fin = { ...session.financialOptions, ...(data.session.financialOptions || {}) };
      Object.assign(session, data.session);
      session.financialOptions = fin;
    }
    if (data.header) Object.assign(header, data.header);
    if (Array.isArray(data.sites) && data.sites.length) sites = data.sites;
    activeSiteIndex = Number.isInteger(data.activeSiteIndex) ? data.activeSiteIndex : 0;
    if (activeSiteIndex >= sites.length) activeSiteIndex = 0;
    if (Array.isArray(data.services)) services = data.services;
    persist();
  }

  // ---- Foreign-PDF import (see js/pdf.js: parseForeignPdf) ----
  // Unlike loadFromState(), this is a *partial* merge: it's used for a PDF
  // that was NOT produced by this tool (e.g. a real historical quote printed
  // by the original Access desktop tool) and therefore carries no reliable
  // session context (customer type / region / deal registration / sales tax
  // / financial options) — session is deliberately left untouched. Header
  // fields are merged in as parsed. Sites/services are only replaced if the
  // PDF actually yielded some (an empty/failed parse shouldn't wipe out
  // whatever the user already had on screen).
  //
  // Each BOM/service line is reconciled against the CURRENT live catalog by
  // part number: a match is added the normal way (so it always prices off
  // today's list price + discount, exactly like every other line in the
  // app — see the module doc's "no frozen historical prices" design), and a
  // non-match (discontinued / re-numbered / not recognized) becomes a manual
  // line carrying the description and price the PDF printed. Returns a
  // summary the caller can show the user, including a comparison against
  // the PDF's own printed grand total (recomputed total may legitimately
  // differ — different price list, different customer/region session).
  function importForeignData({ header: hdr, sites: parsedSites, services: parsedServices, printedGrandTotal } = {}) {
    const result = {
      matchedLines: 0, manualLines: 0,
      matchedServices: 0, manualServices: 0,
      printedGrandTotal: printedGrandTotal != null ? printedGrandTotal : null,
      recomputedGrandTotal: null,
    };

    if (hdr) Object.assign(header, hdr);

    if (Array.isArray(parsedSites) && parsedSites.length) {
      sites = parsedSites.map((ps, i) => {
        const lines = (ps.lines || []).map(pl => {
          const row = pl.partNumber ? DataStore.getPriceRow(pl.partNumber) : null;
          if (row) {
            result.matchedLines++;
            return { partNumber: pl.partNumber, qty: pl.qty || 1 };
          }
          result.manualLines++;
          const qty = pl.qty || 1;
          const fallbackPrice = pl.unitPrice != null ? pl.unitPrice
            : (pl.totalPrice != null ? pl.totalPrice / qty : 0);
          return {
            partNumber: pl.partNumber || `UNMATCHED-${i}-${result.manualLines}`,
            qty, manual: true,
            manualDescription: pl.description || '(imported line — part not found in current catalog)',
            manualPrice: fallbackPrice,
          };
        });
        return { name: ps.name || `Site ${i + 1}`, lines };
      });
      activeSiteIndex = 0;
    }

    if (Array.isArray(parsedServices) && parsedServices.length) {
      services = parsedServices.map(psvc => {
        const row = psvc.partNumber ? DataStore.raw.typeD.find(r => r.partNumber === psvc.partNumber) : null;
        if (row) {
          result.matchedServices++;
          const percentBased = isPercentTypeD(row);
          return {
            partNumber: psvc.partNumber,
            description: row.description,
            qty: psvc.qty || row.defaultQty || 1,
            isPercent: percentBased,
            percent: percentBased ? (row.listPrice || 0) : 0,
            manualPrice: row.listPrice == null ? 0 : row.listPrice,
          };
        }
        result.manualServices++;
        return {
          partNumber: psvc.partNumber || '',
          description: psvc.description || '(imported service — not found in current catalog)',
          qty: psvc.qty || 1, isPercent: false, percent: 0,
          manualPrice: psvc.unitPrice != null ? psvc.unitPrice : (psvc.totalPrice || 0),
        };
      });
    }

    persist();
    result.recomputedGrandTotal = totals().totalPrice;
    return result;
  }

  return {
    session, header,
    get sites() { return sites; },
    get services() { return services; },
    get activeSiteIndex() { return activeSiteIndex; },
    activeSite, addSite, duplicateSite, deleteSite, setActiveSite,
    addToQuote, addManualLine, setLineQty, removeLine, setLineDiscount,
    addService, addManualService, removeService, removeServicesByPn, setFinancialOption, isPercentTypeD,
    lineNetPrice, effectiveDiscount, siteSubtotal, bomSubtotal, servicesSubtotal, totals,
    reset, ctx, serialize, loadFromState, importForeignData,
    save: persist, // call after directly mutating session/header fields from the UI
  };
})();
