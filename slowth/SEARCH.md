# Search visibility — 17 November 2026

Local implementation; not published or submitted to an index.

## What changed

- The landing now leads with Reels/Shorts blocking **inside apps** on iPhone and iPad. Safari is a separate secondary feature.
- Instagram, YouTube, Facebook and X (Twitter) are named in visible content. The maintainer confirmed broader short-video recognition across social apps; `InAppBlockingCopy.supportedContent` independently names the four services. Screen-based recognition can make mistakes as layouts change.
- Snapchat/TikTok and arbitrary app selection are explained without promising perfect recognition or removal of native app tabs. No selection-count marketing claim.
- Specific title/description and matching Open Graph text; a canonical URL; crawlable static HTML and internal links to setup; visible answers to Reels, Shorts, Facebook/X and Snapchat/TikTok questions.
- `SoftwareApplication` JSON-LD identifies the app, platforms, developer, free offer and official download/source URLs. No invented ratings or reviews. This is descriptive markup, not a guarantee of rich results.
- `sitemap.xml` lists nine canonical public landing/support/privacy URLs. It deliberately omits test-cases, internal review notes, duplicate index.html and historical assets. No artificial last-modified dates.

## Live observations

At review time, the public homepage still described a Safari-only product. Local preview content cannot affect search results until published and recrawled.

The live root robots.txt returned HTTP 200 and Cloudflare-managed rules. Googlebot, Bingbot and OAI-SearchBot fall under the wildcard Allow rule; GPTBot and several training crawlers are blocked. Search access and training consent are distinct. This is a robots-rule inspection, not proof that Cloudflare allows requests from each crawler's actual IP range. No Cloudflare settings or training permissions were changed.

Google says AI search uses normal SEO foundations; no special AI text file or schema is required. OpenAI recommends allowing OAI-SearchBot and its published IP ranges for ChatGPT search. Neither indexing nor citations/ranking can be guaranteed.

Sources:
- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.openai.com/api/docs/bots
- https://malina.page/robots.txt

## After approved publication

1. Verify the deployed HTML, canonical URLs, sitemap and response headers; ensure no noindex or unintended crawler block is introduced by hosting/CDN.
2. Submit `https://malina.page/slowth/sitemap.xml` in Google Search Console and Bing Webmaster Tools. Request recrawling of the landing and Support. The HTML sitemap link is not a substitute for submission or a root robots Sitemap directive.
3. Use URL Inspection and CDN crawler logs to confirm actual crawling. Keep the existing training opt-out independent from search access.
4. Measure impressions/clicks for “block Instagram Reels iPhone”, “block YouTube Shorts in app”, “Facebook Reels blocker”, “X Twitter video blocker”, and “Snapchat app blocker”. Evaluate citations separately; a manual AI query is not a stable ranking metric.
5. The landing is English as approved. To deliberately target Russian queries such as “блокировка Reels в приложении”, publish a useful Russian translation with self-canonical and reciprocal hreflang, rather than stuffing Russian keywords into the English page. No Russian-language ranking claim is made by this change.
