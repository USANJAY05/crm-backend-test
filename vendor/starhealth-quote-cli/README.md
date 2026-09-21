# Star Health AtomPro Quote CLI

Interactive CLI that walks through the same "Get Quote" flow as
https://atompro.starhealth.in/sso/login → **Get Quote** (guest quote, no login
needed) and prints the resulting plan list with prices.

Every catalog-style dropdown — Product, member-count ranges, member ages,
Sum Insured, Policy Period — is **scraped live from the page at the moment
it's needed**, and you're prompted from that exact live list. Nothing is
hardcoded, so if Star Health adds/removes a product or a sum-insured tier
tomorrow, this CLI picks it up automatically without any code changes.

## How it works

AtomPro is protected by Akamai bot detection, which blocks freshly-launched
automated browsers (headless or headful) with `403 Access Denied`. To stay on
the right side of that protection, this CLI does **not** launch its own
browser — it attaches to a real Chrome window that you open yourself, via the
Chrome DevTools Protocol, and drives that tab exactly like a person clicking
through the site would.

## One-time setup

1. Fully quit Chrome (all windows).
2. Relaunch Chrome with remote debugging enabled:

   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
   ```

3. Leave that window open.

## Install

```
npm install
npx playwright install chromium
```
(Playwright's browser download is only needed because it's a dependency of
the `playwright` package used to *connect*; no separate browser is launched.)

## Run

```
npm start
```

The CLI walks the real form in this order, scraping each dropdown's options
live right before asking:
1. Customer pincode
2. Product category (Health / Speciality)
3. Product — live list read from the site (e.g. Recommend Me, Super Star,
   Health Assure, Women's Care, ...)
4. Policy plan (Fresh / Portability)
5. Policy type (Floater / Individual)
6. Number of parents / adults / children — live count ranges read from the
   site
7. Age of each member — live age list read from the site for that member
8. Whether anyone has a Pre-Existing Disease (PED)
9. *(after submitting)* Sum Insured and Policy Period — live options read
   from the results page, then applied to every recommended plan card
   (skipping — with a note — any plan that doesn't offer that combination)

It then prints the final plan list with updated prices, sum insured, and
policy period.

## Using it programmatically (e.g. from your CRM)

`src/index.js` also exports `runQuote(input)` for non-interactive use: pass
exact values instead of being prompted, and it returns the parsed plan array
instead of printing it. See `src/test-run.mjs` for an example call.

```js
import { runQuote } from "./src/index.js";

const plans = await runQuote({
  pincode: "600001",
  category: "Health",
  product: "Recommend Me",          // must match the live option text exactly
  sumInsured: "10 LakhRecommended", // e.g. "7.5 Lakh" / "15 Lakh" / "20 Lakh" / "25 Lakh"
  policyPeriod: "1 Year",           // or "2 Years" / "3 Years"
  policyPlan: "Fresh",
  policyType: "Floater",
  numParents: 0,
  numAdults: 1,
  numChildren: 1,
  members: [
    { type: "Adult", index: 1, age: "30 yrs" },
    { type: "Child", index: 1, age: "10 yrs" },
  ],
  ped: "No",
});
```

Because `runQuote` skips the live-prompt step, its `product` / `sumInsured` /
member `age` values must match the site's current option text exactly
(including odd concatenations for badged options, e.g. `"Super StarTrending"`,
`"10 LakhRecommended"`). If you're not sure what's currently on offer, run
`npm start` (`runInteractive()`) once to see the live catalog, or read
`scrapeSelectOptions()` in `src/index.js` — it's the same function powering
the interactive prompts and can be called on its own.

Set `CDP_ENDPOINT` env var if Chrome's debugging port isn't the default
`http://localhost:9222`.

## Notes / limitations

- This drives the live AtomPro UI, so if Star Health changes the front-end
  structure (not just the catalog content), the selectors in `src/index.js`
  may need updating.
