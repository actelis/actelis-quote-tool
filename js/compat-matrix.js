/* compat-matrix.js
 * Wraps data/compatibility-matrix.json -- the Actelis Device/Parts
 * Compatibility Matrix built from 44 QIG/QIS/User-Manual PDFs (186 parts x
 * 59 devices/cards). This is the authoritative, per-exact-device source for
 * wizard accessory filtering, layered on TOP OF (not replacing) the
 * broader family-based filtering in NodeWizard.compatibleAccessoryTypes:
 *
 *   - A part explicitly marked 'X' for a device is documented as NOT
 *     compatible and must never be offered for that device.
 *   - A part marked REQ/INC/OPT/COND is documented as compatible (COND
 *     carries a specific condition -- surface its note to the user).
 *   - A part/device combination that's simply absent from the matrix is
 *     NOT documented either way in these manuals -- per the matrix's own
 *     Read Me, that must NOT be treated as incompatible. Only an explicit
 *     'X' excludes a part; everything else is left to the existing
 *     family-based filtering.
 *
 * The MLU/SDU/chassis-card corner of the matrix (11 cards x 4 chassis
 * variants) is fully populated and is used as the sole source of truth for
 * that specific case (see NodeWizard.excludedMluPns/sduPnsForSelection/
 * mluConditionNote in wizard-node.js) rather than just an X-exclusion
 * layer, since that part of the matrix has no coverage gaps to worry about.
 */
const CompatMatrix = (() => {
  let data = null; // data/compatibility-matrix.json, set by init()
  let pnToColumn = null; // Map<partNumber, deviceColumnName>, built lazily

  // A handful of real catalog part numbers the matrix's own "Model part
  // number(s)" column couldn't state (either because the manuals don't
  // print one, or -- as here -- because the live catalog only carries a
  // variant the matrix treats as a distinct column). Documented per entry;
  // never guessed at runtime.
  const MANUAL_DEVICE_OVERRIDES = {
    // Our catalog's only ML2300-family chassis part is the archived
    // "Chassis 2000 Shelf, ETSI" (502R02030) -- its own description says
    // ETSI, which the matrix treats as the separate front-access chassis
    // (distinct MLU rules: rear-access MLU-32ER/32DR/64DR are NOT
    // compatible there, vs. plain CHS-2000). The matrix's canonical
    // CHS-2000 PN (502R02010) isn't in our catalog at all.
    '502R02030': 'ML2300 ETSI (front access)',
  };

  function init(raw) {
    data = raw;
    pnToColumn = new Map();
    (data.deviceColumns || []).forEach(dc => {
      (dc.modelPNs || []).forEach(pn => pnToColumn.set(pn, dc.name));
    });
    Object.entries(MANUAL_DEVICE_OVERRIDES).forEach(([pn, col]) => {
      if (!pnToColumn.has(pn)) pnToColumn.set(pn, col);
    });
  }

  // Ensures init() ran even if called before DataStore.load() resolved
  // (defensive -- app.js always loads DataStore first in practice).
  function ensureInit() {
    if (!data && window.DataStore && DataStore.raw && DataStore.raw.compatMatrix) {
      init(DataStore.raw.compatMatrix);
    }
  }

  // The matrix's device-column name for a real catalog CO/CPE part number,
  // or null if that device isn't one the matrix could identify a PN for
  // (either not covered by the source manuals, or listed with no PN --
  // see the matrix's own Read Me "No PN in docs" note).
  function deviceColumnFor(partNumber) {
    ensureInit();
    if (!partNumber || !pnToColumn) return null;
    return pnToColumn.get(partNumber) || null;
  }

  function partRecord(partNumber) {
    ensureInit();
    if (!data) return null;
    return data.parts.find(p => p.partNumber === partNumber) || null;
  }

  // {status, note} for this exact part/device combination, or null if the
  // matrix doesn't document that combination at all (NOT the same as 'X'
  // -- see this file's header comment).
  function statusFor(deviceColumn, partNumber) {
    if (!deviceColumn || !partNumber) return null;
    const part = partRecord(partNumber);
    if (!part || !part.compat) return null;
    return part.compat[deviceColumn] || null;
  }

  // Drops any row the matrix explicitly documents as NOT compatible ('X')
  // with `deviceColumn`. Rows the matrix is silent on, or marks
  // REQ/INC/OPT/COND, pass through unchanged -- this only ever narrows.
  // Returns `rows` unchanged if `deviceColumn` is null (no recognized
  // device, or a device the matrix has no data for).
  function excludeIncompatible(rows, deviceColumn) {
    if (!deviceColumn) return rows;
    return rows.filter(r => {
      const info = statusFor(deviceColumn, r.partNumber);
      return !info || info.status !== 'X';
    });
  }

  // Human-readable note for a COND (or any noted) part on this device, or
  // null. Used to show *why* a part is conditional right in the wizard,
  // e.g. "Only with SDU-450/450G/455G (not SDU-440/G)."
  function noteFor(deviceColumn, partNumber) {
    const info = statusFor(deviceColumn, partNumber);
    return (info && info.note) || null;
  }

  return { init, ensureInit, deviceColumnFor, partRecord, statusFor, excludeIncompatible, noteFor };
})();
