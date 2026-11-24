# dcusubaqua

Modern dark-theme rebuild for the DCU Sub-Aqua Club website.

## Vercel deployment

Production site: [DCU Sub-Aqua Club](https://dcusaqwebsite.vercel.app/).

The Vercel project deploys from `main`. The site is static HTML, CSS, and JavaScript. Vercel serves the repository root directly without an install or build step.

## Local preview

Open `index.html` in a browser, or serve the folder with a simple static server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Committee headshots

Place committee images in `assets/headshots/` using these filenames:

- `captain.jpg`
- `secretary.jpg`
- `treasurer.jpg`
- `equipment.jpg`
- `training.jpg`
- `diving-officer.jpg`
- `hockey-captain.jpg`
- `events.jpg`
- `first-year.jpg`

PNG, JPG, or WEBP also work if you update the matching path in `script.js`.

Update the matching committee names and notes in `script.js` once you have the final roster.

## Trailer

The homepage hero uses `trailer.mp4` from the repo root.
