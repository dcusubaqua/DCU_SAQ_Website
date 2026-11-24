# dcusubaqua

The DCU Sub-Aqua Club website. Scrolling the page is a dive: the water darkens as you go down, sea life passes at different depths, and the page ends on a wreck at 60 m.

## Vercel deployment

Production site: [DCU Sub-Aqua Club](https://www.dcusubaquaclub.com/).

The Vercel project deploys from `main`. The site is static HTML, CSS, and JavaScript. Vercel serves the repository root directly without an install or build step.

## Local preview

Open `index.html` in a browser, or serve the folder with a simple static server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## How the descent works

- `script.js` maps scroll position to depth, from `START_DEPTH` (3 m, so the page opens underwater) to `MAX_DEPTH` (60 m at the bottom). One animation loop sets the water colour, the dive console and everything in the background.
- On desktop the console is a small half gauge on the right edge showing the depth in whole metres. Pointing at it, tabbing into it or tapping it opens it out to full size, with the section links on the outer bezel; the bezel turns to the section you are in. The content column keeps clear of the gauge (`--side` in `styles.css`), so nothing is pushed sideways. Below 1180 px wide, or 600 px tall, it becomes a round gauge in the bottom-right corner that opens a "Dive plan" list.
- The links in `nav.console` are the stops. Their depths are measured from the page layout, so adding or moving a section needs no other change.
- Large animals are inline SVG elements in `.ocean-life`. `data-at` is the point in the scroll (0 to 1) where each one appears, and the other `data-*` attributes set its speed, direction and parallax. Fish schools, bubbles, particles and the tentacles near the bottom are drawn on the canvas, configured in `SCHOOLS` and `TENTACLES` in `script.js`.
- The wreck at the bottom is three SVG layers in the footer (`.seabed-far`, `.wreck`, `.seabed-near`) that shift slightly apart with the pointer and as the footer scrolls in. A canvas over them (`.torch-light`) paints the dark water and a diver's torch: it switches on when the footer comes into view, sweeps the wreck from bow to stern, then lights the rocks behind it. On a computer it follows the mouse; on a phone, tap to point it. The stops are `TORCH_PATH` in `script.js`.
- The committee is one strip that drifts slowly sideways and loops forever (`setUpCrew` in `script.js` clones the list on both sides). It pauses while the pointer or keyboard focus is on it, and for a few seconds after someone scrolls, swipes, drags or uses the arrow buttons.
- With reduced motion turned on, the background stays still, the gauge jumps straight to the current depth, the committee strip does not drift and the torch stays on the bow of the wreck.

## Updating club content

The committee roster is the list in the `#committee` section of `index.html`; add or remove `<li>` entries there and the carousel adapts. Each card shows one to three qualification stars in the corner of the photo: set `data-stars` on the `<li>`, put that many `<svg class="star">` icons in its `.stars` span, and update the span's `aria-label` to match. The current star counts are placeholders. Portraits live in
`assets/club/committee/`. Update the committee year, names, roles, and photos together at the start of a new term.

Club photos, committee details and contact form come from the [original club site](https://sites.google.com/view/dcusac/).
The diving and hockey pages on that site describe the club's training and activities. The club email and
Instagram are listed by [DCU Sport](https://www.dcu.ie/dcusport/sports-clubs).
