/* discount.js
 * Port of the discount engine from General.txt (GetDefaultDiscount /
 * GetCustomerDiscount) in the Access tool.
 *
 * Differences from the original, per the "no customer database online" scope:
 *  - CustomerDefaultDiscounts (per-customer / per-part overrides, tiered by
 *    MinQty) lived in the back-end data file and is NOT available online —
 *    there is no saved customer record to key off of. The online tool always
 *    falls back to the default region/category discount matrix.
 *  - Deal Registration is still supported as a per-quote toggle (hidden for
 *    EMEA/APAC, matching the original UI).
 *  - V3.23+: Commercial quotes price off the separate Commercial list price
 *    (DataStore.listPriceFor) before the discount is applied.
 */
const DiscountEngine = (() => {

  function isEmeaApac(region) {
    return region === 'EMEA' || region === 'APAC';
  }
  // Every other region (Commercial, Federal, CALA, All) uses the base
  // Discount/DiscountEndUser columns, exactly as GetCustomerDiscount does.

  // GetDefaultDiscount(customerType, categoryType) — used for a whole
  // category-type bucket (rarely needed directly by the UI; kept for parity).
  function getDefaultDiscount(customerType, categoryType, region) {
    const row = DataStore.discountsByCategoryType ? null : null;
    return 0; // not used directly by the UI — see getCustomerDiscount below
  }

  // GetCustomerDiscount(partNumber, qty, { customerType, region, dealRegistration })
  // Returns a fraction (e.g. 0.33 == 33% off list).
  function getCustomerDiscount(partNumber, qty, ctx) {
    const priceRow = DataStore.getPriceRow(partNumber);
    if (!priceRow) return 0;
    const category = priceRow.category;
    const discRow = DataStore.discountsByCategory.get(category);
    if (!discRow) return 0;

    const { customerType, region, dealRegistration } = ctx;
    let discount;
    if (isEmeaApac(region)) {
      discount = customerType === 'Reseller' ? discRow.discountEMEA : discRow.discountEndUserEMEA;
    } else {
      discount = customerType === 'Reseller' ? discRow.discount : discRow.discountEndUser;
    }
    discount = discount || 0;

    // Deal Registration bonus — hidden for EMEA/APAC in the original UI
    // (Commercial, Federal, CALA and All quotes can all register a deal).
    if (dealRegistration && region !== 'EMEA' && region !== 'APAC') {
      discount += (discRow.registrationDiscount || 0);
    }
    return discount;
  }

  // Net unit price = region list price x (1 - discount). The region list
  // price is the Commercial ("NA List Price") column on Commercial quotes —
  // see DataStore.listPriceFor.
  function netPrice(partNumber, qty, ctx) {
    const priceRow = DataStore.getPriceRow(partNumber);
    const lp = priceRow ? DataStore.listPriceFor(priceRow, ctx && ctx.region) : null;
    if (lp == null) return 0;
    const discount = getCustomerDiscount(partNumber, qty, ctx);
    return lp * (1 - discount);
  }

  return { getCustomerDiscount, netPrice, isEmeaApac };
})();
