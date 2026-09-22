/* wizard-node.js
 * Port of Form_Wizard-Node.txt (single-link Node Configurator, no repeaters).
 * Two phases, mirroring the Access form exactly:
 *   1. classify(coModel)   -> CO_Model_AfterUpdate: derives PTMPType/PTMPModel
 *      and which fields are relevant for this CO model.
 *   2. calculate(state)    -> Next_Click: the full BOM quantity math.
 *
 * Note: some of the very fine-grained dropdown *filtering* rules from the
 * original (e.g. exact SFP Info sub-cases, OEM-specific mounting kit lists)
 * are simplified to "show all plausible options for this PN Type" rather
 * than reproducing every nested Select-Case RowSource filter. The pricing
 * math itself (this file's `calculate`) is a faithful line-by-line port.
 */
const NodeWizard = (() => {

  function dlPnType(coModel) {
    const row = DataStore.getPriceRow(coModel);
    const ari = DataStore.raw.autoRepeaterInfo.find(r => r.partNumber === coModel);
    return ari ? ari.pnType : null;
  }
  function ariRow(partNumber) {
    return DataStore.raw.autoRepeaterInfo.find(r => r.partNumber === partNumber) || null;
  }
  function priceDesc(partNumber) {
    const row = DataStore.getPriceRow(partNumber);
    return row ? row.description : '';
  }

  // Restores the family-specific dropdown filtering the original Access
  // wizard applied via nested RowSource queries (see this file's header
  // comment — it had been simplified to "show every family's options
  // together", which let a user pick a physically incompatible power
  // supply/mounting-kit/cable, e.g. an "AC-DC Adapter for ML700" for an
  // ML600D unit). Returns, for the given classified device, which
  // AutoRepeaterInfo "PN Type"(s) are actually compatible for each of the
  // three device-specific accessory fields (AC/DC Adapter, Mounting Kit,
  // and the CO-side Copper Cable field(s)). An empty array means "no
  // compatible option for this device — only None should be offered" (e.g.
  // Mounting Kit for a Chassis CO model, which mounts differently).
  //
  // Pass classified = null (no CO model chosen yet) to get the full,
  // unfiltered union for each field — this is what every dropdown showed
  // before a device was picked, and still does here.
  function compatibleAccessoryTypes(classified) {
    const ALL = {
      acdc: ['PTP AC', 'PTP-D AC', 'PTP-D ACPOE', 'PTP ML620i AC', 'PTP ML650x AC', 'PTP ML700 AC'],
      mounting: ['ML5xx Mounting', 'ML600 Mounting'],
      copperCO: ['ML600 Cable (No PFU)', 'PTP-D Cable'],
      copperGeneric: ['ML600 Cable (No PFU)', 'CHS-2000B Cable', 'PTP-D Cable'],
    };
    if (!classified) return ALL;
    const { ptmpType, ptmpModel } = classified;

    let acdc = [];
    if (ptmpModel === 'ML700CO' || ptmpModel === 'ML700CPE') acdc = ['PTP ML700 AC'];
    else if (ptmpModel === 'ML650x') acdc = ['PTP ML650x AC'];
    else if (ptmpModel === 'ML620i' || ptmpModel === 'ML600iKit') acdc = ['PTP ML620i AC'];
    else if (ptmpModel === 'ML600D') acdc = ['PTP-D AC', 'PTP-D ACPOE'];
    else if (ptmpType === 'ML600' || ptmpType === 'ML500') acdc = ['PTP AC'];
    // ML40 / ML5xx / Chassis: no modeled AC/DC adapter type — matches
    // classify()'s showCOPowering, which is already false for these.

    let mounting = [];
    if (ptmpType === 'ML5xx') mounting = ['ML5xx Mounting'];
    else if (['ML500', 'ML600', 'ML700'].includes(ptmpType) && ptmpModel !== 'ML600D' && ptmpModel !== 'ML2316Kit') {
      mounting = ['ML600 Mounting'];
    }
    // ML40 / ML600D / ML2316Kit / Chassis: no mounting kit modeled here —
    // matches classify()'s showMountingKit exclusions.

    let copperCO = [];
    if (ptmpModel === 'ML600D') copperCO = ['PTP-D Cable'];
    else if (['ML500', 'ML600', 'ML700'].includes(ptmpType)) copperCO = ['ML600 Cable (No PFU)'];

    const copperGeneric = ptmpType === 'Chassis' ? ['CHS-2000B Cable'] : copperCO;

    return { acdc, mounting, copperCO, copperGeneric };
  }

  // ---- Phase 1: classify (CO_Model_AfterUpdate) ----
  function classify(coModel, legacyOk) {
    const pnType = dlPnType(coModel);
    let ptmpType, ptmpModel;

    if (pnType === 'PTMP CO') {
      ptmpType = 'Chassis';
      const desc = priceDesc(coModel);
      if (desc.includes('Chassis 100 Shelf')) {
        ptmpModel = 'CHS-100';
      } else if (desc.includes('Chassis 200 Shelf')) {
        ptmpModel = 'CHS-200';
      } else if (desc.includes('Chassis 2000')) {
        ptmpModel = desc.includes('2000B') ? 'CHS-2000B' : 'CHS-2000';
      } else {
        ptmpType = 'ML600'; ptmpModel = 'ML688';
      }
    } else {
      switch (pnType) {
        case 'PTP CPE': ptmpType = 'ML40'; ptmpModel = 'ML40'; break;
        case 'PTP TDM': ptmpType = 'ML600'; ptmpModel = 'ML650x'; break;
        case 'PTP ML500': ptmpType = 'ML500'; ptmpModel = 'ML500'; break;
        case 'PTPR Fiber':
        case 'PTPD Fiber': {
          ptmpType = 'ML5xx';
          const suf = priceDesc(coModel).slice(-2);
          ptmpModel = (suf === 'DC' || suf === 'AD') ? 'ML5xx-DC' : (suf === 'AC' ? 'ML5xx-AC' : 'ML5xx');
          break;
        }
        case 'PTP Bundle': ptmpType = 'ML600'; ptmpModel = 'ML600Kit'; break;
        case 'PTMP Bundle': ptmpType = 'ML600'; ptmpModel = 'ML2316Kit'; break;
        case 'PTP ML620i CPE': ptmpType = 'ML600'; ptmpModel = 'ML620i'; break;
        case 'PTP ML620i Bundle': ptmpType = 'ML600'; ptmpModel = 'ML600iKit'; break;
        case 'PTP ML700 CO': ptmpType = 'ML700'; ptmpModel = 'ML700CO'; break;
        case 'PTP ML700 CPE': ptmpType = 'ML700'; ptmpModel = 'ML700CPE'; break;
        case 'PTP-D': ptmpType = 'ML600'; ptmpModel = 'ML600D'; break;
        default: ptmpType = 'ML600'; ptmpModel = 'ML600';
      }
    }

    const isStandalone = ['ML500', 'ML5xx', 'ML600', 'ML700', 'ML40'].includes(ptmpType);
    const ari = ariRow(coModel);

    return {
      ptmpType, ptmpModel,
      isChassis: ptmpType === 'Chassis',
      isStandalone,
      showMLU: ptmpType === 'Chassis',
      showSDU: ptmpType === 'Chassis',
      showBundlesToggle: ptmpType === 'Chassis',
      showMLUQty: ptmpModel === 'CHS-200' || ptmpModel === 'CHS-2000' || ptmpModel === 'CHS-2000B',
      mluQtyOptions: ptmpModel === 'CHS-200' ? [1, 2] : (ptmpModel === 'CHS-2000' || ptmpModel === 'CHS-2000B' ? [1, 2, 3, 4] : [1]),
      showCraftCable: isStandalone || ptmpType === 'Chassis' === false, // craft cable relevant for standalone AND PTMP (non-chassis handled below)
      showCOPowering: isStandalone && ptmpType !== 'ML5xx',
      showACDCModel: false, // resolved after COPowering chosen
      showCOSFPModel: isStandalone && ari && ari.sfpInfo && ari.sfpInfo !== 'None',
      showAlarmCable: ptmpType === 'Chassis',
      showMountingKit: isStandalone && ptmpModel !== 'ML40' && ptmpModel !== 'ML2316Kit' && ptmpModel !== 'ML600D',
      showMLEExt: ari && ari.oem === 'SyncE' && ptmpModel !== 'ML2316Kit',
      showCOCopperCable: isStandalone && (ptmpType === 'ML500' || ptmpType === 'ML600' || ptmpType === 'ML700') && ari && ari.numPairs !== 0,
      showPTMPCopperCables: ptmpType === 'Chassis' === false && !isStandalone, // PTMP standalone (non-chassis, non-ML500/600/700/40/5xx) rarely hit
      ari,
    };
  }

  // ---- Phase 2: calculate (Next_Click) ----
  // state: {
  //   coModel, coQuantity, sduModel, mluModel, mluQty, craftCable(bool),
  //   coPowering: 'AC'|'DC', acdcModel, acCable, codcPower(bool),
  //   alarmCable, coSfpModel, sfpQuantity, coFiberCable,
  //   mountingKit(bool), mountingModel, coCopperCable,
  //   cableType, cableLength, ptmpCopperCables(bool), sduRedundancy(bool),
  //   bundles(bool), mleExt(bool), ems(bool), emsInput (for EMSWizard, optional)
  // }
  function calculate(state, classified) {
    const adds = [];
    const add = (partNumber, qty) => { if (partNumber && partNumber !== 'None' && qty) adds.push({ partNumber, qty }); };
    const { ptmpType, ptmpModel } = classified;
    const coQty = state.coQuantity || 1;
    const mluQty = state.mluQty || 1;

    let ptmpBundlePN = 'None';
    if (ptmpType === 'Chassis' && state.bundles) {
      const bundle = DataStore.raw.bundles.find(b =>
        b.pnType === 'PTMP Bundle' && b.chassis === state.coModel && b.sdu === state.sduModel && b.mlu === state.mluModel);
      if (bundle) ptmpBundlePN = bundle.partNumber;
    }

    // Craft cable
    if (state.craftCable) {
      if (ptmpType === 'ML5xx') {
        add(DataStore.findOneByPnType('Craft ML5xx')?.partNumber, 1);
      } else if (ptmpModel === 'ML600D') {
        const oem = classified.ari?.oem;
        const pnType = oem === 'DT' ? 'Craft Cable ML600DT' : (oem === 'NewD' ? 'Craft Cable ML600D New' : 'Craft Cable ML600D');
        add(DataStore.findOneByPnType(pnType)?.partNumber, 1);
      } else {
        add(DataStore.findOneByPnType('Craft Cable')?.partNumber, 1);
      }
    }

    // CO shelf (or bundle)
    if (ptmpBundlePN === 'None') add(state.coModel, coQty);
    else add(ptmpBundlePN, coQty);

    // MLU
    if (ptmpType === 'Chassis') {
      if (ptmpBundlePN === 'None') {
        add(state.mluModel, coQty * mluQty);
      } else if (mluQty !== 1) {
        add(state.mluModel, coQty * (mluQty - 1));
      }
    }

    // SDU
    let sduQuantity = 1;
    if (ptmpType === 'Chassis') {
      const sduIsSDU3xx = !!DataStore.raw.autoRepeaterInfo.find(r => r.partNumber === state.sduModel && r.description?.includes('SDU-3'));
      if ((ptmpModel === 'CHS-2000' || ptmpModel === 'CHS-2000B') && mluQty > 2) {
        if (sduIsSDU3xx) sduQuantity = 2;
      }
      if (sduQuantity === 1) {
        if (state.sduRedundancy) sduQuantity = 2;
        if (ptmpBundlePN === 'None') add(state.sduModel, sduQuantity * coQty);
        else if (sduQuantity === 2) add(state.sduModel, coQty);
      } else {
        const sduDesc = ariRow(state.sduModel)?.description;
        if (sduDesc === 'SDU-340G') {
          if (ptmpBundlePN === 'None') add(state.sduModel, sduQuantity * coQty);
          else add(state.sduModel, coQty);
        } else {
          const sdu340g = DataStore.raw.autoRepeaterInfo.find(r => r.description === 'SDU-340G');
          add(sdu340g?.partNumber, coQty);
          if (ptmpBundlePN === 'None') add(state.sduModel, coQty);
        }
      }
    }

    // Blank panels
    if (ptmpType === 'Chassis' && ptmpBundlePN === 'None') {
      const spareRow = DataStore.raw.spareSlots.find(s => s.partNumber === state.coModel);
      const totalSlots = spareRow ? spareRow.spareSlots : 0;
      let numBlank = coQty * (totalSlots - sduQuantity - mluQty);
      if (numBlank > 0) {
        numBlank = calcBlankPanels(numBlank);
        const blankPanel = DataStore.raw.spareSlots.find(s => s.description === 'Blank Panel Kit');
        add(blankPanel?.partNumber, numBlank);
      }
    }

    // AC/DC Adapter
    if (state.acdcModel && state.acdcModel !== 'None' && ['ML500', 'ML600', 'ML700', 'ML5xx'].includes(ptmpType)) {
      add(state.acdcModel, coQty);
      if (state.acCable && state.acCable !== 'None') add(state.acCable, coQty);
    }

    // DC power cables
    let kitWithDCCable = false;
    if (ptmpBundlePN !== 'None') {
      const bundle = DataStore.raw.bundles.find(b => b.partNumber === ptmpBundlePN);
      kitWithDCCable = !!(bundle && bundle.dcCables);
    }
    if (state.codcPower && !kitWithDCCable) {
      if (ptmpType === 'Chassis') {
        const pnType = (ptmpModel === 'CHS-2000' || ptmpModel === 'CHS-2000B') ? 'ML2300 DC Cable' : 'ML130/230 DC Cable';
        add(DataStore.findOneByPnType(pnType)?.partNumber, coQty);
      } else {
        add(DataStore.findOneByPnType('ML600 DC Cable')?.partNumber, coQty);
      }
    }

    // Alarm cable
    if (ptmpType === 'Chassis' && state.alarmCable && state.alarmCable !== 'None') {
      add(state.alarmCable, coQty);
    }

    // MLU cable (chassis PTMP copper cable option)
    if (state.ptmpCopperCables && ptmpType === 'Chassis') {
      const mluDesc = ariRow(state.mluModel)?.description || '';
      let cablePN;
      if (!mluDesc.includes('EF') && !mluDesc.includes('DF')) {
        const pnType = ptmpModel === 'CHS-2000' ? 'CHS-2000 Cable' : 'CHS-2000B Cable';
        cablePN = getCablePN(pnType, state.cableLength);
        add(cablePN, coQty * mluQty);
      } else {
        let pnType;
        if (mluDesc === 'MLU-32EF') pnType = state.cableType === 'US Color Code (ft)' ? 'MLU-32EF Cable US' : 'MLU-32EF Cable EU';
        else if (mluDesc === 'MLU-32DF') pnType = state.cableType === 'US Color Code (ft)' ? 'MLU-32DF Cable US' : 'MLU-32DF Cable EU';
        else pnType = state.cableType === 'US Color Code (ft)' ? 'MLU-64DF Cable US' : 'MLU-64DF Cable EU';
        cablePN = getCablePN(pnType, state.cableLength);
        add(cablePN, mluDesc === 'MLU-32EF' ? coQty * mluQty * 2 : coQty * mluQty);
      }
    }

    // ML600/700 copper cables
    if ((ptmpType === 'ML600' || ptmpType === 'ML700') && state.coCopperCable && state.coCopperCable !== 'None') {
      const numPairs = classified.ari?.numPairs;
      add(state.coCopperCable, numPairs === 32 ? 2 * coQty : coQty);
    }

    // CO Mounting
    if (state.mountingKit && state.mountingModel && state.mountingModel !== 'None') {
      const slots = ariRow(state.mountingModel)?.numPairs || 1;
      if (slots === 1) add(state.mountingModel, coQty);
      else add(state.mountingModel, coQty % 2 === 0 ? coQty / 2 : Math.floor(coQty / 2) + 1);
    }

    // SFPs
    if (state.coSfpModel && state.coSfpModel !== 'None') {
      const sfpQty = state.sfpQuantity || 1;
      if (ptmpType === 'Chassis' && sduQuantity > 1) add(state.coSfpModel, sduQuantity * coQty * sfpQty);
      else add(state.coSfpModel, coQty * sfpQty);
    }
    // Fiber cables
    if (state.coFiberCable && state.coFiberCable !== 'None') {
      const sfpQty = state.sfpQuantity || 1;
      if (ptmpType === 'Chassis' && sduQuantity > 1) add(state.coFiberCable, sduQuantity * coQty * sfpQty);
      else add(state.coFiberCable, coQty * sfpQty);
    }

    // MLE-16E
    if (state.mleExt) {
      add(DataStore.findOneByPnType('TDM Ext')?.partNumber, coQty);
    }

    return { adds, ptmpBundlePN, note: 'Note: Software and specialized accessories (CWDM, external powering, etc.) must be configured manually.' };
  }

  function calcBlankPanels(numSlots) {
    if (numSlots >= -3 && numSlots <= 0) return 0;
    const blankPanel = DataStore.raw.spareSlots.find(s => s.description === 'Blank Panel Kit');
    const qtyPerKit = -(blankPanel ? blankPanel.spareSlots : -1);
    return numSlots % qtyPerKit === 0 ? Math.trunc(numSlots / qtyPerKit) : Math.trunc(numSlots / qtyPerKit) + 1;
  }

  function getCablePN(cableType, cableLength) {
    const withLen = DataStore.raw.autoRepeaterInfo.find(r => r.pnType === cableType && r.description?.includes(cableLength));
    if (withLen) return withLen.partNumber;
    const any = DataStore.raw.autoRepeaterInfo.find(r => r.pnType === cableType);
    return any ? any.partNumber : null;
  }

  function apply(state, classified, siteIndex) {
    const { adds, note } = calculate(state, classified);
    adds.forEach(a => Quote.addToQuote(a.partNumber, a.qty, siteIndex));
    return note;
  }

  return { classify, calculate, apply, calcBlankPanels, getCablePN, compatibleAccessoryTypes };
})();
