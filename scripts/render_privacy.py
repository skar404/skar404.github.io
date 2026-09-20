#!/usr/bin/env python3
"""Render the seven static privacy pages. No browser script or cookies needed."""
import argparse
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "slowth"
LOCALES = ("en", "es-MX", "hi", "fr-FR", "ar-SA", "ja", "de-DE")


def filename(locale):
    return "privacy.html" if locale == "en" else f"privacy-{locale}.html"


def render(locale, copy, all_copy):
    e = html.escape
    direction = "rtl" if locale == "ar-SA" else "ltr"
    alternates = "\n".join(
        f'<link rel="alternate" hreflang="{code}" href="https://malina.page/slowth/{filename(code)}" />'
        for code in LOCALES
    )
    languages = "\n".join(
        f'    <a href="{filename(code)}" lang="{code}" hreflang="{code}"'
        + (' aria-current="page"' if code == locale else '')
        + f'><bdi>{e(all_copy[code]["name"])}</bdi></a>'
        for code in LOCALES
    )
    sections = []
    for section in copy["sections"]:
        paragraphs = "\n".join(f'    <p>{e(p)}</p>' for p in section["paragraphs"])
        sections.append(f'  <section>\n    <h2>{e(section["heading"])}</h2>\n{paragraphs}\n  </section>')
    body = "\n".join(sections)
    return f'''<!doctype html>
<html lang="{locale}" dir="{direction}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Slowth — {e(copy["title"])}</title>
<meta name="description" content="{e(copy["description"])}" />
<link rel="canonical" href="https://malina.page/slowth/{filename(locale)}" />
{alternates}
<link rel="alternate" hreflang="x-default" href="https://malina.page/slowth/privacy.html" />
<link rel="icon" type="image/png" href="img/logo/logo.png" />
<link rel="apple-touch-icon" href="img/logo/logo.png" />
<link rel="stylesheet" href="style.css" />
<link rel="stylesheet" href="privacy.css" />
</head>
<body>
<div class="shell">
  <header class="hero">
    <img class="hero-icon" src="img/logo/logo.png" alt="{e(copy["logo"])}" width="84" height="84" />
    <div>
      <div class="brand" dir="ltr">Slowth</div>
      <div class="tag">{e(copy["title"])}</div>
    </div>
  </header>
  <nav class="nav">
    <a href="index.html">{e(copy["home"])}</a>
    <a href="support.html">{e(copy["support"])}</a>
    <a href="{filename(locale)}" aria-current="page">{e(copy["privacy"])}</a>
  </nav>
  <nav class="language-picker" aria-label="{e(copy["languageLabel"])}">
    <span class="language-label">{e(copy["languageLabel"])}</span>
{languages}
  </nav>
  <main>
    <h1>{e(copy["title"])}</h1>
    <p class="meta">{e(copy["updated"])}</p>
    <p class="lede">{e(copy["summary"])}</p>
{body}
    <ul class="privacy-links">
      <li><a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">{e(copy["githubLabel"])}</a></li>
      <li><a href="https://www.cloudflare.com/privacypolicy/">{e(copy["cloudflareLabel"])}</a></li>
    </ul>
    <section>
      <h2>{e(copy["contact"])}</h2>
      <div class="card">
        <p>{e(copy["contactText"])}</p>
        <p class="contact-email">{e(copy["emailLabel"])}: <a href="mailto:denis@malina.page?subject=Slowth%20privacy"><bdi dir="ltr">denis@malina.page</bdi></a></p>
      </div>
    </section>
  </main>
  <footer>
    <div><bdi dir="ltr">© 2026 Slowth.</bdi></div>
    <div><a href="index.html">{e(copy["home"])}</a> · <a href="support.html">{e(copy["support"])}</a></div>
  </footer>
</div>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check generated pages without writing")
    args = parser.parse_args()
    translations = json.loads((SITE / "privacy-content.json").read_text(encoding="utf-8"))
    assert set(translations) == set(LOCALES), "Unexpected locales"
    for locale in LOCALES:
        copy = translations[locale]
        assert copy.keys() == translations["en"].keys(), f"Missing fields: {locale}"
        assert len(copy["sections"]) == len(translations["en"]["sections"])
        for section, source in zip(copy["sections"], translations["en"]["sections"]):
            assert len(section["paragraphs"]) == len(source["paragraphs"]), locale
            assert section["heading"] and all(section["paragraphs"]), locale
        page = render(locale, copy, translations)
        path = SITE / filename(locale)
        if args.check:
            assert path.read_text(encoding="utf-8") == page, f"Regenerate {path}"
        else:
            path.write_text(page, encoding="utf-8")
        print(f'{"Checked" if args.check else "Rendered"} {path.relative_to(ROOT)}')


if __name__ == "__main__":
    main()
