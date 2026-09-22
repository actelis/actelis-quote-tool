/* admin.js
 * "ADMIN — PRICE LIST MANAGER" and "REPLACEMENTS MANAGER" modals.
 *
 * These implement the user's explicit requirement that price/part-
 * replacement updates be restricted to authorized personnel AND applied
 * globally (the same for every visitor) — without adding a server, a
 * database, or any live write to GitHub from this static site:
 *
 *   Step 1  Upload a CSV/XLSX price list (or replacements list)
 *   Step 2  Preview the diff against the data currently bundled in the site
 *   Step 3  Download the regenerated data/*.json file(s)
 *   Step 4  The authorized person commits + pushes those files to the repo,
 *           exactly the same way they pushed the site itself — GitHub Pages
 *           redeploys automatically, and every visitor then sees the update.
 *
 * There is no GitHub API call anywhere in this file, no token, and nothing
 * is written back to this browser's storage as a "local override" — the
 * only way pricing data changes for anyone is a real commit to the repo.
 */
const Admin = (() => {

  // ---------------------------------------------------------------------
  // Generic CSV / XLSX file reading -> array of {header: value} row objects
  // ---------------------------------------------------------------------
  function parseCSV(text) {
    // Minimal RFC4180-ish parser: handles quoted fields with embedded commas
    // and doubled quotes, \r\n or \n line endings.
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const filtered = rows.filter(r => r.some(v => String(v).trim() !== ''));
    if (!filtered.length) return [];
    const headers = filtered[0].map(h => String(h).trim());
    return filtered.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] == null ? '' : r[i]; });
      return obj;
    });
  }

  function readFileAsRows(file) {
    return new Promise((resolve, reject) => {
      const isXlsx = /\.xlsx?$/i.test(file.name);
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      if (isXlsx) {
        reader.onload = () => {
          try {
            if (typeof XLSX === 'undefined') throw new Error('SheetJS (xlsx) is not loaded on this page.');
            const wb = XLSX.read(reader.result, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            resolve(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
          } catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = () => {
          try { resolve(parseCSV(String(reader.result))); } catch (e) { reject(e); }
        };
        reader.readAsText(file);
      }
    });
  }

  function pickField(row, aliases) {
    const keys = Object.keys(row);
    for (const alias of aliases) {
      const hit = keys.find(k => k.trim().toLowerCase() === alias.toLowerCase());
      if (hit !== undefined) return row[hit];
    }
    return undefined;
  }

  function toNum(v) {
    if (v == null) return NaN;
    const n = parseFloat(String(v).replace(/[,$]/g, '').trim());
    return n;
  }

  function money(n) { return (Math.round((n || 0) * 100) / 100).toFixed(2); }

  // ---------------------------------------------------------------------
  // Hardware / Type-D price list parsing (matches List_Price_Q1_2026.xlsx:
  // Category, Part Num, Description, Comments, LP $ — a single flat table
  // spanning A/B/C hardware AND D services/warranty rows.)
  // ---------------------------------------------------------------------
  function parseHardwareRows(rawRows) {
    const hardware = [], typeD = [], skipped = [];
    rawRows.forEach(r => {
      const category = String(pickField(r, ['Category']) ?? '').trim();
      const partNumber = String(pickField(r, ['Part Num', 'Part Number', 'PN', 'Part #']) ?? '').trim();
      const description = String(pickField(r, ['Description']) ?? '').trim();
      const comments = String(pickField(r, ['Comments']) ?? '').trim();
      const lpRaw = pickField(r, ['LP $', 'LP', 'List Price', 'ListPrice']);
      if (!category || !partNumber) { skipped.push(r); return; }
      const letter = category.charAt(0).toUpperCase();
      const lpStr = String(lpRaw ?? '').trim();

      if (letter === 'D') {
        const pctMatch = lpStr.match(/(\d+(?:\.\d+)?)\s*%/);
        let listPrice = null, listPriceString = lpStr;
        if (pctMatch) {
          listPrice = parseFloat(pctMatch[1]) / 100;
        } else if (/^-?\d+(\.\d+)?$/.test(lpStr.replace(/[,$]/g, ''))) {
          listPrice = toNum(lpStr);
          listPriceString = lpStr;
        } else {
          listPrice = 0; // e.g. "Included in Initial Purchase"
        }
        typeD.push({ partNumber, description, comments, category, listPrice, listPriceString });
      } else {
        const n = toNum(lpStr);
        hardware.push({ partNumber, description, comments, category, listPrice: isNaN(n) ? null : n });
      }
    });
    return { hardware, typeD, skipped };
  }

  // Merges freshly-parsed rows on top of the currently-loaded data: existing
  // metadata fields the site relies on (sorting/legacy/showPriceList for
  // hardware; includeLP/includeQuote/defaultQty/sortOrder/purchasePrice/
  // legacy for Type-D) are preserved for part numbers that already exist,
  // and sensible defaults are used for brand-new part numbers.
  function mergeHardware(parsedHardware) {
    const currentByPn = new Map(DataStore.raw.priceList.map(r => [r.partNumber, r]));
    return parsedHardware.map(p => {
      const cur = currentByPn.get(p.partNumber);
      return {
        partNumber: p.partNumber,
        description: p.description,
        comments: p.comments,
        listPrice: p.listPrice,
        category: p.category,
        sorting: cur ? cur.sorting : null,
        legacy: cur ? cur.legacy : false,
        showPriceList: cur ? cur.showPriceList : true,
      };
    });
  }
  function mergeTypeD(parsedTypeD) {
    const currentByPn = new Map(DataStore.raw.typeD.map(r => [r.partNumber, r]));
    return parsedTypeD.map(p => {
      const cur = currentByPn.get(p.partNumber);
      return {
        partNumber: p.partNumber,
        description: p.description,
        comments: p.comments,
        listPriceString: p.listPriceString,
        listPrice: p.listPrice,
        purchasePrice: cur ? cur.purchasePrice : false,
        listPrice2: cur ? cur.listPrice2 : null,
        category: p.category,
        legacy: cur ? cur.legacy : false,
        includeLP: cur ? cur.includeLP : false,
        includeQuote: cur ? cur.includeQuote : true,
        includeQuote2: cur ? cur.includeQuote2 : false,
        defaultQty: cur ? cur.defaultQty : 1,
        sortOrder: cur ? cur.sortOrder : null,
      };
    });
  }

  function diffByPartNumber(currentRows, newRows, fields) {
    const curByPn = new Map(currentRows.map(r => [r.partNumber, r]));
    const newByPn = new Map(newRows.map(r => [r.partNumber, r]));
    const added = [], changed = [], removed = [], unchanged = [];
    newRows.forEach(n => {
      const c = curByPn.get(n.partNumber);
      if (!c) { added.push(n); return; }
      const diffFields = fields.filter(f => String(c[f] ?? '') !== String(n[f] ?? ''));
      if (diffFields.length) changed.push({ old: c, new: n, diffFields });
      else unchanged.push(n);
    });
    currentRows.forEach(c => { if (!newByPn.has(c.partNumber)) removed.push(c); });
    return { added, changed, removed, unchanged };
  }

  function renderDiffSummary(container, diff, keyLabel) {
    container.innerHTML = '';
    const chips = el('div', { class: 'diff-summary' }, [
      el('span', { class: 'diff-chip added' }, `+${diff.added.length} added`),
      el('span', { class: 'diff-chip changed' }, `~${diff.changed.length} changed`),
      el('span', { class: 'diff-chip removed' }, `-${diff.removed.length} removed`),
      el('span', { class: 'diff-chip unchanged' }, `${diff.unchanged.length} unchanged`),
    ]);
    container.appendChild(chips);

    const rows = [];
    diff.added.forEach(r => rows.push({ cls: 'diff-added', key: r.partNumber, note: 'new part number' }));
    diff.changed.forEach(r => rows.push({ cls: 'diff-changed', key: r.new.partNumber, note: `changed: ${r.diffFields.join(', ')}` }));
    diff.removed.forEach(r => rows.push({ cls: 'diff-removed', key: r.partNumber, note: 'not present in uploaded file — will be dropped' }));

    if (!rows.length) {
      container.appendChild(el('p', { style: 'color:var(--text-muted);font-size:13px' }, 'No differences from the currently-loaded data.'));
      return;
    }
    const table = el('table', { class: 'diff-table' }, [
      el('thead', {}, el('tr', {}, [el('th', {}, keyLabel), el('th', {}, 'Change')])),
    ]);
    const tbody = el('tbody');
    rows.slice(0, 400).forEach(r => tbody.appendChild(el('tr', { class: r.cls }, [el('td', {}, r.key), el('td', {}, r.note)])));
    table.appendChild(tbody);
    container.appendChild(table);
    if (rows.length > 400) container.appendChild(el('p', { style: 'color:var(--text-muted);font-size:12px' }, `…and ${rows.length - 400} more.`));
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

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------------
  // Discount table parsing (Category, Category Type, Discount, Discount End
  // User, Registration Discount, Discount EMEA, Discount End User EMEA,
  // Warranty — matches data/discounts.json's field shape).
  // ---------------------------------------------------------------------
  function toFraction(v) {
    if (v == null || v === '') return 0;
    const s = String(v).trim();
    if (s.endsWith('%')) return parseFloat(s) / 100;
    const n = parseFloat(s);
    if (isNaN(n)) return 0;
    return n > 1 ? n / 100 : n;
  }
  function parseDiscountRows(rawRows) {
    return rawRows.map(r => ({
      category: String(pickField(r, ['Category']) ?? '').trim(),
      categoryType: String(pickField(r, ['Category Type', 'CategoryType', 'Type']) ?? '').trim(),
      discount: toFraction(pickField(r, ['Discount', 'Reseller Discount', 'Discount NA', 'Reseller NA Discount'])),
      discountEndUser: toFraction(pickField(r, ['Discount End User', 'End Customer Discount', 'End User Discount NA'])),
      registrationDiscount: toFraction(pickField(r, ['Registration Discount', 'Deal Reg Discount'])),
      discountEMEA: toFraction(pickField(r, ['Discount EMEA', 'Reseller EMEA Discount'])),
      discountEndUserEMEA: toFraction(pickField(r, ['Discount End User EMEA', 'End Customer EMEA Discount'])),
      warranty: String(pickField(r, ['Warranty', 'Default Warranty']) ?? '').trim(),
    })).filter(r => r.category);
  }

  // ---------------------------------------------------------------------
  // Replacements (discontinued -> current part number), surfaced in the
  // BOM/search UI by DataStore.getReplacement().
  // ---------------------------------------------------------------------
  function parseReplacementRows(rawRows) {
    return rawRows.map(r => ({
      oldPartNumber: String(pickField(r, ['Old Part Number', 'Old PN', 'Old Part #', 'Discontinued']) ?? '').trim(),
      newPartNumber: String(pickField(r, ['New Part Number', 'New PN', 'New Part #', 'Replacement']) ?? '').trim(),
      notes: String(pickField(r, ['Notes', 'Comments']) ?? '').trim(),
    })).filter(r => r.oldPartNumber);
  }

  return {
    parseCSV, readFileAsRows, pickField, toNum, money, el, downloadJSON,
    parseHardwareRows, mergeHardware, mergeTypeD, diffByPartNumber, renderDiffSummary,
    parseDiscountRows, parseReplacementRows,
  };
})();
