# Actelis Price & Quote Tool — Online (Client-Side) Edition

This is a static, client-side reimplementation of the Actelis Access
Price/Quote Tool (`Price Tool v3.21.accdb`), built to be hosted for free on
**GitHub Pages**. It reproduces the price list, discount engine, the Node
Configurator, the Network/Repeater Configurator, the EMS Licensing Wizard,
multi-site quote building, and PDF/print + CSV/Excel export — all running
entirely in the visitor's browser.

**There is no server, no database, and no login.** Pricing/discount data is
bundled into the site as JSON files and every calculation happens in
JavaScript in the browser. No customer information is ever transmitted
anywhere.

## Deploying to GitHub Pages

1. Create a new GitHub repository (or use an existing one) and push the
   entire contents of this folder to it (this folder itself, not a
   subfolder — `index.html` must be at the repo root, or in whichever
   folder you point GitHub Pages at).
2. In the repository, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick the branch (usually `main`) and the folder (`/root` if this
   folder's contents are at the repo root, or `/docs` if you placed them in
   a `docs/` folder).
4. Save. GitHub will publish the site at
   `https://<your-org-or-username>.github.io/<repo-name>/` within a minute
   or two.
5. No build step, no server, no environment variables are required — it is
   plain HTML/CSS/JS served as static files.

To update pricing later, regenerate the JSON files in `data/` (see
"Refreshing pricing data" below) and push the changes; GitHub Pages
redeploys automatically.

## Site structure

```
index.html            Landing page
price-list.html        Browsable price list + Type-D (services/warranty) list
quote-builder.html      Multi-site quote builder + all three configurator wizards
css/style.css           All styles, including a print stylesheet for PDF export
js/data.js              Loads/indexes the JSON data files
js/discount.js          Region x customer-type discount engine
js/quote.js             In-memory quote/BOM state + totals (tax-inclusive formula)
js/wizard-ems.js         EMS Licensing Wizard engine
js/wizard-node.js        Node Configurator engine (single link, chassis/standalone)
js/wizard-network.js     Network/Repeater Configurator engine (multi-hop, PFU)
js/wizard-templates.js   Save/load named wizard configurations (localStorage)
js/export.js             CSV/Excel export + Print/PDF view
js/app.js                DOM wiring for price-list.html and quote-builder.html
data/*.json              Price list, discount matrix, and part-classification tables
```

## How state is stored (and why nothing is "stored online")

- **The quote you're building** (sites, BOM lines, services, customer
  type/region, header fields) lives in memory and is mirrored to
  **`sessionStorage`**, purely so it survives navigating between
  `price-list.html` and `quote-builder.html` in the same browser tab.
  `sessionStorage` is automatically wiped when the tab or window is closed
  and is never sent anywhere. Nothing is saved between visits unless you
  export it.
- **Saved wizard templates** (a named Node/Network/EMS configuration you
  want to reuse) are opt-in and stored in **`localStorage`** on that one
  device/browser only, under the key `actelis-wizard-templates`. This is
  clearly labelled "Saved on this device only" in the UI. It holds only
  wizard input fields (model choices, quantities, checkboxes) — never a
  customer name, quote number, or price.
- **Exports** (CSV and the Print/PDF view) are generated on demand and
  simply download or print — nothing is uploaded.

## What's different from the desktop Access tool

- **No customer database / no login.** Instead of picking a saved customer
  record, you pick a **Customer Type** (Reseller or End Customer) and
  **Region** for the quote. The standard discount matrix (by category,
  region, and customer type, with the NA-only Deal Registration bonus) is
  applied exactly as in the desktop tool.
- **Per-customer negotiated discount overrides** (the Access
  `CustomerDefaultDiscounts` table, tiered by quantity, tied to a specific
  saved customer) are intentionally **not available** online — there is no
  customer record to key them off of. Every quote uses the standard
  discount matrix.
- **Out of scope** (internal/back-office features that don't belong in a
  public tool): RMA quotes, the COGS/margin viewer, the HubSpot export, and
  any login/role system.
- **Model pickers in the configurator wizards** show a broad, searchable
  list of catalog parts for a given field (e.g. "SDU Model" shows all SDU
  parts) rather than reproducing every one of the desktop tool's nested,
  cascading dropdown filters (which also depend on prior selections, OEM,
  and legacy flags). This is a UI convenience simplification only — the
  **BOM quantity math** (`js/wizard-node.js`, `js/wizard-network.js`,
  `js/wizard-ems.js`) is a faithful, line-by-line port of the original VBA,
  and it always resolves pricing/quantities from whichever real part number
  you select, so the simplification does not affect calculation accuracy.
- **Archived/legacy part numbers**: a handful of AutoRepeaterInfo part
  numbers referenced by very old configurations (superseded model variants)
  have no entry in the current price list, the Type-D list, or even the
  archive — these are filtered out of the wizard pickers entirely so they
  can't silently add a $0.00 line. Parts that *are* in the archive still
  price correctly, but some archived items belong to category codes that
  no longer have a row in the current discount matrix — those price at
  full list with no discount, which is the same conservative fallback the
  discount engine uses for any category it doesn't recognize.
- **Sales tax** is available as an optional, quote-level toggle (percentage
  you type in) — the desktop tool's tax-inclusive totals formula is
  preserved (`PriceNoTax = TotalPrice / (1+pct)`, tax is backed out of the
  total rather than added on top), matching the original `QuoteReport A4`
  report logic exactly.

## Refreshing pricing data

The `data/*.json` files were generated from a one-time export of the Access
database's tables (Price List, Price List - Type D, Discounts,
AutoRepeaterInfo, Bundles, Spare Slots, Regions, Payment/Shipping Terms,
etc.). To refresh them after the desktop tool's data changes:

1. In Access, use **File → Save As → CSV** (or a DAO export macro) for each
   table listed above, or re-run an equivalent export.
2. Convert each CSV to the corresponding JSON shape used in `data/` (the
   field names in each `.json` file match the source table's columns —
   see the comments at the top of `js/data.js` for the exact file list and
   in each file for the shape).
3. Replace the files in `data/` and push — no code changes are needed
   unless a table gains/loses a column that the JS relies on (see
   `js/data.js`, `js/discount.js`, `js/wizard-*.js` for exactly which
   columns are read).

## Verifying calculations

Before relying on this for real customer quotes, spot-check a handful of
representative quotes side-by-side against the desktop Access tool:
a simple single-part quote, a chassis-based Node Configurator BOM, a
multi-hop Network Configurator BOM with a repeater/PFU, and an EMS
licensing quote — for both an End Customer and a Reseller, and for both an
NA and an EMEA/APAC region, since the discount and labeling logic branches
on those. The totals math (BOM subtotal + services subtotal, tax backed out
of the total) is implemented in `Quote.totals()` in `js/quote.js`.
