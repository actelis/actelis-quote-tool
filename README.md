# Actelis Price & Quote Tool — Online (Client-Side) Edition/

This is a static, client-side reimplementation of the Actelis Access
Price/Quote Tool (`Price Tool v3.21.accdb`), built to be hosted for free on
**GitHub Pages**. It reproduces the price list, discount engine, the Node
Configurator, the Network/Repeater Configurator, the EMS Licensing Wizard,
multi-site quote building, a real PDF export that matches the original
`QuoteReport Letter` layout (and can be re-imported to reload a quote), a
real `.xlsx` export, and an authorized-personnel-only, git-push-based
workflow for updating pricing/discount data and discontinued-part
replacements — all running entirely in the visitor's browser.

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
quote-builder.html      Quote builder: details/summary, line items, wizards,
                         Financial Options, Admin + Replacements managers
css/style.css           All styles (navy/orange visual language, toggles,
                         modals, print stylesheet for the legacy Print view)
js/data.js              Loads/indexes the JSON data files, replacements lookup
js/discount.js          Region x customer-type discount engine
js/quote.js             In-memory quote/BOM state, Financial Options, totals,
                         serialize()/loadFromState() for the PDF round-trip
js/wizard-ems.js         EMS Licensing Wizard engine
js/wizard-node.js        Node Configurator engine (single link, chassis/standalone)
js/wizard-network.js     Network/Repeater Configurator engine (multi-hop, PFU)
js/wizard-templates.js   Save/load named wizard configurations (localStorage)
js/pdf.js                Generates the QuoteReport-style PDF (pdf-lib) and
                         parses a previously-exported PDF back into a quote
js/export.js             CSV export, real .xlsx export (SheetJS), legacy
                         Print/PDF view
js/admin.js              CSV/XLSX parsing, diffing and JSON generation used
                         by the Admin — Price List Manager and Replacements
                         Manager modals (no GitHub API calls — see below)
js/app.js                DOM wiring for all three pages
js/vendor/               Vendored copies of pdf-lib and SheetJS (xlsx) —
                         served same-origin, no CDN dependency at runtime
data/*.json              Price list, discount matrix, part-classification
                         tables, replacements map, and site metadata
assets/                  Actelis logo, used in the page header and in
                         generated PDFs
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
- **Exports** (PDF, Excel, CSV, and the legacy Print/PDF view) are generated
  on demand and simply download or print — nothing is uploaded.
- **Custom / non-catalog line items** (the "+ Add" row on the Line Items
  card) carry their own manually-typed description and price instead of a
  catalog lookup — they live in the same in-memory/`sessionStorage` quote
  state as everything else and are included in every export.
- **The price list, discount table, and replacements map** are the opposite
  of per-device state: they're the same `data/*.json` files bundled into the
  site for every visitor, and the only way to change them is the Admin /
  Replacements git-push workflow described below — never a local override.

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

## PDF export / import (round-trip)

**Export PDF** (in the Quote Summary panel) generates a PDF that mirrors the
original Access `QuoteReport Letter` layout: the Actelis logo and Actelis
address block, a 3-column quote-meta header (Quotation #/Customer/Status,
Contact/Address/Phone/Email, Date/Valid Until/Terms/Quoted By), a per-site
BOM table with a "Total Site Price" row, a bold "Total Price Excluding
Services/Warranty" line, a Services/Warranty table, and a bold "Total Price
Including Services/Warranty" line, plus a footer with the export date, "All
prices are in USD", the page number, and the tool version.

The full in-memory quote (every field, every site/line, every service, every
Financial Options toggle) is also embedded as JSON in the PDF's own metadata
(the Subject field, base64-encoded, behind an `ACTELIS_QUOTE_DATA_V1:`
marker) — it is not parsed back out of the visible page text. **Import PDF**
(top-right, green button) reads that metadata back out and fully repopulates
the quote, so a quote can be exported, emailed, and re-opened later (by
anyone, in any browser) with everything intact. Importing a PDF that wasn't
exported by this tool (no matching metadata) shows a clear message instead
of guessing at page content.

Both this and **Export Excel** run entirely client-side using two vendored
libraries — [pdf-lib](https://pdf-lib.js.org/) and
[SheetJS (xlsx)](https://sheetjs.com/) — copied into `js/vendor/` at build
time rather than loaded from a CDN, so the export/import features work with
no external network dependency and no CDN outage risk. Their licenses are
included alongside them (`js/vendor/LICENSE-*.txt`).

## Financial Options

The three toggles at the bottom of the Quote Builder page (**Add Shipping
Cost**, **Add Credit Card Fee**, **Extended Warranty**) don't hard-code a
percentage in the UI — each one simply adds or removes a real Type-D catalog
line to Services/Warranty (`SVC-FREIGHT` = 2% of product price,
`SVC-CC` = 3% of product price, and the two standard included-warranty lines
`SVC-HW2WT`/`SVC-SW2WT` for Extended Warranty). That means the amounts always
come from the same globally-maintained price list every visitor sees, and
they show up as ordinary, editable Services/Warranty lines.

## Admin — Price List Manager & Replacements Manager (authorized-personnel-only, global updates)

Per an explicit requirement for this tool: **price and part-replacement
updates must be restricted to authorized personnel and must be the same for
every visitor** — not a per-device/per-browser override. Since the site has
no server, no database, and no login, that's implemented the same way the
site itself gets updated: a manual, git-push-based workflow with **no
GitHub API calls and no token ever entering this app**:

1. **Upload** a CSV/XLSX file (via the 🔒 **ADMIN** or ⇄ **Replacements**
   button in the Quote Builder's top bar).
   - Hardware Price List tab: accepts the same flat shape as the master
     price list export (`Category, Part Num, Description, Comments, LP $`)
     — it splits A/B/C rows into the hardware shape and D rows into the
     Type-D shape automatically, and infers percentage vs. flat vs.
     "Included in Initial Purchase" Type-D pricing from the `LP $` text.
   - Discount Table tab: accepts `Category, Category Type, Discount,
     Discount End User, Registration Discount, Discount EMEA, Discount End
     User EMEA, Warranty`.
   - Replacements Manager: accepts `Old Part Number, New Part Number,
     Notes`, or rows can be added one at a time in the modal.
2. **Preview** — the modal diffs the upload against the data currently
   bundled in the site and shows exactly what's added, changed, or dropped
   before anything is generated.
3. **Download** the regenerated `data/price-list.json` +
   `data/price-list-type-d.json` (or `data/discounts.json`, or
   `data/replacements.json`).
4. **git push** — the authorized person commits and pushes those files to
   this repository exactly the way the site itself was originally deployed.
   GitHub Pages redeploys automatically, and every visitor then sees the
   update — nothing is stored per-browser, and nothing can be changed by an
   ordinary visitor.

When a part number has a recorded replacement, it's surfaced everywhere that
part shows up — the Price List page, catalog search results, and existing
BOM lines all show a "Replaced by `<new PN>`" badge (with a one-click "Swap"
button on BOM lines) — but the replacement *mapping* itself can only be
changed through the authorized flow above.

## Refreshing pricing data

The `data/*.json` files were originally generated from a one-time export of
the Access database's tables (Price List, Price List - Type D, Discounts,
AutoRepeaterInfo, Bundles, Spare Slots, Regions, Payment/Shipping Terms,
etc.). Going forward, prefer the **Admin — Price List Manager** flow above
for routine price/discount updates. For a data file that manager doesn't
cover (AutoRepeaterInfo, Bundles, Spare Slots, region/terms tables, etc.):

1. In Access, use **File → Save As → CSV** (or a DAO export macro) for each
   table listed above, or re-run an equivalent export.
2. Convert each CSV to the corresponding JSON shape used in `data/` (the
   field names in each `.json` file match the source table's columns —
   see the comments at the top of `js/data.js` for the exact file list and
   in each file for the shape).
3. Replace the files in `data/` and push — no code changes are needed
   unless a table gains/loses a column that the JS relies on (see
   `js/data.js`, `js/discount.js`, `js/wizard-*.js` for exactly which
   columns are read). `data/meta.json` holds the version/date shown under
   the logo in the top bar — bump it whenever you push a data update so
   visitors can tell the price list is current.

## Verifying calculations

Before relying on this for real customer quotes, spot-check a handful of
representative quotes side-by-side against the desktop Access tool:
a simple single-part quote, a chassis-based Node Configurator BOM, a
multi-hop Network Configurator BOM with a repeater/PFU, and an EMS
licensing quote — for both an End Customer and a Reseller, and for both an
NA and an EMEA/APAC region, since the discount and labeling logic branches
on those. The totals math (BOM subtotal + services subtotal, tax backed out
of the total) is implemented in `Quote.totals()` in `js/quote.js`.
