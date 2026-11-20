# Slowth website moved

The website and its localization generator now live in [skar404/slowth](https://github.com/skar404/slowth/tree/main/website) and publish at https://slowth.app/.

The HTML here contains compatibility redirects, preserving each path, query string and fragment. Do not regenerate the old site here. Historical assets remain available to cached pages.

`../slowth-test-cases/` remains on malina.page because its upload API and visitor cookies depend on that origin. A dedicated edge rule forwards `/slowth/test-cases` and descendants to `/slowth-test-cases`, preserving the suffix and query string. This avoids the GitHub Pages project route shadowing `/slowth/`.

Cloudflare should redirect marketing requests with HTTP 301 from `/slowth` and `/slowth/*` to `https://slowth.app/` with the prefix removed, preserving query strings. The HTML redirects provide a fallback.
