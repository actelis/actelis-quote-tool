/* wizard-network.js
 * Port of Form_Wizard-Network.txt — the multi-hop Network/Repeater
 * Configurator (Step 1: CO/link, Step 2: CPE/mounting, Step 3: PFU/repeater,
 * Step 4: submit). This file focuses on a faithful port of the BOM quantity
 * math in Next_Click's Case 4 (~800 lines of VBA, captured in full), which is
 * where the actual part numbers and quantities are computed.
 *
 * Simplifications vs. the original (documented in README):
 *  - CO model classification reuses NodeWizard.classify (same AutoRepeaterInfo
 *    PN-Type taxonomy drives PTMPType/PTMPModel in both wizards).
 *  - Some of the very fine-grained cascading dropdown *filters* for CPE Model
 *    / Repeater Model / Adapter Model RowSource lists are simplified to
 *    "all plausible options for this PN Type + region", rather than
 *    reproducing every nested legacy/region/NumPairs SQL filter.
 *  - WizardTemplates (save/recall a named configuration) is reimplemented
 *    with localStorage instead of an Access table (see wizard-templates.js).
 */
const NetworkWizard = (() => {
  function ariRow(pn) { return DataStore.raw.autoRepeaterInfo.find(r => r.partNumber === pn) || null; }
  function priceDesc(pn) { const r = DataStore.getPriceRow(pn); return r ? r.description : ''; }
  function findPFUKit(pfuModel) {
    const desc = ariRow(pfuModel)?.description;
    if (!desc) return null;
    const kit = DataStore.raw.autoRepeaterInfo.find(r => r.description === `${desc} Kit`);
    return kit ? kit.partNumber : null;
  }

  function classify(coModel) {
    return NodeWizard.classify(coModel);
  }

  function maxRepeaterHopsFor(pfuModel) {
    const desc = priceDesc(pfuModel);
    return (desc.includes('PFU-8E') || desc.includes('PFU8E')) ? 2 : 4;
  }

  // state: see README "Network Wizard state shape" for the full field list.
  function calculate(state, classified) {
    const adds = [];
    const add = (partNumber, qty) => {
      if (!partNumber || partNumber === 'None' || !qty) return;
      adds.push({ partNumber, qty: Math.round(qty * 1e6) / 1e6 });
    };
    const { ptmpType, ptmpModel } = classified;
    const coQty = state.coQuantity || 1;
    const numLinks = state.numLinks || 1;
    const mluQty = state.mluQty || 1;
    const repeaterConfig = !!state.repeaterConfig;
    const maxRepeaterHops = state.pfuModel ? maxRepeaterHopsFor(state.pfuModel) : 4;
    const cpeAri = ariRow(state.cpeModel);
    const ml620iCPE = cpeAri?.pnType === 'PTP ML620i CPE';
    const coPairs = ariRow(state.coModel)?.numPairs || 0;
    const cpePairs = cpeAri?.numPairs || 0;

    let repeaterPairs = state.numPairs || 0;
    let dualPFUFeeding = false;
    if (repeaterConfig) {
      repeaterPairs = state.numPairs % 2 === 1 ? state.numPairs + 1 : state.numPairs;
      dualPFUFeeding = (state.repeaterHops || 0) > maxRepeaterHops;
    }
    const numPairs = state.numPairs != null ? state.numPairs : (cpeAri?.numPairs || 0);

    let ptmpBundlePN = 'None';
    if (state.bundles) {
      const bundle = DataStore.raw.bundles.find(b =>
        b.pnType === 'PTMP Bundle' && b.chassis === state.coModel && b.sdu === state.sduModel && b.mlu === state.mluModel);
      if (bundle) ptmpBundlePN = bundle.partNumber;
    }

    // Craft cable
    if (state.craftCable) {
      if (ptmpType === 'ML5xx') add(DataStore.findOneByPnType('Craft ML5xx')?.partNumber, 1);
      else if (ptmpModel === 'ML600D') {
        const oem = classified.ari?.oem;
        add(DataStore.findOneByPnType(oem === 'DT' ? 'Craft Cable ML600DT' : 'Craft Cable ML600D')?.partNumber, 1);
      } else add(DataStore.findOneByPnType('Craft Cable')?.partNumber, 1);
    }

    if (state.configType === 'PTP') {
      // ---- PTP ----
      if (state.coModel !== state.cpeModel) {
        add(state.coModel, numLinks);
        add(state.cpeModel, numLinks);
      } else {
        add(state.coModel, 2 * numLinks);
      }

      // Mounting
      let mountingSlots = state.mountingKit !== 'None' ? (ariRow(state.mountingModel)?.numPairs || 1) : null;
      switch (state.mountingKit) {
        case 'None': break;
        case 'CPE Only':
          if (mountingSlots === 1) {
            if (repeaterConfig && dualPFUFeeding) add(state.mountingModel, (numPairs > 8 ? 3 : 2) * numLinks);
            else add(state.mountingModel, numLinks);
          } else if (repeaterConfig && dualPFUFeeding) {
            add(state.mountingModel, (numPairs > 8 ? 2 : 1) * numLinks);
          }
          break;
        case 'CO Only':
          if (mountingSlots === 1) {
            if (repeaterConfig) add(state.mountingModel, (numPairs > 8 ? 3 : 2) * numLinks);
            else add(state.mountingModel, numLinks);
          } else if (repeaterConfig) {
            if (numPairs > 8) {
              add(state.mountingModel, numLinks % 2 === 0 ? 1.5 * numLinks : Math.trunc(1.5 * numLinks) + 1);
            } else add(state.mountingModel, numLinks);
          } else {
            add(state.mountingModel, numLinks % 2 === 0 ? numLinks / 2 : Math.trunc(numLinks / 2) + 1);
          }
          break;
        case 'CO and CPE':
          if (mountingSlots === 1) {
            if (repeaterConfig) {
              if (dualPFUFeeding) add(state.mountingModel, (numPairs > 8 ? 6 : 4) * numLinks);
              else add(state.mountingModel, (numPairs > 8 ? 4 : 3) * numLinks);
            } else add(state.mountingModel, 2 * numLinks);
          } else if (repeaterConfig) {
            add(state.mountingModel, (numPairs > 8 ? 4 : 2) * numLinks);
          } else {
            add(state.mountingModel, numLinks % 2 === 0 ? 1.5 * numLinks : Math.trunc(1.5 * numLinks) + 1);
          }
          break;
      }

      // AC/DC adapter
      let acdcQty = 0;
      if (state.coPowering === 'AC') acdcQty = 1;
      if (state.cpePowering === 'AC' && !ml620iCPE) acdcQty += 1;
      if (acdcQty) {
        add(state.acdcModel, acdcQty * numLinks);
        if (state.acCable && state.acCable !== 'None') add(state.acCable, acdcQty * numLinks);
      }
      if (state.cpePowering === 'AC' && ml620iCPE) {
        if (state.coPowering === 'DC') add(state.acdcModel, numLinks);
        else {
          const ukPart = priceDesc(state.acdcModel).includes('UK');
          const opt = DataStore.raw.autoRepeaterInfo.find(r => r.pnType === 'PTP ML620i AC' && (ukPart ? r.description?.includes('UK') : !r.description?.includes('UK')));
          add(opt?.partNumber, numLinks);
        }
      }

      // DC power cables
      let dcCableQty = 0;
      if (state.codcPower) dcCableQty += numLinks;
      if (state.cpeDcPower) dcCableQty += numLinks;
      if (repeaterConfig && state.pfuDcCable) dcCableQty += dualPFUFeeding ? 2 * numLinks : numLinks;
      if (dcCableQty) add(DataStore.findOneByPnType('ML600 DC Cable')?.partNumber, dcCableQty);

      // PFU
      if (repeaterConfig) {
        if (dualPFUFeeding) {
          if (numPairs > 8) {
            add(state.pfuModel, 4 * numLinks);
            add(DataStore.findOneByPnType('PFU Cable16')?.partNumber, 2 * numLinks);
          } else add(state.pfuModel, 2 * numLinks);
        } else if (numPairs > 8) {
          add(state.pfuModel, 2 * numLinks);
          add(DataStore.findOneByPnType('PFU Cable16')?.partNumber, numLinks);
        } else add(state.pfuModel, numLinks);
      }

      // Repeaters/Adapters
      if (repeaterConfig) {
        if (!state.adapterModel || state.adapterModel === 'None') {
          add(state.repeaterModel, numLinks * state.repeaterHops * repeaterPairs / 2);
        } else if (dualPFUFeeding) {
          const coDesc = priceDesc(state.adapterModel);
          const cpePart = DataStore.raw.autoRepeaterInfo.find(r => r.description === `${coDesc} - Xconnect`);
          add(cpePart?.partNumber, numLinks * (state.repeaterHops - maxRepeaterHops) * repeaterPairs / 2);
          add(state.adapterModel, numLinks * maxRepeaterHops * repeaterPairs / 2);
        } else {
          add(state.adapterModel, numLinks * state.repeaterHops * repeaterPairs / 2);
        }
      }

      // SFPs
      if (state.coSfpModel && state.coSfpModel !== 'None') {
        add(state.coSfpModel, (state.sfpQuantity ? state.sfpQuantity : 1) * numLinks);
      }
      if (state.cpeSfpModel && state.cpeSfpModel !== 'None') {
        add(state.cpeSfpModel, (state.cpeSfpQuantity ? state.cpeSfpQuantity : 1) * numLinks);
      }

      // ML600 copper cables
      if (state.copperCable && state.copperCable !== 'None') {
        if (state.coCopperCable && state.coCopperCable !== 'None') {
          if (state.coCopperCable === state.copperCable) add(state.copperCable, 2 * numLinks);
          else { add(state.copperCable, numLinks); add(state.coCopperCable, numLinks); }
        } else add(state.copperCable, numLinks);
      } else if (state.coCopperCable && state.coCopperCable !== 'None') {
        add(state.coCopperCable, numLinks);
      }

      return { adds, note };
    }

    // ---- PTMP ----
    let pfuQuantityCO = 0;
    // CO shelf
    add(ptmpBundlePN === 'None' ? state.coModel : ptmpBundlePN, coQty);

    // MLU
    const totalNumOfPairs = numPairs * numLinks;
    if (ptmpType === 'Chassis') {
      if (ptmpBundlePN === 'None') add(state.mluModel, coQty * mluQty);
      else if (mluQty !== 1) add(state.mluModel, coQty * (mluQty - 1));
    }

    // SDU
    let sduQuantity = 1;
    if (ptmpType === 'Chassis') {
      if (ptmpModel === 'CHS-100' || ptmpModel === 'CHS-200') {
        if (ptmpBundlePN === 'None') add(state.sduModel, coQty);
      } else {
        const sduIs3xx = !!DataStore.raw.autoRepeaterInfo.find(r => r.partNumber === state.sduModel && r.description?.includes('SDU-3'));
        const sduAri = ariRow(state.sduModel);
        if (sduIs3xx && (totalNumOfPairs > (sduAri?.numPairs || 0) || numLinks > (sduAri?.numHSL || 0))) {
          sduQuantity = 2;
          if (sduAri?.description === 'SDU-340G') {
            if (ptmpBundlePN === 'None') add(state.sduModel, sduQuantity * coQty);
            else add(state.sduModel, coQty);
          } else {
            const sdu340g = DataStore.raw.autoRepeaterInfo.find(r => r.description === 'SDU-340G');
            add(sdu340g?.partNumber, coQty);
            if (ptmpBundlePN === 'None') add(state.sduModel, coQty);
          }
        } else {
          sduQuantity = (state.sduRedundancy) ? 2 : 1;
          if (ptmpBundlePN === 'None') add(state.sduModel, sduQuantity * coQty);
          else if (sduQuantity === 2) add(state.sduModel, coQty);
        }
      }
    }

    // Blank panels
    if (ptmpType === 'Chassis' && ptmpBundlePN === 'None') {
      const spareRow = DataStore.raw.spareSlots.find(s => s.partNumber === state.coModel);
      let numBlank = coQty * ((spareRow ? spareRow.spareSlots : 0) - sduQuantity - mluQty);
      if (numBlank > 0) {
        numBlank = NodeWizard.calcBlankPanels(numBlank);
        const blankPanel = DataStore.raw.spareSlots.find(s => s.description === 'Blank Panel Kit');
        add(blankPanel?.partNumber, numBlank);
      }
    }

    if (state.mleExt) add(DataStore.findOneByPnType('TDM Ext')?.partNumber, coQty);

    // CPE
    add(state.cpeModel, coQty * numLinks);

    // AC/DC adapter
    if (ptmpType === 'Chassis') {
      if (state.cpePowering === 'AC') {
        const q = coQty * numLinks;
        add(state.acdcModel, q);
        if (state.acCable && state.acCable !== 'None') add(state.acCable, q);
      }
    } else {
      let acdcQty = 0;
      if (state.coPowering === 'AC') acdcQty = 1;
      if (state.cpePowering === 'AC' && !ml620iCPE) acdcQty += numLinks;
      if (acdcQty) {
        add(state.acdcModel, coQty * acdcQty);
        if (state.acCable && state.acCable !== 'None') add(state.acCable, coQty * acdcQty);
      }
      if (state.cpePowering === 'AC' && ml620iCPE) {
        if (state.coPowering === 'DC') add(state.acdcModel, coQty * numLinks);
        else {
          const ukPart = priceDesc(state.acdcModel).includes('UK');
          const opt = DataStore.raw.autoRepeaterInfo.find(r => r.pnType === 'PTP ML620i AC' && (ukPart ? r.description?.includes('UK') : !r.description?.includes('UK')));
          add(opt?.partNumber, coQty * numLinks);
        }
      }
    }

    // PFU
    if (repeaterConfig) {
      if (ptmpType === 'Chassis') {
        const pfuAri = ariRow(state.pfuModel);
        pfuQuantityCO = Math.ceil(totalNumOfPairs / (pfuAri?.numPairs || 1));
        add(state.pfuModel, coQty * pfuQuantityCO);
        if (dualPFUFeeding) {
          const kit = findPFUKit(state.pfuModel);
          if (cpePairs > 8) {
            add(kit, 2 * coQty * numLinks);
            add(DataStore.findOneByPnType('PFU Cable16')?.partNumber, coQty * numLinks);
          } else {
            add(kit, coQty * numLinks);
          }
        }
      } else {
        pfuQuantityCO = coPairs > 8 ? 2 : 1;
        const kit = findPFUKit(state.pfuModel);
        if (dualPFUFeeding) {
          if (coPairs > 8) {
            add(state.pfuModel, coQty * pfuQuantityCO);
            add(DataStore.findOneByPnType('PFU Cable16')?.partNumber, coQty * pfuQuantityCO / 2);
            add(kit, coQty * numLinks);
          } else {
            add(kit, coQty * (pfuQuantityCO + numLinks));
          }
        } else if (coPairs > 8) {
          add(state.pfuModel, coQty * pfuQuantityCO);
          add(DataStore.findOneByPnType('PFU Cable16')?.partNumber, coQty * pfuQuantityCO / 2);
        } else {
          add(kit, coQty * pfuQuantityCO);
        }
      }
    }

    // DC power cables
    if (state.codcPower && ptmpType === 'Chassis') {
      const bundle = ptmpBundlePN !== 'None' ? DataStore.raw.bundles.find(b => b.partNumber === ptmpBundlePN) : null;
      if (ptmpBundlePN === 'None' || !bundle?.dcCables) {
        const pnType = (ptmpModel === 'CHS-2000' || ptmpModel === 'CHS-2000B') ? 'ML2300 DC Cable' : 'ML130/230 DC Cable';
        add(DataStore.findOneByPnType(pnType)?.partNumber, coQty);
      }
    }
    let dcCableQty = 0;
    if (state.cpeDcPower) dcCableQty += coQty * numLinks;
    if (repeaterConfig && state.pfuDcCable) dcCableQty += coQty * pfuQuantityCO;
    if (repeaterConfig && state.pfuDcCable && dualPFUFeeding) dcCableQty += coQty * numLinks;
    if (state.codcPower && ptmpType === 'ML600') dcCableQty += coQty;
    if (dcCableQty) add(DataStore.findOneByPnType('ML600 DC Cable')?.partNumber, dcCableQty);

    // Mounting
    let mountingSlots = state.mountingKit !== 'None' ? (ariRow(state.mountingModel)?.numPairs || 1) : null;
    switch (state.mountingKit) {
      case 'None': break;
      case 'CPE Only':
        if (mountingSlots === 1 && repeaterConfig && dualPFUFeeding) {
          add(state.mountingModel, (cpePairs > 8 ? 3 : 2) * coQty * numLinks);
        } else {
          add(state.mountingModel, coQty * numLinks);
        }
        break;
      case 'CO Only (For PFU)':
        if (mountingSlots === 1) add(state.mountingModel, coQty * pfuQuantityCO);
        else {
          const v = coQty * pfuQuantityCO / mountingSlots;
          add(state.mountingModel, Number.isInteger(v) ? v : Math.trunc(v) + 1);
        }
        break;
      case 'CO Only':
        if (repeaterConfig) {
          if (mountingSlots === 1) add(state.mountingModel, coQty * (1 + pfuQuantityCO));
          else {
            const v = coQty * (1 + pfuQuantityCO) / mountingSlots;
            add(state.mountingModel, Number.isInteger(v) ? v : Math.trunc(v) + 1);
          }
        } else if (mountingSlots === 1) add(state.mountingModel, coQty);
        else {
          const v = coQty / mountingSlots;
          add(state.mountingModel, Number.isInteger(v) ? v : Math.trunc(v) + 1);
        }
        break;
      case 'CO (For PFU) and CPE':
        if (mountingSlots === 1) {
          if (dualPFUFeeding) add(state.mountingModel, coQty * (pfuQuantityCO + (cpePairs > 8 ? 3 : 2) * numLinks));
          else add(state.mountingModel, coQty * (pfuQuantityCO + numLinks));
        } else if (dualPFUFeeding) {
          const base = coQty * pfuQuantityCO / mountingSlots;
          const baseCeil = Number.isInteger(base) ? base : Math.trunc(base) + 1;
          add(state.mountingModel, baseCeil + (cpePairs > 8 ? 2 : 1) * coQty * numLinks);
        } else {
          const base = coQty * pfuQuantityCO / mountingSlots;
          const baseCeil = Number.isInteger(base) ? base : Math.trunc(base) + 1;
          add(state.mountingModel, baseCeil + coQty * numLinks);
        }
        break;
      case 'CO and CPE':
        if (mountingSlots === 1) {
          add(state.mountingModel, dualPFUFeeding
            ? coQty * (1 + pfuQuantityCO + 2 * numLinks)
            : coQty * (1 + pfuQuantityCO + numLinks));
        } else {
          const base = coQty * (1 + pfuQuantityCO) / mountingSlots;
          const baseCeil = Number.isInteger(base) ? base : Math.trunc(base) + 1;
          add(state.mountingModel, baseCeil + coQty * numLinks);
        }
        break;
    }

    // Repeaters/Adapters
    if (repeaterConfig) {
      if (!state.adapterModel || state.adapterModel === 'None') {
        add(state.repeaterModel, coQty * numLinks * state.repeaterHops * repeaterPairs / 2);
      } else if (dualPFUFeeding) {
        const coDesc = priceDesc(state.adapterModel);
        const cpePart = DataStore.raw.autoRepeaterInfo.find(r => r.description === `${coDesc} - Xconnect`);
        add(cpePart?.partNumber, coQty * numLinks * (state.repeaterHops - maxRepeaterHops) * repeaterPairs / 2);
        add(state.adapterModel, coQty * numLinks * maxRepeaterHops * repeaterPairs / 2);
      } else {
        add(state.adapterModel, coQty * numLinks * state.repeaterHops * repeaterPairs / 2);
      }
    }

    // MLU cable
    if (ptmpType === 'Chassis') {
      const mluDesc = ariRow(state.mluModel)?.description || '';
      let cablePN;
      if (!mluDesc.includes('EF') && !mluDesc.includes('DF')) {
        cablePN = NodeWizard.getCablePN(ptmpModel === 'CHS-2000' ? 'CHS-2000 Cable' : 'CHS-2000B Cable', state.cableLength);
        add(cablePN, coQty * mluQty);
      } else {
        let pnType;
        if (mluDesc === 'MLU-32DF') pnType = state.cableType === 'US Color Code (ft)' ? 'MLU-32DF Cable US' : 'MLU-32DF Cable EU';
        else pnType = state.cableType === 'US Color Code (ft)' ? 'MLU-64DF Cable US' : 'MLU-64DF Cable EU';
        cablePN = NodeWizard.getCablePN(pnType, state.cableLength);
        add(cablePN, mluDesc === 'MLU-32DF' ? coQty * mluQty * 2 : coQty * mluQty);
      }
    }

    // PFU cable + monitor cable
    if (repeaterConfig && ptmpType === 'Chassis') {
      add(NodeWizard.getCablePN('PFU Cable', state.cableLength), coQty * pfuQuantityCO);
      if (state.pfuCableLength) add(state.pfuCableLength, coQty);
    }

    // Alarm cable
    if (ptmpType === 'Chassis' && state.alarmCable && state.alarmCable !== 'None') add(state.alarmCable, coQty);

    // SFPs
    if (state.coSfpModel && state.coSfpModel !== 'None') {
      add(state.coSfpModel, (state.sfpQuantity || 1) * sduQuantity * coQty);
    }
    if (state.cpeSfpModel && state.cpeSfpModel !== 'None') {
      add(state.cpeSfpModel, (state.cpeSfpQuantity || 1) * coQty * numLinks);
    }

    // ML600 copper cables
    if (ptmpType === 'Chassis') {
      if (state.copperCable && state.copperCable !== 'None') add(state.copperCable, coQty * numLinks);
    } else if (state.copperCable && state.copperCable !== 'None') {
      if (state.coCopperCable && state.coCopperCable !== 'None') {
        if (state.coCopperCable === state.copperCable) add(state.copperCable, coQty * (1 + numLinks));
        else { add(state.copperCable, coQty * numLinks); add(state.coCopperCable, coQty); }
      } else add(state.copperCable, coQty * numLinks);
    } else if (state.coCopperCable && state.coCopperCable !== 'None') {
      add(state.coCopperCable, coQty);
    }

    return { adds, note };
  }

  const note = 'Note: software licenses and specialized accessories (CWDM, external powering, etc.) must be configured manually.';

  function apply(state, classified, siteIndex) {
    const { adds } = calculate(state, classified);
    adds.forEach(a => Quote.addToQuote(a.partNumber, a.qty, siteIndex));
    return note;
  }

  return { classify, calculate, apply, maxRepeaterHopsFor };
})();
