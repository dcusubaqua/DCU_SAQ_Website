# dcusubaqua

The DCU Sub-Aqua Club website. Scrolling the page is a dive: the water darkens as you go down, sea life passes at different depths, and the page ends on a wreck at 60 m.

## Vercel deployment

Production site: [DCU Sub-Aqua Club](https://dcusaqwebsite.vercel.app/).

The Vercel project deploys from `main`. The site is static HTML, CSS, and JavaScript. Vercel serves the repository root directly without an install or build step.

## Local preview

Open `index.html` in a browser, or serve the folder with a simple static server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## How the descent works

- `script.js` maps scroll position to depth (`MAX_DEPTH`, 60 m at the bottom of the page). One animation loop sets the water colour, the dive console and everything in the background.
- The console on the right (desktop) is a half gauge. The outer bezel holds the section links and turns to the section you are in. The inner scale and the rolling counter show the depth. Below 1180 px wide, or 600 px tall, it becomes a round gauge in the bottom-right corner that opens a "Dive plan" list.
- The links in `nav.console` are the stops. Their depths are measured from the page layout, so adding or moving a section needs no other change.
- Large animals are inline SVG elements in `.ocean-life`. `data-at` is the point in the scroll (0 to 1) where each one appears, and the other `data-*` attributes set its speed, direction and parallax. Fish schools, bubbles, particles and the tentacles near the bottom are drawn on the canvas, configured in `SCHOOLS` and `TENTACLES` in `script.js`.
- With reduced motion turned on, the background stays still and the gauge jumps straight to the current depth.

## Updating club content

The committee roster is in the `#committee` section of `index.html`. Portraits live in
`assets/club/committee/`. Update the committee year, names, roles, and photos together at the start of a new term.

Club photos, committee details and contact form come from the [original club site](https://sites.google.com/view/dcusac/).
The diving and hockey pages on that site describe the club's training and activities. The club email and
Instagram are listed by [DCU Sport](https://www.dcu.ie/dcusport/sports-clubs).

The dive video is `trailer.mp4`. It loads when a visitor plays it.
