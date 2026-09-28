# SEO Lens — v0.5.3

A Manifest V3 browser extension that shows an instant SEO health snapshot of
the active tab: meta tags, headings, images, links, social tags, structured
data, performance, and a 0–100 score.

## What's new in v0.5.3

- **Score history** — new History tab tracks your score over time, per page:
  a sparkline trend, per-scan deltas (+/−), and pass/warning/fail counts for
  every scan. Snapshots save automatically (skipped if rescanned within 30
  minutes with no score change), capped at 50 per page, with a one-click
  clear. Stored in `chrome.storage.local` — device-only, nothing leaves the
  browser. Needs the `storage` permission

## What's new in v0.5.2

- **Inter font actually loads** — root cause found and fixed: Chrome does not
  load `@font-face` fonts declared inside shadow-root stylesheets (neither via
  `<style>` nor constructed stylesheets). Font faces are now installed at
  document level through a constructed stylesheet (CSP-exempt), where they
  remain usable from inside the shadow tree. The sheet is removed when the
  panel closes, so the page is left untouched
- **"Last modified" row** — the Overview tab now shows the page's last-modified
  date as reported by the browser (`document.lastModified`), honestly labeled
- **PageSpeed Insights buttons** — the Performance tab has Mobile / Desktop
  buttons that open Google PageSpeed Insights for the exact current URL
- **"Highlight issues on page"** — the Fixes tab has a toggle that outlines
  real issues directly on the website: red dashed = error (images missing alt,
  broken/unreachable links), orange dashed = warning (skipped heading levels,
  oversized images). Fully reversible — outlines are outline-only (no layout
  or content changes) and everything is removed when toggled off or the panel
  closes
- **Top-right panel + scroll isolation** — the floating panel moved from
  bottom-right to top-right, and `overscroll-behavior: contain` keeps mouse
  wheel scrolling inside the panel from scrolling the page behind it

## What's new in v0.4.0

- **Floating bottom-right panel** — clicking the toolbar icon now slides in a
  floating panel pinned to the bottom-right of the page (rounded 16px corners,
  20px margins, deep shadow). Click the icon again, the × button, or press Esc
  to dismiss it. No more toolbar popup
- **Shadow DOM + CSP-safe styles** — the panel renders in an isolated shadow
  root with constructed stylesheets, so the host page's CSS and Content
  Security Policy can't break or restyle it
- Permissions unchanged in spirit: `activeTab` + `scripting` (plus
  `clipboardWrite` for the copy buttons). Everything still runs locally

## What's new in v0.3.3

- **Inter typeface** — bundled locally (no external requests, works offline),
  applied across the whole popup UI

## What's new in v0.3.2

- **Stable score** — the 0–100 score now covers stable on-page checks only.
  Volatile measurements (performance timings, robots.txt / sitemap.xml fetches,
  live link checks) are still reported but no longer move the score, so it stays
  consistent between reloads
- **100% real data audit** — no sample or placeholder data anywhere; every
  number comes from the live page. Fix suggestions now cite real page values:
  oversized images show actual served vs displayed widths with % pixel waste,
  and heavy-page fixes list the 5 heaviest real resources by KB

## What's new in v0.3.1

- **UI redesign** — cohesive design system: soft indigo header, card-based
  check list with status glow dots, pill tab bar, refined tables, dark code
  snippets, and smooth micro-interactions
- **Minimal scrollbar** — slim 6px rounded scrollbar on the popup (and dark
  variant inside code snippets); Firefox gets `scrollbar-width: thin` too

## What's new in v0.3

- **Performance tab** — Core Web Vitals (LCP, CLS, TTFB), page weight,
  request count, DOM timing, and long tasks, each with pass/warn/fail checks
- **Broken link checker** — pings the page's links (up to 20, 6 at a time);
  same-origin links get real HTTP status checks, external links get an honest
  reachability check (browsers hide cross-origin status codes)
- **Fixes tab** — rule-based smart suggestions generated from the page's
  issues: ready-made title tags, meta descriptions, OG tags, each with a
  copy button
- **Exportable reports** — "Copy report" and "Download .md" buttons produce a
  full Markdown report (score, all checks, keywords, performance, broken
  links, fixes)
- 25 checks now feed the score (was 13 in v0.1, 17 in v0.2)

## Project structure

```
seo-lens/
├── manifest.json       # MV3 manifest (activeTab + scripting only)
├── popup.html          # Popup shell: score ring, tabs, panels
├── popup.css           # Popup styling
├── popup.js            # Injects the scraper, renders results
├── scraper.js          # Dependency-free DOM scraper (runs in the page)
├── background.js       # Minimal service worker (placeholder for later)
├── icons/              # Toolbar/store icons (16, 48, 128)
└── test-fixture.html   # Local page with intentional SEO issues for testing
```

## How it works

1. User clicks the toolbar icon → `popup.html` opens.
2. `popup.js` injects `scraper.js` into the active tab with
   `chrome.scripting.executeScript` (no host permissions needed).
3. The scraper collects meta tags, headings, images, links, OG/Twitter tags,
   JSON-LD blocks, keywords, SERP data, security/crawl info, and Web
   Performance timing, then runs up to 25 checks and computes a score
   (100 − 12 per fail − 5 per warn). robots.txt / sitemap.xml / link health
   are checked over the network (async, capped so the popup stays snappy).
4. Results render in ten tabs: Overview, SERP, Keywords, Performance, Fixes,
   Headings, Images, Links, Social, Schema.

## Load it unpacked (Chrome / Edge)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `seo-lens/` folder.
4. Pin the extension, then click its icon on any website.

Firefox: MV3 is supported in recent versions — use `about:debugging` →
"This Firefox" → "Load Temporary Add-on" and pick `manifest.json`.

## Testing

- Open `test-fixture.html` in the browser and run the extension against it.
  Expected: low score with flags for missing meta description, two H1s,
  skipped heading level, images without alt text, an oversized image, missing
  OG tags, no JSON-LD, and "tomatoes" as the top keyword.
- Note: robots.txt / sitemap.xml / HTTPS / mixed-content checks are skipped on
  `file://` pages — test those on a live site.
- Try it on a well-optimized page (e.g. a major news homepage) and confirm a
  high score with mostly green checks.
- Try it on a well-optimized page (e.g. a major news homepage) and confirm a
  high score with mostly green checks.
- Confirm the friendly error appears on `chrome://extensions` (internal pages
  can't be scripted).

## Install from source

1. Clone this repo (or download the ZIP).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the repo folder.
4. Click the toolbar icon on any page.

## Roadmap (post-MVP)

- Keyword density analysis
- Basic page-speed timing (Navigation Timing API)
- robots.txt / sitemap.xml quick checks
- Exportable report (copy as Markdown / CSV)
- Dark mode, options page
- Chrome Web Store + Firefox Add-ons publishing

## Privacy

- Everything is computed locally from the live page DOM.
- Score history lives in `chrome.storage.local` on your device only.
- The only network calls are the ones the page itself would trigger
  (robots.txt / sitemap checks, plus the PageSpeed buttons you click).
- Permissions: `activeTab`, `scripting`, `clipboardWrite`, `storage`.

## License

MIT — see [LICENSE](LICENSE).
