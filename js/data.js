/* data.js
 * Loads the static JSON data files (ported from the Access price/quote tool)
 * and builds convenient indices used by the rest of the app.
 *
 * No network calls other than same-origin fetch of these bundled JSON files.
 * No customer data is stored anywhere here.
 */
const DataStore = (() => {
  const FILES = {
    priceList: 'data/price-list.json',
    priceListArchive: 'data/price-list-archive.json',
    typeD: 'data/price-list-type-d.json',
    autoRepeaterInfo: 'data/auto-repeater-info.json',
    bundles: 'data/bundles.json',
    spareSlots: 'data/spare-slots.json',
    discounts: 'data/discounts.json',
    categoryHeaders: 'data/category-headers.json',
    customerTypes: 'data/customer-types.json',
    regions: 'data/regions.json',
    paymentTerms: 'data/payment-terms.json',
    shippingTerms: 'data/shipping-terms.json',
    quoteStatus: 'data/quote-status.json',
    pnRegion: 'data/pn-region.json',
    pnTypeDRegion: 'data/pn-typed-region.json',
    restrictedDefaults: 'data/restricted-defaults.json',
    meta: 'data/meta.json',
    replacements: 'data/replacements.json',
    compatMatrix: 'data/compatibility-matrix.json',
  };

  const state = {
    raw: {},
    byPartNumber: new Map(),       // partNumber -> price-list row (A/B/C items)
    typeDByPartNumber: new Map(),  // partNumber -> type-D row
    archiveByPartNumber: new Map(), // partNumber -> archived price-list row (fallback pricing)
    byPnType: new Map(),           // 'PN Type' -> [AutoRepeaterInfo rows]
    discountsByCategory: new Map(),
    discountsByCategoryType: new Map(),
    categoryHeaderByLetter: new Map(),
    pnRegionSet: new Set(),        // `${regionId}|${partNumber}`
    pnTypeDRegionSet: new Set(),
    pnRegionIds: new Map(),        // partNumber -> Set(regionId) (PN-Region)
    pnTypeDRegionIds: new Map(),   // partNumber -> Set(regionId) (PN-TypeD-Region)
    regionIdByName: new Map(),     // 'COMMERCIAL' -> 6, ...
    replacementByOldPn: new Map(), // oldPartNumber -> { newPartNumber, notes }
    // newPartNumber -> { acdcPartNumbers: [...], cablePartNumbers: [...] } --
    // admin-specified (Replacements Manager) AC/DC Adapter / Cable part
    // numbers to offer in the Node/Network Configurator wizards when this
    // part number is picked as the CO/Node model, overriding the wizards'
    // automatic family-based guess for a device the guess doesn't cover
    // correctly (see NodeWizard.compatibleAccessoryTypes and
    // App.getReplacementAccessories's call sites in app.js). Built up from
    // every replacements.json row targeting this part number as its
    // "New Part Number" -- normally just one, but merged across all of them
    // if more than one old part was superseded by the same new one.
    replacementAccessoriesByNewPn: new Map(),
    loaded: false,
  };

  async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  async function load() {
    if (state.loaded) return state;
    const entries = Object.entries(FILES);
    const results = await Promise.all(entries.map(([, path]) => fetchJson(path)));
    entries.forEach(([key], i) => { state.raw[key] = results[i]; });

    // Indices
    for (const row of state.raw.priceList) {
      state.byPartNumber.set(row.partNumber, row);
    }
    for (const row of state.raw.typeD) {
      state.typeDByPartNumber.set(row.partNumber, row);
    }
    for (const row of state.raw.priceListArchive) {
      state.archiveByPartNumber.set(row.partNumber, row);
    }
    for (const row of state.raw.autoRepeaterInfo) {
      const list = state.byPnType.get(row.pnType) || [];
      list.push(row);
      state.byPnType.set(row.pnType, list);
    }
    for (const row of state.raw.discounts) {
      state.discountsByCategory.set(row.category, row);
      if (!state.discountsByCategoryType.has(row.categoryType)) {
        state.discountsByCategoryType.set(row.categoryType, row);
      }
    }
    for (const row of state.raw.categoryHeaders) {
      state.categoryHeaderByLetter.set(row.category, row.description);
    }
    for (const row of state.raw.pnRegion) {
      state.pnRegionSet.add(`${row.regionId}|${row.partNumber}`);
      if (!state.pnRegionIds.has(row.partNumber)) state.pnRegionIds.set(row.partNumber, new Set());
      state.pnRegionIds.get(row.partNumber).add(row.regionId);
    }
    for (const row of state.raw.pnTypeDRegion) {
      state.pnTypeDRegionSet.add(`${row.regionId}|${row.partNumber}`);
      if (!state.pnTypeDRegionIds.has(row.partNumber)) state.pnTypeDRegionIds.set(row.partNumber, new Set());
      state.pnTypeDRegionIds.get(row.partNumber).add(row.regionId);
    }
    for (const row of state.raw.regions) {
      state.regionIdByName.set(String(row.name).toUpperCase(), row.id);
    }
    for (const row of (state.raw.replacements || [])) {
      if (row.oldPartNumber) state.replacementByOldPn.set(row.oldPartNumber, row);
      if (row.newPartNumber && ((row.acdcPartNumbers && row.acdcPartNumbers.length) || (row.cablePartNumbers && row.cablePartNumbers.length))) {
        const existing = state.replacementAccessoriesByNewPn.get(row.newPartNumber) || { acdcPartNumbers: [], cablePartNumbers: [] };
        const mergeUnique = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
        state.replacementAccessoriesByNewPn.set(row.newPartNumber, {
          acdcPartNumbers: mergeUnique(existing.acdcPartNumbers, row.acdcPartNumbers),
          cablePartNumbers: mergeUnique(existing.cablePartNumbers, row.cablePartNumbers),
        });
      }
    }

    state.loaded = true;
    return state;
  }

  // Falls back to the archived price list for discontinued-but-still-quotable
  // part numbers (e.g. older Node/Network model variants referenced by
  // AutoRepeaterInfo that have been superseded in the current price list).
  function getPriceRow(partNumber) {
    return state.byPartNumber.get(partNumber)
      || state.typeDByPartNumber.get(partNumber)
      || state.archiveByPartNumber.get(partNumber)
      || null;
  }

  // Authorized-personnel-maintained, global replacement mapping (see
  // js/admin.js "Replacements Manager"). Returns the replacement row
  // ({ oldPartNumber, newPartNumber, notes }) for a discontinued part number,
  // or null if it has no recorded replacement. This is read-only data loaded
  // from data/replacements.json — the same file every visitor sees.
  function getReplacement(partNumber) {
    return state.replacementByOldPn.get(partNumber) || null;
  }

  // Admin-specified AC/DC Adapter / Cable part numbers for a part number
  // that is itself the "New Part Number" of a recorded replacement (see
  // js/admin.js "Replacements Manager") -- returns null if none were
  // specified for it, in which case callers should fall back to the
  // wizards' automatic family-based accessory filtering.
  function getReplacementAccessories(partNumber) {
    return state.replacementAccessoriesByNewPn.get(partNumber) || null;
  }

  // ---- Regions (V3.22+ renamed "NA" -> "Commercial", "Enterprise" -> "Federal") ----
  // Old names still turn up in saved sessions, round-trip PDFs and wizard
  // templates made before V3.25, so they're mapped onto the new ones.
  const LEGACY_REGION_NAMES = { NA: 'Commercial', ENTERPRISE: 'Federal' };
  function normalizeRegionName(name) {
    const n = String(name || '').trim();
    return LEGACY_REGION_NAMES[n.toUpperCase()] || n;
  }
  function regionId(name) {
    return state.regionIdByName.get(normalizeRegionName(name).toUpperCase()) ?? null;
  }
  function isCommercial(region) { return normalizeRegionName(region) === 'Commercial'; }
  function isFederal(region) { return normalizeRegionName(region) === 'Federal'; }

  // AutoRepeaterInfo's own Region column was NOT renamed in V3.25 (it still
  // reads e.g. "EMEA NA Enterprise APAC CALA ALL"), which is why Access
  // V3.25's own configurator wizards come up empty for Commercial/Federal
  // quotes. Here each region also matches its pre-V3.22 token.
  const ARI_REGION_TOKENS = { COMMERCIAL: ['COMMERCIAL', 'NA'], FEDERAL: ['FEDERAL', 'ENTERPRISE'] };
  function ariRegionMatches(ariRegionString, region) {
    const raw = String(ariRegionString || '').trim();
    if (!raw) return true;
    const tokens = raw.toUpperCase().split(/\s+/);
    const r = normalizeRegionName(region).toUpperCase();
    return (ARI_REGION_TOKENS[r] || [r]).some(t => tokens.includes(t));
  }

  // List price in effect for a hardware/software row in a given region:
  // Commercial quotes use the separate "NA List Price" column added in
  // V3.23 (mirrors the LP = IIf(Region="Commercial", [NA List Price],
  // [List Price]) expression in V3.25's QuoteQuery / Price List queries).
  // Archive and Type-D rows have no Commercial column and use List Price.
  function listPriceFor(rowOrPn, region) {
    const row = typeof rowOrPn === 'string' ? getPriceRow(rowOrPn) : rowOrPn;
    if (!row) return null;
    if (isCommercial(region) && row.naListPrice != null && state.byPartNumber.get(row.partNumber) === row) {
      return row.naListPrice;
    }
    return row.listPrice;
  }

  function getListPrice(partNumber, region) {
    return listPriceFor(partNumber, region);
  }

  // Part number as printed: Access keeps region-specific duplicates of a
  // part as "<PN>." (e.g. 506R61252 for EMEA/APAC, 506R61252. for
  // Commercial/CALA, with different pricing) and strips the first "." for
  // display everywhere — Replace([Part Number],".","",1,1).
  function displayPn(partNumber) {
    return String(partNumber == null ? '' : partNumber).replace('.', '');
  }
  // Type-D regional variants likewise print without their trailing "."
  // ("SVC-HW2WT." -> SVC-HW2WT, "SVC-REMEXT." -> SVC-REMEXT). Access's
  // report also cuts tier suffixes like "-N4" off; those are kept here,
  // since they're the only thing telling the tiers apart on the page.
  function displayServicePn(partNumber) {
    return String(partNumber == null ? '' : partNumber).replace(/\.$/, '');
  }

  function categoryLetter(category) {
    return (category || '').trim().charAt(0);
  }

  function categoryDescription(category) {
    return state.categoryHeaderByLetter.get(categoryLetter(category)) || category;
  }

  // AutoRepeaterInfo lookups by PN Type, optionally filtered by region and a
  // description substring (mirrors the many DLookup/RowSource SQL patterns in
  // the VBA: "[PN Type] = 'X' AND [Description] LIKE '*Y*'" etc.)
  function findByPnType(pnType, { region = null, descIncludes = null, descExcludes = null } = {}) {
    let rows = state.byPnType.get(pnType) || [];
    if (region) {
      rows = rows.filter(r => ariRegionMatches(r.region, region));
    }
    if (descIncludes) {
      rows = rows.filter(r => r.description && r.description.includes(descIncludes));
    }
    if (descExcludes) {
      rows = rows.filter(r => !r.description || !r.description.includes(descExcludes));
    }
    return rows;
  }

  function findOneByPnType(pnType, opts) {
    const rows = findByPnType(pnType, opts);
    return rows.length ? rows[0] : null;
  }

  // Whether a part is offered in a region, per the PN-Region / PN-TypeD-
  // Region tables. `region` may be a region name or id. Mirrors the Access
  // part-number pickers (Form_SiteQuoteSubForm / Form_Main Form price list):
  //  - no rows for the part at all -> offered everywhere (LEFT JOIN, Region
  //    Is Null);
  //  - a specific region -> offered only if a row lists that region;
  //  - "All" -> offered unless every row it has is Federal-only
  //    ("Region <> 'Federal' Or Region Is Null").
  // `isTypeD` is optional — it's inferred from the catalog when omitted.
  function isVisibleInRegion(partNumber, region, isTypeD) {
    if (isTypeD == null) isTypeD = !state.byPartNumber.has(partNumber) && state.typeDByPartNumber.has(partNumber);
    const ids = (isTypeD ? state.pnTypeDRegionIds : state.pnRegionIds).get(partNumber);
    if (!ids || !ids.size) return true;
    const rid = typeof region === 'number' ? region : regionId(region);
    if (rid == null) return true;
    const allId = regionId('All');
    if (rid === allId) {
      const fedId = regionId('Federal');
      return [...ids].some(id => id !== fedId);
    }
    return ids.has(rid);
  }

  // The part number a quote in `region` should actually carry for the part
  // `partNumber` refers to: the part itself when it's offered there,
  // otherwise its regional sibling that is — "<PN>." (the Commercial/CALA
  // vs EMEA/APAC price variants), or for Federal quotes "<PN>-FAS" (the
  // Federal Approved Solution version, the only one V3.25 offers Federal).
  // Returns the part unchanged when no sibling fits either.
  function resolvePnForRegion(partNumber, region) {
    if (!partNumber) return partNumber;
    const isTypeD = !state.byPartNumber.has(partNumber) && state.typeDByPartNumber.has(partNumber);
    const exists = pn => isTypeD ? state.typeDByPartNumber.has(pn) : state.byPartNumber.has(pn);
    if (!exists(partNumber)) return partNumber;
    if (isVisibleInRegion(partNumber, region, isTypeD)) return partNumber;
    const base = partNumber.replace(/-FAS$/, '').replace(/\.$/, '');
    const candidates = isFederal(region)
      ? [base + '-FAS', base, base + '.']
      : [base, base + '.', base + '-FAS'];
    for (const pn of candidates) {
      if (pn !== partNumber && exists(pn) && isVisibleInRegion(pn, region, isTypeD)) return pn;
    }
    return partNumber;
  }

  return {
    load,
    get raw() { return state.raw; },
    getPriceRow,
    getListPrice,
    categoryLetter,
    categoryDescription,
    findByPnType,
    findOneByPnType,
    isVisibleInRegion,
    resolvePnForRegion,
    normalizeRegionName,
    regionId,
    isCommercial,
    isFederal,
    ariRegionMatches,
    listPriceFor,
    displayPn,
    displayServicePn,
    getReplacement,
    getReplacementAccessories,
    get discountsByCategory() { return state.discountsByCategory; },
    get regions() { return state.raw.regions; },
    get customerTypes() { return state.raw.customerTypes; },
    get paymentTerms() { return state.raw.paymentTerms; },
    get shippingTerms() { return state.raw.shippingTerms; },
    get restrictedDefaults() { return state.raw.restrictedDefaults; },
    get meta() { return state.raw.meta || {}; },
  };
})();
