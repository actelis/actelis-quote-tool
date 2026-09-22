/* pricelist.js
 * Category- and single-item discount overrides for the standalone Price
 * List page (price-list.html), plus the data/PDF-export glue for that
 * page's "Export PDF" button (the actual PDF drawing lives in pdf.js, next
 * to the Quote Builder's own PDF generator, since both use the same
 * pdf-lib helpers).
 *
 * These overrides are intentionally separate from the Quote Builder's BOM
 * discount override (Quote.setLineDiscount/effectiveDiscount in quote.js):
 * they're not tied to a quote or a BOM line at all -- they only change what
 * this page displays and what its own PDF export prints, e.g. for handing a
 * pre-discounted price list to one customer without starting a quote. They
 * never touch the saved price list or discount-matrix data (data/*.json) --
 * that stays admin/git-push-only, same as everywhere else on this site.
 *
 * Three-level fallback per row, same idea as the BOM's item-override-over-
 * default pattern, with a category layer in between:
 *   1. an explicit per-item override (set on one row in the table), else
 *   2. a per-category override (set once, applies to every row in that
 *      category that doesn't have its own item override), else
 *   3. the standard region/customer-type default (DiscountEngine).
 *
 * Session-scoped only, same convention as the rest of this site: mirrored
 * to sessionStorage so it survives navigating between price-list.html and
 * index.html in the same browser tab, and is gone when the tab closes.
 * Nothing here is uploaded or saved to a file unless the user clicks
 * Export PDF.
 */
const PriceListPricing = (() => {
  const STORAGE_KEY = 'actelis-pricelist-overrides';

  let categoryOverrides = {};  // { [category string]: fraction }
  let itemOverrides = {};      // { [partNumber]: fraction }
  let customerName = '';

  function persist() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ categoryOverrides, itemOverrides, customerName }));
    } catch (e) {
      console.warn('PriceListPricing: could not persist to sessionStorage.', e);
    }
  }
  function restore() {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.categoryOverrides && typeof d.categoryOverrides === 'object') categoryOverrides = d.categoryOverrides;
      if (d.itemOverrides && typeof d.itemOverrides === 'object') itemOverrides = d.itemOverrides;
      if (typeof d.customerName === 'string') customerName = d.customerName;
    } catch (e) {
      console.warn('PriceListPricing: could not restore from sessionStorage.', e);
    }
  }
  restore();

  // Passing discount as null/undefined/NaN clears that override.
  function setCategoryOverride(category, discount) {
    if (!category) return;
    if (discount == null || Number.isNaN(discount)) delete categoryOverrides[category];
    else categoryOverrides[category] = discount;
    persist();
  }
  function getCategoryOverride(category) {
    return category != null && categoryOverrides[category] != null ? categoryOverrides[category] : null;
  }
  function setItemOverride(partNumber, discount) {
    if (!partNumber) return;
    if (discount == null || Number.isNaN(discount)) delete itemOverrides[partNumber];
    else itemOverrides[partNumber] = discount;
    persist();
  }
  function getItemOverride(partNumber) {
    return partNumber != null && itemOverrides[partNumber] != null ? itemOverrides[partNumber] : null;
  }
  function setCustomerName(name) { customerName = name || ''; persist(); }
  function getCustomerName() { return customerName; }

  function clearAll() {
    categoryOverrides = {};
    itemOverrides = {};
    persist();
  }

  // The discount actually in effect for a hardware/archive row (never used
  // for Type-D rows -- those are percent-of-BOM or flat, not category-
  // discount-driven, and the price-list page already shows them that way).
  function effectiveDiscount(row, ctx) {
    if (!row) return 0;
    const item = getItemOverride(row.partNumber);
    if (item != null) return item;
    const cat = getCategoryOverride(row.category);
    if (cat != null) return cat;
    return DataStore.getPriceRow(row.partNumber) ? DiscountEngine.getCustomerDiscount(row.partNumber, 1, ctx) : 0;
  }

  return {
    setCategoryOverride, getCategoryOverride, setItemOverride, getItemOverride,
    setCustomerName, getCustomerName, effectiveDiscount, clearAll,
    get categoryOverrides() { return categoryOverrides; },
    get itemOverrides() { return itemOverrides; },
  };
})();
