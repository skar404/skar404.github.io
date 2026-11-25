# Slowth website moved

The website and its localization generator now live in [skar404/slowth](https://github.com/skar404/slowth/tree/main/website) and publish at https://slowth.app/.

The HTML here contains compatibility redirects, preserving each path, query string and fragment. Do not regenerate the old site here. Historical assets remain available to cached pages.

The unused test-case upload frontend has been removed. Slowth now directs feedback to `denis@malina.page` from the app. The old `/slowth-test-cases/` URL no longer hosts an upload form. The upload backend is managed separately.

Cloudflare should redirect marketing requests with HTTP 301 from `/slowth` and `/slowth/*` to `https://slowth.app/` with the prefix removed, preserving query strings. The HTML redirects provide a fallback.
