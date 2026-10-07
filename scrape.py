#!/usr/bin/env python3
"""
scrape.py — Madrid children's cultural activities finder.

Data source: Ayuntamiento de Madrid open data, dataset 206974
  "Actividades culturales y de ocio municipal en los proximos 100 dias"
  https://datos.madrid.es/egob/catalogo/206974-0-agenda-eventos-culturales-100.json

This feed aggregates events from centros culturales, socioculturales, centros
juveniles, bibliotecas, museos and Juntas de Distrito for the next ~100 days.
It is CC BY 4.0, no API key, updated daily. We fetch once and cache locally.

Job/output contract (same style as the poi-map trip planner):
  - Reads a JSON job on argv[1]. If argv[1] starts with "@" it's a file path.
  - Emits "PROGRESS <json>" lines to stderr for live UI updates.
  - Emits the final result as a single JSON object to stdout.

Job fields:
  {
    "age": 3,                 # child age in years (int)
    "weeks": 3,               # how many weeks ahead to include (incl. current)
    "categories": [...],      # list of category keys to keep (empty = all kid cats)
    "free_only": false,       # only free activities
    "strict_age": false,      # if true, drop activities with no stated age range
    "query": ""               # optional free-text filter
  }

Output:
  { "generated": "...", "count": N, "weeks": [...], "activities": [ {...} ] }
"""
import json
import os
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta

try:
    from curl_cffi import requests as creq
    _IMPERSONATE = "chrome124"
except Exception:  # fall back to plain requests if curl_cffi unavailable
    import requests as creq
    _IMPERSONATE = None

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "agenda.json")
FEED_URL = ("https://datos.madrid.es/egob/catalogo/"
            "206974-0-agenda-eventos-culturales-100.json")
UA = "madrid-kids-activities/1.0 (personal, non-commercial)"
CACHE_TTL = 12 * 3600  # refetch at most twice a day; data updates daily

# Categories (the tail of the @type URI) that are kid-relevant. The UI shows
# these; an empty "categories" filter means "all of these".
KID_CATEGORIES = {
    "CuentacuentosTiteresMarionetas": "Cuentacuentos / Titeres",
    "TeatroPerformance":              "Teatro",
    "CursosTalleres":                 "Talleres",
    "CircoMagia":                     "Circo / Magia",
    "CineActividadesAudiovisuales":   "Cine",
    "Musica":                         "Musica",
    "DanzaBaile":                     "Danza",
    "ExcursionesItinerariosVisitas":  "Visitas / Itinerarios",
    "ClubesLectura":                  "Club de lectura",
    "ActividadesCalleArteUrbano":     "Calle / Arte urbano",
    "Fiestas":                        "Fiestas",
}

# Keywords that strongly signal a children's / family activity are defined
# below (see _STRONG_KW / _WEAK_KW), closer to where they are used.

DAYMAP = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def progress(**kw):
    sys.stderr.write("PROGRESS " + json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stderr.flush()


def norm(s):
    """Lowercase, strip accents, collapse spaces."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower()).strip()


def _as_int(v, default, lo, hi):
    """Coerce a possibly-bad value to an int clamped to [lo, hi]."""
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


# ── Age parsing ────────────────────────────────────────────────────────────
# Returns (min_age, max_age) in years, with None meaning open-ended, or None
# if no age info is found at all.
_RANGE = re.compile(r"(?:de\s*)?(\d{1,2})\s*(?:a|-|–|y|hasta)\s*(\d{1,2})\s*an?os", re.I)
_FROM = re.compile(r"a\s*partir\s*de\s*(?:los\s*)?(\d{1,2})\s*an?os", re.I)
_FROM2 = re.compile(r"(?:mayores|desde)\s*(?:de\s*)?(\d{1,2})\s*an?os", re.I)
_UPTO = re.compile(r"(?:hasta|menores\s*de)\s*(\d{1,2})\s*an?os", re.I)
_EXACT = re.compile(r"\b(\d{1,2})\s*an?os\b", re.I)
_MONTHS = re.compile(r"(\d{1,2})\s*mes", re.I)  # bebes: a few months old -> age 0


def parse_age_range(text):
    t = norm(text)
    if not t:
        return None
    m = _RANGE.search(t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return (min(a, b), max(a, b))
    m = _FROM.search(t) or _FROM2.search(t)
    if m:
        return (int(m.group(1)), None)
    m = _UPTO.search(t)
    if m:
        return (0, int(m.group(1)))
    if _MONTHS.search(t):
        return (0, 3)  # "X meses" -> babies/toddlers
    m = _EXACT.search(t)
    if m:
        a = int(m.group(1))
        if a <= 17:  # avoid "25 años del museo" false positives
            return (a, a)
    return None


def age_matches(rng, age):
    if rng is None:
        return None  # unknown
    lo, hi = rng
    if lo is not None and age < lo:
        return False
    if hi is not None and age > hi:
        return False
    return True


# Strong single-word signals that, on their own, DO NOT prove a kid activity
# (they produced noise like "magia de la luna", "Niños de Vallecas"). We only
# treat these as a *boost*, never as the sole reason to include an activity.
_WEAK_KW = {"magia", "nino", "ninos"}

# These phrases are specific enough to count as a real kid signal by themselves.
_STRONG_KW = [
    "titere", "marioneta", "cuentacuento", "cuenta cuento", "teatro infantil",
    "taller infantil", "publico infantil", "para ninos", "para ninas",
    "infantil", "primera infancia", "bebe", "familiar", "en familia",
    "para toda la familia", "ciclo bebes",
]
# "a partir de" is deliberately NOT here: it very often introduces an *older*
# minimum age (e.g. "a partir de 13 anos") and let adult theatre slip through.


def audience_is_kid(audience):
    au = norm(audience)
    return ("nino" in au) or ("familia" in au)


def is_kid_activity(cat, audience, title, desc):
    """Decide whether an event is genuinely aimed at kids/families.

    Anchored (not just keyword-matched) to cut noise:
      1. Cuentacuentos/Titeres is a kids category almost by definition -> keep.
      2. Explicit audience "Ninos"/"Familias" -> keep.
      3. In any OTHER curated kid category, require a strong kid phrase in the
         text (so a generic adult concert in "Musica" is dropped).
    Pure weak-keyword matches (e.g. the word "magia" or "ninos" in a title)
    are NOT enough on their own.
    """
    if cat == "CuentacuentosTiteresMarionetas":
        return True
    if audience_is_kid(audience):
        return True
    blob = norm(title + " " + (desc or ""))
    has_strong = any(k in blob for k in _STRONG_KW)
    if cat in KID_CATEGORIES and has_strong:
        return True
    return False


# Ranking: what you specifically asked for (titeres, cuentacuentos, teatro,
# circo) floats to the top; generic family listings sink.
_CAT_WEIGHT = {
    "CuentacuentosTiteresMarionetas": 100,
    "TeatroPerformance": 80,
    "CircoMagia": 75,
    "CursosTalleres": 60,
    "Musica": 45,
    "DanzaBaile": 45,
    "CineActividadesAudiovisuales": 40,
    "Fiestas": 35,
    "ExcursionesItinerariosVisitas": 25,
    "ClubesLectura": 25,
    "ActividadesCalleArteUrbano": 20,
}


def relevance(cat, audience, title, desc, age_known, age_match, standing=False):
    score = _CAT_WEIGHT.get(cat, 10)
    if audience_is_kid(audience):
        score += 20
    blob = norm(title + " " + (desc or ""))
    if any(k in blob for k in ("titere", "marioneta", "cuentacuento",
                               "cuenta cuento")):
        score += 25
    if age_known and age_match is True:
        score += 15  # explicit age that fits the child
    if standing:
        score -= 50  # long-running standing listing, not a datable outing
    return score


# ── Date / week handling ─────────────────────────────────────────────────────
def parse_dt(s):
    if not s:
        return None
    s = s.strip().split(".")[0]  # drop ".0" fraction
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def week_windows(n):
    """List of (label, start_date, end_date) for current + n-1 following weeks.
    Weeks run Monday..Sunday."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    out = []
    for i in range(max(1, n)):
        start = monday + timedelta(weeks=i)
        end = start + timedelta(days=6)
        label = "Esta semana" if i == 0 else ("Proxima semana" if i == 1
                                              else f"En {i} semanas")
        out.append((label, start, end))
    return out


def occurs_in(ev_start, ev_end, win_start, win_end, recurrence, excluded):
    """Does the event (possibly a date range / recurring) touch the window?
    Returns a sorted list of concrete dates within the window it occurs on."""
    if ev_start is None:
        return []
    ev_end = ev_end or ev_start
    lo = max(ev_start, win_start)
    hi = min(ev_end, win_end)
    if lo > hi:
        return []
    allowed_days = None
    if recurrence and isinstance(recurrence, dict):
        days = recurrence.get("days") or ""
        if days:
            allowed_days = {DAYMAP[d] for d in days.split(",") if d in DAYMAP}
    hits = []
    d = lo
    while d <= hi:
        if (allowed_days is None or d.weekday() in allowed_days) and d not in excluded:
            hits.append(d.isoformat())
        d += timedelta(days=1)
    return hits


def parse_excluded(s):
    out = set()
    if not s:
        return out
    for tok in re.split(r"[;,]", s):
        dt = parse_dt(tok)
        if dt:
            out.add(dt)
    return out


# ── Fetch / cache ─────────────────────────────────────────────────────────
def fetch_feed(force=False):
    if (not force and os.path.exists(CACHE)
            and time.time() - os.path.getmtime(CACHE) < CACHE_TTL):
        progress(phase="cache", msg="Usando cache local del dia")
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    progress(phase="fetch", msg="Descargando agenda de datos.madrid.es…")
    kw = {"headers": {"User-Agent": UA}, "timeout": 40}
    if _IMPERSONATE:
        kw["impersonate"] = _IMPERSONATE
    r = creq.get(FEED_URL, allow_redirects=True, **kw)
    r.raise_for_status()
    data = r.json()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    progress(phase="fetch", msg=f"Descargados {len(data.get('@graph', []))} eventos")
    return data


def get_latlon(ev):
    loc = ev.get("location") or {}
    try:
        return float(loc.get("latitude")), float(loc.get("longitude"))
    except (TypeError, ValueError):
        return None, None


def get_district(ev):
    addr = ev.get("address") or {}
    dist = addr.get("district") or {}
    did = dist.get("@id", "") if isinstance(dist, dict) else ""
    # @id tail is a human-ish slug
    return did.rstrip("/").split("/")[-1].replace(".json", "") if did else ""


def get_street(ev):
    addr = ev.get("address") or {}
    area = addr.get("area") or {}
    if isinstance(area, dict):
        parts = [area.get("street-address", ""), area.get("postal-code", ""),
                 area.get("locality", "")]
        return ", ".join(p for p in parts if p)
    return ""


def run(job):
    age = _as_int(job.get("age"), default=3, lo=0, hi=17)
    weeks = _as_int(job.get("weeks"), default=3, lo=1, hi=12)
    want_cats = set(job.get("categories") or [])
    free_only = bool(job.get("free_only", False))
    strict_age = bool(job.get("strict_age", False))
    query = norm(job.get("query", "") or "")

    data = fetch_feed()
    graph = data.get("@graph", [])
    wins = week_windows(weeks)
    win_lo = wins[0][1]
    win_hi = wins[-1][2]

    progress(phase="filter", msg=f"Filtrando {len(graph)} eventos para {age} anos…")

    out = []
    for ev in graph:
        cat = ev.get("@type", "").rstrip("/").split("/")[-1]
        title = ev.get("title", "") or ""
        desc = ev.get("description", "") or ""
        audience = ev.get("audience", "") or ""

        if not is_kid_activity(cat, audience, title, desc):
            continue
        if want_cats and cat not in want_cats:
            continue
        if free_only and str(ev.get("free", "")) not in ("1", "True", "true"):
            continue
        if query and query not in norm(title + " " + desc):
            continue

        rng = parse_age_range(title + " " + desc)
        match = age_matches(rng, age)
        if match is False:
            continue
        if strict_age and rng is None:
            continue

        ev_start = parse_dt(ev.get("dtstart"))
        ev_end = parse_dt(ev.get("dtend"))
        excluded = parse_excluded(ev.get("excluded-days"))
        recurrence = ev.get("recurrence")

        dates = occurs_in(ev_start, ev_end, win_lo, win_hi, recurrence, excluded)
        if not dates:
            continue

        # Decide whether this is a standing listing (an enrolment notice,
        # season programme or permanent service) rather than a datable outing.
        # Signatures:
        #   - a long continuous run (>= ~2 weeks), OR
        #   - recurs on (almost) every weekday across a multi-day span, i.e. it
        #     is "always on" rather than a one-off show.
        span_days = ((ev_end or ev_start) - ev_start).days if ev_start else 0
        rec_days = ""
        if recurrence and isinstance(recurrence, dict):
            rec_days = recurrence.get("days") or ""
        n_rec_days = len([d for d in rec_days.split(",") if d])
        all_week = n_rec_days >= 6                      # ~every day of the week
        standing = (
            span_days >= 14
            or (all_week and span_days >= 5)
            or len(dates) >= 7                          # shows up on 7+ dates
        )

        lat, lon = get_latlon(ev)
        out.append({
            "id": ev.get("id"),
            "title": title.strip(),
            "description": desc.strip()[:600],
            "category": cat,
            "category_label": KID_CATEGORIES.get(cat, cat),
            "audience": audience,
            "age_range": rng,          # [lo, hi] or null
            "age_known": rng is not None,
            "age_match": match,        # True / None (unknown); False already dropped
            "standing": standing,      # long-running program vs discrete event
            "score": relevance(cat, audience, title, desc,
                               rng is not None, match, standing),
            "free": str(ev.get("free", "")) in ("1", "True", "true"),
            "price": (ev.get("price") or "").strip(),
            "time": (ev.get("time") or "").strip(),
            "venue": (ev.get("event-location") or "").strip(),
            "district": get_district(ev),
            "address": get_street(ev),
            "lat": lat, "lon": lon,
            "link": (ev.get("link") or "").strip(),
            "dates": dates,            # concrete dates within the window
        })

    # Within each day, show the most relevant kid activities first.
    out.sort(key=lambda a: (a["dates"][0], -a["score"], a["title"].lower()))
    progress(phase="done", msg=f"{len(out)} actividades encontradas")

    return {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "age": age,
        "count": len(out),
        "weeks": [{"label": l, "start": s.isoformat(), "end": e.isoformat()}
                  for (l, s, e) in wins],
        "activities": out,
    }


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg.startswith("@"):
        with open(arg[1:], encoding="utf-8") as f:
            job = json.load(f)
    elif arg:
        job = json.loads(arg)
    else:
        job = json.load(sys.stdin)
    result = run(job)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
