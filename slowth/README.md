# Slowth landing site

Static HTML for **https://skar404.github.io/slowth/**.

## Pages

| Path | Purpose | App Store Connect field |
|---|---|---|
| `index.html` | Marketing landing | **Marketing URL** |
| `support.html` | FAQ + contact | **Support URL** |
| `privacy.html` | Privacy policy | **Privacy Policy URL** |

## Hosting on GitHub Pages

The simplest layout: a separate repo named `slowth` under `skar404`, with these files at the repo root.

```sh
# from /Users/denis/project/person/mini-block/site
git init
git add .
git commit -m "Initial Slowth landing site"
git branch -M main
git remote add origin git@github.com:skar404/slowth.git
git push -u origin main
```

Then on GitHub: **Repo → Settings → Pages → Source: Deploy from branch → Branch: main / (root) → Save.**

After ~30 seconds the site is live at:

- https://skar404.github.io/slowth/ — Marketing URL
- https://skar404.github.io/slowth/support.html — Support URL
- https://skar404.github.io/slowth/privacy.html — Privacy Policy URL

The `.nojekyll` file disables Jekyll preprocessing so files starting with `_` are served as-is.

## Editing

Pure HTML + one `style.css`. No build step. Open `index.html` in a browser to preview locally.
