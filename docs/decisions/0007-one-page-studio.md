# 0007. One page, seven layouts, and a Studio pick kept in the browser

**Status:** in use since 7ae1491 (2026-11-13). Sources read 2026-11-14.

## Decision

`/` is the only page. [index.html](../../worker/public/index.html) loads the presets and
[studio/loader.js](../../worker/public/studio/loader.js), which asks [studio/choice.js](../../worker/public/studio/choice.js)
what to show (a `?layout=` link, else the visitor's saved pick, else the default), loads only that
layout's styles and scripts, and renders it. A pick in the Studio panel is saved in `localStorage` and the
page reloads into it. The panel is a modal dialog; colours are checked for contrast; animations respect
the reduced-motion setting.

## Sources

- [Workers static assets, HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/),
  default `auto-trailing-slash`: "/file.html | 307 to /file" and "/file | 200 | /dist/file.html". So the
  loader fetches the one-column markup as `/simple/main1`, not `/simple/main1.html`, and skips a redirect.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): "When a dialog
  opens, focus moves to an element contained in the dialog"; Tab from the last element "moves focus to
  the first tabbable element inside the dialog" and Shift + Tab the reverse; "Escape: Closes the dialog";
  "When a dialog closes, focus returns to the element that invoked the dialog". The Studio does each of
  these, and the browser tests check them.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/), 1.4.3: "a contrast ratio of at least 4.5:1" for text; 1.4.11:
  "at least 3:1 against adjacent color(s)" for what identifies a control. Every colour set is checked
  against those: body and muted text 4.5:1, the accent 3:1, button text 4.5:1 on each accent colour.
- [MDN, prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion):
  it is "used to detect if a user has enabled a setting on their device to minimize the amount of
  non-essential motion". When it is set, the animations stop.

## Evidence (this repository)

- 10 unit tests on the choice logic ([worker/test/choice.test.ts](../../worker/test/choice.test.ts)),
  including a saved pick of a removed layout and the old `?layout=report` link.
- 18 browser tests at desktop and phone size ([worker/e2e/site.e2e.ts](../../worker/e2e/site.e2e.ts)):
  35 passed and 1 skipped (the phone-only bottom-sheet test at desktop size) in CI. Against the page from
  before the Studio, all 17 desktop tests fail, which shows they test the new behaviour.
- After deploying, every live file matched the repository byte for byte, and two real questions were
  answered on the live site (7ae1491).

## Rejected

- **One HTML file per layout:** a saved one-column pick would then need a redirect on every visit, and the
  address would change with the layout. One page keeps one address.
- **Storing picks on the server:** nothing to gain, and it would mean keeping something about visitors.
- **Switching layouts without a reload:** the two layout families bring different stylesheets and scripts
  that would have to unload cleanly. A reload is simpler and costs one round trip on a cached page.

## Trade-off

The page is invisible until the chosen layout is styled and rendered (with a 6-second fallback), so a slow
network shows a blank page briefly. The saved colour set's background is painted first, so it is not a
white flash.

## What would change it

If the reload on each pick feels slow on real phones (not yet measured on devices), or if search engines
need the layouts' content in the HTML itself rather than rendered by script.
