<div align="center">

# 🎭 Actividades infantiles — Madrid

### Find the perfect kids' activity in Madrid in two taps.

A fast, installable, mobile-first web app that turns the city's raw open-data
feed into a clean, filterable agenda of children's cultural
activities — títeres, cuentacuentos, teatro, talleres, circo and more.

<br/>

![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla_JS-f7df1e?logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Server-Node.js_%E2%89%A518-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Scraper-Python-3776ab?logo=python&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?logo=pwa&logoColor=white)
![Android](https://img.shields.io/badge/Android-Capacitor_APK-3ddc84?logo=android&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-E2E_%2B_API-success)
![Zero runtime deps](https://img.shields.io/badge/Frontend_deps-zero-brightgreen)

</div>

---

## Why this project

Madrid publishes a daily feed of hundreds of municipal activities — but it is a
flat list with no age filter, no map, and no sense of "what's on this weekend
near me." As a parent, that is unusable on a phone.

This app fixes that. It parses messy, free-text Spanish event data into
structured, age-aware, date-expanded results, then presents them in a UI built
for one hand on a Saturday morning. **No build step, no framework, zero runtime
frontend dependencies** — just carefully engineered vanilla JS, a tiny Node
server, and a Python scraper.

**Live data source:** Ayuntamiento de Madrid open data, dataset 206974 —
*"Actividades culturales y de ocio municipal en los próximos 100 días"*
(CC BY 4.0, no API key, updated daily), aggregating centros culturales,
bibliotecas, museos and Juntas de Distrito.

## Screenshots

| Search & filters | Map |
| --- | --- |
| ![Search form](docs/screenshots/form.png) | ![Map view](docs/screenshots/map.png) |

| Results | Dark mode |
| --- | --- |
| ![Results list](docs/screenshots/results.png) | ![Dark mode](docs/screenshots/dark.png) |

## Highlights

- 🧠 **Real data wrangling.** Parses age ranges from free text
  (`de 3 a 6 años`, `a partir de 4 años`, `X meses` → bebés…), expands
  recurring and multi-day events into concrete dates honouring `excluded-days`,
  and ranks results so what you searched for floats to the top.
- ⚡ **Fast by design.** The whole UI is one ~45 KB HTML file (~14 KB gzipped)
  with inline CSS/JS and inline SVG icons — ~3 requests on first load, no
  bundler, no framework. The ~160 KB Leaflet map library is **lazy-loaded**
  only when the map is opened.
- 📲 **Installable PWA + native Android build.** Web manifest + service worker
  with an offline app shell (stale-while-revalidate), plus a Capacitor wrapper
  that ships a real `.apk`.
- 📍 **Location-aware.** One tap uses GPS to sort activities nearest-first and
  show the distance on each card.
- ♿ **Accessible & resilient.** Real buttons with `aria-pressed`/labels,
  visible focus rings, a live-region result count, skeleton loading, and
  graceful empty/error states.
- ✅ **Tested.** Headless-Chrome E2E flows plus a Python backend harness that
  proves bad input is coerced to safe defaults instead of crashing.

## Architecture

```
Browser (vanilla JS PWA)
      │  POST /api/search  (streaming NDJSON: progress… → result)
      ▼
server.js  (tiny Node server, no framework)
      │  spawns
      ▼
scrape.py  (fetch + 12h cache → parse age/weeks/category → rank)
      │
      ▼
Ayuntamiento de Madrid open-data agenda feed
```

- **`server.js`** — minimal Node server. Serves the page and a single
  `POST /api/search` endpoint, which spawns `scrape.py` and **streams**
  newline-delimited JSON: `progress` lines first, then one `result`. This keeps
  the UI responsive and shows live progress on slow fetches.
- **`scrape.py`** — fetches and caches the agenda feed (12 h TTL), then filters:
  - **age** — parses ranges from title/description. Activities with no stated
    age but a `Niños`/`Familias` audience are kept and labelled *"edad n/d"*.
  - **weeks** — current week + N following weeks (Mon–Sun), expanding recurring
    and multi-day events into real dates.
  - **category** — curated kid categories (cuentacuentos/títeres, teatro,
    talleres, circo/magia, cine, música, danza, visitas, fiestas…).
  - Long-running *standing programmes* are separated into a collapsible section
    so they never crowd out datable outings.

## Frontend features

- **Mobile-first** layout: sticky header, large touch targets, no horizontal
  overflow.
- **Dark mode** that follows the system theme; a header button cycles
  auto → light → dark and remembers your choice.
- Results grouped **by day** with friendly labels (⭐ Hoy, 🔜 Mañana, weekday).
- Rich activity cards: prominent time, venue + district, age/price tags, and
  one-tap **🧭 Cómo llegar** (Google Maps), **📅 Calendario** (Google Calendar),
  **🔗 Compartir** (native share sheet / clipboard) and a **★ favorite** toggle.
- **📍 Cerca de mí** (GPS nearest-first), **🎪 Finde** (weekend-only filter),
  **Favoritos** (saved in `localStorage`), and a **district filter** populated
  from live results.
- **Remembers your last search** and auto-runs it on next open — ideal once
  installed on the home screen.
- **Collapsible Leaflet map** with a pin per activity, hidden by default.

## Setup

Requirements: **Node ≥ 18** and **Python ≥ 3.9**.

```bash
# 1. Python scraper dependencies (virtualenv recommended)
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 2. Node dev/test tooling (optional — only needed to run the tests)
npm install
```

The app itself has **no runtime Node dependencies**; `npm install` only pulls
the test tooling (`puppeteer-core`).

## Run

Double-click `start.bat` (Windows), or from WSL / Linux / macOS:

```bash
node server.js
# then open http://localhost:8788/
```

On your phone (same Wi‑Fi): `http://<this-PC-IP>:8788/`.

## Testing

```bash
npm run lint:js   # parse-check the inline JS
npm test          # headless Chrome E2E: real search, cards, favorites,
                  # district filter, map pins, mobile-overflow, no JS errors
npm run test:api  # exercise the Python backend across many job shapes
```

`npm test` drives the real page in a 412×915 mobile viewport via
`puppeteer-core` + system Chrome and writes screenshots to `test/shots/`.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Vanilla JS, HTML, CSS | Zero runtime deps, instant load, nothing to build |
| Server | Node ≥ 18 (no framework) | One small file, streaming NDJSON responses |
| Scraper | Python (`curl_cffi`, falls back to `requests`) | Robust fetching + text parsing |
| Mobile | PWA + Capacitor | Installable on web and shippable as an Android APK |
| Maps | Leaflet (lazy-loaded) | Only paid for when the user opens the map |
| Tests | `puppeteer-core` + system Chrome | Real browser E2E on a mobile viewport |

## Config

- Port: `PORT=8788` (env var).
- Cache lives in `cache/agenda.json`; delete it to force a fresh fetch.

## License

[MIT](LICENSE)

---

<div align="center">
<sub>Built with vanilla JS and a focus on speed, accessibility and real-world data.</sub>
</div>
