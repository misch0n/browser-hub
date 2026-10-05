# browser-hub

A static site deployed to GitHub Pages.

## Development

Open `index.html` in a browser, or serve the directory locally:

```sh
python3 -m http.server 8000
```

## Deployment

Pushes to `main` are deployed automatically by `.github/workflows/pages.yml`.
In the repository settings, set **Pages → Source** to **GitHub Actions**.
