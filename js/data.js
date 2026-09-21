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
    }
    for (const row of state.raw.pnTypeDRegion) {
      state.pnTypeDRegionSet.add(`${row.regionId}|${row.partNumber}`);
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

  function getListPrice(partNumber) {
    const row = getPriceRow(partNumber);
    if (!row) return null;
    return row.listPrice;
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
      rows = rows.filter(r => !r.region || r.region.includes(region));
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

  function isVisibleInRegion(partNumber, regionId, isTypeD) {
    const set = isTypeD ? state.pnTypeDRegionSet : state.pnRegionSet;
    // Absence from the mapping table means "valid everywhere" (mirrors the
    // Access queries which LEFT JOIN and treat NULL region as universal).
    const anyRestriction = [...set].some(k => k.endsWith(`|${partNumber}`));
    if (!anyRestriction) return true;
    return set.has(`${regionId}|${partNumber}`);
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
    get discountsByCategory() { return state.discountsByCategory; },
    get regions() { return state.raw.regions; },
    get customerTypes() { return state.raw.customerTypes; },
    get paymentTerms() { return state.raw.paymentTerms; },
    get shippingTerms() { return state.raw.shippingTerms; },
    get restrictedDefaults() { return state.raw.restrictedDefaults; },
  };
})();
