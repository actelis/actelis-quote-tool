/* wizard-ems.js
 * Faithful port of Form_Wizard-EMS.txt (314 lines, captured in full).
 * Adds EMS software-licensing line items to the active site's BOM.
 */
const EMSWizard = (() => {
  function pn(pnType, extra) {
    const row = DataStore.findOneByPnType(pnType, extra);
    return row ? row.partNumber : null;
  }

  function ceilDiv(a, b) {
    return Math.round(-(-a / b)); // VBA: -Round(-x/y,0) == ceil for positive x,y
  }

  // input: {
  //   existingEMS: bool, existingSiteLicenses: 'Right to Use'|'>1000'|number|null,
  //   rtuLicense: bool, siteLicenses: number,
  //   nodeLicenses: partNumber|'None', aggregatorLicenses: partNumber|'None',
  //   thirdPartyLicenses: partNumber|'None', clients: number,
  //   redundancy: bool, redundancyExtn: bool, pmStats: bool, pmQty: number,
  //   topology: bool, snmpNB: bool, xmlNB: bool, restNB: bool,
  //   emailAlarms: bool, security: bool,
  // }
  function run(input) {
    const adds = []; // { partNumber, qty }
    const notes = [];

    if (input.siteLicenses == null || isNaN(input.siteLicenses)) {
      throw new Error('Please enter the maximum number of NEs required');
    }

    let maxNEs;
    if (input.existingEMS) {
      if (input.existingSiteLicenses == null) {
        throw new Error('Please enter the existing Site license');
      }
      let existing;
      if (input.existingSiteLicenses === '>1000') existing = 10000;
      else if (input.existingSiteLicenses === 'Right to Use') existing = -1;
      else existing = Number(input.existingSiteLicenses);

      if (existing !== -1) {
        maxNEs = input.siteLicenses > existing ? input.siteLicenses - existing : 0;
      } else {
        maxNEs = -1;
      }
    } else {
      maxNEs = input.siteLicenses;
    }

    // Site licenses tiering
    if (maxNEs === 0 || maxNEs === -1) {
      // none
    } else if (maxNEs <= 100) {
      adds.push({ partNumber: findSiteTier(100), qty: 1 });
    } else if (maxNEs <= 200) {
      adds.push({ partNumber: findSiteTier(100), qty: 2 });
    } else if (maxNEs <= 500) {
      adds.push({ partNumber: findSiteTier(500), qty: 1 });
    } else if (maxNEs <= 1000) {
      adds.push({ partNumber: findSiteTier(1000), qty: 1 });
    } else {
      adds.push({ partNumber: findSiteTier(10000), qty: 1 });
    }

    if (input.existingSiteLicenses === 'Right to Use' || input.rtuLicense) {
      const rtuPn = pn('EMSRTU');
      if (rtuPn) adds.push({ partNumber: rtuPn, qty: input.siteLicenses });
      notes.push(input.existingEMS
        ? "Please manually update the cost of the Right to Use licenses as 10% of the list value of the new equipment"
        : "Please manually update the cost of the Right to Use licenses as 10% of the list value of the network - minimum fee is $5,000");
    } else {
      if (input.nodeLicenses && input.nodeLicenses !== 'None') adds.push({ partNumber: input.nodeLicenses, qty: 1 });
      if (input.aggregatorLicenses && input.aggregatorLicenses !== 'None') adds.push({ partNumber: input.aggregatorLicenses, qty: 1 });
      if (input.thirdPartyLicenses && input.thirdPartyLicenses !== 'None') adds.push({ partNumber: input.thirdPartyLicenses, qty: 1 });
    }

    if (input.clients) {
      const clientPn = pn('EMSCLIENT');
      if (clientPn) adds.push({ partNumber: clientPn, qty: ceilDiv(input.clients, 5) });
    }

    if (input.redundancy) {
      const redunPn = pn('EMSREDUN');
      if (redunPn) {
        if (input.existingEMS && input.redundancyExtn) {
          adds.push({ partNumber: redunPn, qty: ceilDiv(maxNEs, 100) });
        } else {
          adds.push({ partNumber: redunPn, qty: ceilDiv(input.siteLicenses, 100) });
        }
      }
    }

    if (input.pmStats && input.pmQty) {
      const statsPn = pn('EMSSTATS');
      if (statsPn) adds.push({ partNumber: statsPn, qty: input.pmQty / 100 });
    }

    if (input.topology) {
      const topPn = pn('EMSTOP');
      if (topPn) adds.push({ partNumber: topPn, qty: ceilDiv(input.siteLicenses, 100) });
    }

    if (input.snmpNB) { const p = pn('EMSNB'); if (p) adds.push({ partNumber: p, qty: 1 }); }
    if (input.xmlNB) { const p = pn('EMSXML'); if (p) adds.push({ partNumber: p, qty: 1 }); }
    if (input.restNB) { const p = pn('EMSREST'); if (p) adds.push({ partNumber: p, qty: 1 }); }
    if (input.emailAlarms) { const p = pn('EMSEMAIL'); if (p) adds.push({ partNumber: p, qty: 1 }); }
    if (input.security) { const p = pn('EMSFIPS'); if (p) adds.push({ partNumber: p, qty: 1 }); }

    return { adds: adds.filter(a => a.partNumber), notes };
  }

  function findSiteTier(numPairsValue) {
    const rows = DataStore.findByPnType('EMSSITE');
    const match = rows.find(r => r.numPairs === numPairsValue);
    return match ? match.partNumber : null;
  }

  function apply(input, siteIndex) {
    const { adds, notes } = run(input);
    adds.forEach(a => Quote.addToQuote(a.partNumber, a.qty, siteIndex));
    return notes;
  }

  return { run, apply };
})();
