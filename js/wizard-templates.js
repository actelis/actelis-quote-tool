/* wizard-templates.js
 * Replaces the Access "WizardTemplates" table (LoadTemplate_Click /
 * DelTemplate_Click in Form_Wizard-Network.txt, and the analogous save/recall
 * UI on the other wizards) with browser localStorage.
 *
 * IMPORTANT — scope decision: templates only ever hold wizard INPUT FIELDS
 * (model choices, quantities, checkboxes) for the Node/Network/EMS wizards.
 * They never contain a customer name, quote number, or price. This is
 * explicitly opt-in device-local storage, separate from the in-memory-only
 * Quote/session data, and is called out to the user in the UI (see
 * "Saved on this device only" label wherever templates are listed).
 *
 * Storage shape (localStorage key 'actelis-wizard-templates'):
 *   { node: { "<name>": {state...} }, network: {...}, ems: {...} }
 */
const WizardTemplates = (() => {
  const STORAGE_KEY = 'actelis-wizard-templates';

  function available() {
    try {
      const k = '__actelis_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readAll() {
    if (!available()) return { node: {}, network: {}, ems: {} };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { node: {}, network: {}, ems: {}, ...parsed };
    } catch (e) {
      console.warn('WizardTemplates: could not read localStorage, starting empty.', e);
      return { node: {}, network: {}, ems: {} };
    }
  }

  function writeAll(data) {
    if (!available()) return false;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('WizardTemplates: could not write localStorage (quota or private mode?).', e);
      return false;
    }
  }

  // wizard: 'node' | 'network' | 'ems'
  function list(wizard) {
    const all = readAll();
    return Object.keys(all[wizard] || {}).sort((a, b) => a.localeCompare(b));
  }

  function save(wizard, name, state) {
    if (!name || !name.trim()) throw new Error('Please enter a template name.');
    const all = readAll();
    if (!all[wizard]) all[wizard] = {};
    all[wizard][name.trim()] = { savedAt: new Date().toISOString(), state };
    return writeAll(all);
  }

  function load(wizard, name) {
    const all = readAll();
    const entry = all[wizard] && all[wizard][name];
    return entry ? entry.state : null;
  }

  function remove(wizard, name) {
    const all = readAll();
    if (all[wizard] && all[wizard][name]) {
      delete all[wizard][name];
      return writeAll(all);
    }
    return false;
  }

  function exists(wizard, name) {
    const all = readAll();
    return !!(all[wizard] && all[wizard][name]);
  }

  return { available, list, save, load, remove, exists };
})();
