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

## Updating club content

The committee roster is in the `#committee` section of `index.html`. Portraits live in
`assets/club/committee/`. Update the committee year, names, roles, and photos together at the start of a new term.

Club photos, committee details and contact form come from the [original club site](https://sites.google.com/view/dcusac/).
The diving and hockey pages on that site describe the club's training and activities. The club email and
Instagram are listed by [DCU Sport](https://www.dcu.ie/dcusport/sports-clubs).

The dive video is `trailer.mp4`. It loads when a visitor plays it.
