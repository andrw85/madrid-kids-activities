/*
 * engine.js — on-device Madrid kids-activities engine (JS port of scrape.py).
 *
 * Runs ENTIRELY on the phone. Fetches the Ayuntamiento de Madrid open-data
 * agenda feed via Capacitor's native HTTP plugin (bypasses CORS), caches it in
 * localStorage (12h), then filters by age/weeks/category/etc exactly like the
 * Python backend. Exposes window.MadridEngine.runSearch(job, emit).
 *
 * The api-shim intercepts POST /api/search and drives runSearch with an emit()
 * that frames ndjson events the untouched index.html UI already consumes.
 */
(function () {
  "use strict";

  const FEED_URL =
    "https://datos.madrid.es/egob/catalogo/206974-0-agenda-eventos-culturales-100.json";
  const UA = "madrid-kids-activities/1.0 (personal, non-commercial)";
  const CACHE_KEY = "mk_feedCache";
  const CACHE_TTL = 12 * 3600 * 1000;

  // ── HTTP: native when packaged (no CORS), fetch fallback for browser dev ──
  async function fetchFeed(emit) {
    // cache
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.t && Date.now() - c.t < CACHE_TTL && c.graph) {
          emit("progress", { phase: "cache", msg: "Usando caché local del día" });
          return c.graph;
        }
      }
    } catch (e) {}

    emit("progress", { phase: "fetch", msg: "Descargando agenda de datos.madrid.es…" });
    let data = null;
    const Cap = window.Capacitor;
    if (Cap && Cap.Plugins && Cap.Plugins.CapacitorHttp) {
      const resp = await Cap.Plugins.CapacitorHttp.get({
        url: FEED_URL,
        headers: { "User-Agent": UA, Accept: "application/json" },
        responseType: "json",
      });
      data = typeof resp.data === "string" ? JSON.parse(resp.data) : resp.data;
    } else {
      const r = await fetch(FEED_URL, { headers: { Accept: "application/json" } });
      data = await r.json();
    }
    const graph = (data && data["@graph"]) || [];
    emit("progress", { phase: "fetch", msg: "Descargados " + graph.length + " eventos" });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), graph: graph }));
    } catch (e) {}
    return graph;
  }

  // ── helpers (ported from scrape.py) ──────────────────────────────────────
  function norm(s) {
    if (!s) return "";
    return s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  function asInt(v, def, lo, hi) {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = def;
    return Math.max(lo, Math.min(hi, n));
  }

  const KID_CATEGORIES = {
    CuentacuentosTiteresMarionetas: "Cuentacuentos",
    TeatroPerformance: "Teatro",
    CursosTalleres: "Talleres",
    CircoMagia: "Circo",
    CineActividadesAudiovisuales: "Cine",
    Musica: "Música",
    DanzaBaile: "Danza",
    ExcursionesItinerariosVisitas: "Visitas",
    ClubesLectura: "Lectura",
    ActividadesCalleArteUrbano: "Arte urbano",
    Fiestas: "Fiestas",
  };
  // Turn an unknown CamelCase @type tail into readable words, so the card
  // label never shows a long glued string like "ExcursionesItinerariosVisitas".
  function prettyCat(cat) {
    if (!cat) return "Actividad";
    return String(cat).replace(/([a-z\u00e0-\u00ff])([A-Z])/g, "$1 $2").trim();
  }
  const STRONG_KW = [
    "titere", "marioneta", "cuentacuento", "cuenta cuento", "teatro infantil",
    "taller infantil", "publico infantil", "para ninos", "para ninas",
    "infantil", "primera infancia", "bebe", "familiar", "en familia",
    "para toda la familia", "ciclo bebes",
  ];
  const CAT_WEIGHT = {
    CuentacuentosTiteresMarionetas: 100, TeatroPerformance: 80, CircoMagia: 75,
    CursosTalleres: 60, Musica: 45, DanzaBaile: 45, CineActividadesAudiovisuales: 40,
    Fiestas: 35, ExcursionesItinerariosVisitas: 25, ClubesLectura: 25,
    ActividadesCalleArteUrbano: 20,
  };
  const DAYMAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

  // age parsing
  const RANGE = /(?:de\s*)?(\d{1,2})\s*(?:a|-|–|y|hasta)\s*(\d{1,2})\s*an?os/i;
  const FROM = /a\s*partir\s*de\s*(?:los\s*)?(\d{1,2})\s*an?os/i;
  const FROM2 = /(?:mayores|desde)\s*(?:de\s*)?(\d{1,2})\s*an?os/i;
  const UPTO = /(?:hasta|menores\s*de)\s*(\d{1,2})\s*an?os/i;
  const EXACT = /\b(\d{1,2})\s*an?os\b/i;
  const MONTHS = /(\d{1,2})\s*mes/i;

  function parseAgeRange(text) {
    const t = norm(text);
    if (!t) return null;
    let m = t.match(RANGE);
    if (m) { const a = +m[1], b = +m[2]; return [Math.min(a, b), Math.max(a, b)]; }
    m = t.match(FROM) || t.match(FROM2);
    if (m) return [+m[1], null];
    m = t.match(UPTO);
    if (m) return [0, +m[1]];
    if (MONTHS.test(t)) return [0, 3];
    m = t.match(EXACT);
    if (m) { const a = +m[1]; if (a <= 17) return [a, a]; }
    return null;
  }
  function ageMatches(rng, age) {
    if (!rng) return null;
    const lo = rng[0], hi = rng[1];
    if (lo != null && age < lo) return false;
    if (hi != null && age > hi) return false;
    return true;
  }
  function audienceIsKid(aud) { const a = norm(aud); return a.indexOf("nino") >= 0 || a.indexOf("familia") >= 0; }
  function isKidActivity(cat, aud, title, desc) {
    if (cat === "CuentacuentosTiteresMarionetas") return true;
    if (audienceIsKid(aud)) return true;
    const blob = norm(title + " " + (desc || ""));
    const strong = STRONG_KW.some((k) => blob.indexOf(k) >= 0);
    return !!(KID_CATEGORIES[cat] && strong);
  }
  function relevance(cat, aud, title, desc, ageKnown, ageMatch, standing) {
    let s = CAT_WEIGHT[cat] || 10;
    if (audienceIsKid(aud)) s += 20;
    const blob = norm(title + " " + (desc || ""));
    if (["titere", "marioneta", "cuentacuento", "cuenta cuento"].some((k) => blob.indexOf(k) >= 0)) s += 25;
    if (ageKnown && ageMatch === true) s += 15;
    if (standing) s -= 50;
    return s;
  }

  // dates
  function parseDate(s) {
    if (!s) return null;
    s = String(s).trim().split(".")[0];
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function weekWindows(n) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const wd = (today.getDay() + 6) % 7; // Mon=0
    const monday = new Date(today); monday.setDate(today.getDate() - wd);
    const out = [];
    for (let i = 0; i < Math.max(1, n); i++) {
      const start = new Date(monday); start.setDate(monday.getDate() + i * 7);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const label = i === 0 ? "Esta semana" : i === 1 ? "Proxima semana" : "En " + i + " semanas";
      out.push([label, start, end]);
    }
    return out;
  }
  function parseExcluded(s) {
    const out = {};
    if (!s) return out;
    String(s).split(/[;,]/).forEach((tok) => { const d = parseDate(tok); if (d) out[iso(d)] = 1; });
    return out;
  }
  function occursIn(evStart, evEnd, winStart, winEnd, recurrence, excluded) {
    if (!evStart) return [];
    evEnd = evEnd || evStart;
    const lo = new Date(Math.max(evStart.getTime(), winStart.getTime()));
    const hi = new Date(Math.min(evEnd.getTime(), winEnd.getTime()));
    if (lo > hi) return [];
    let allowed = null;
    if (recurrence && typeof recurrence === "object") {
      const days = recurrence.days || "";
      if (days) { allowed = {}; days.split(",").forEach((d) => { if (d in DAYMAP) allowed[DAYMAP[d]] = 1; }); }
    }
    const hits = [];
    const d = new Date(lo);
    while (d <= hi) {
      const key = iso(d);
      if ((!allowed || allowed[d.getDay()]) && !excluded[key]) hits.push(key);
      d.setDate(d.getDate() + 1);
    }
    return hits;
  }
  function tail(uri) { return (uri || "").replace(/\/+$/, "").split("/").pop(); }
  function latlon(ev) {
    const loc = ev.location || {};
    const la = parseFloat(loc.latitude), lo = parseFloat(loc.longitude);
    return isFinite(la) && isFinite(lo) ? [la, lo] : [null, null];
  }
  function district(ev) {
    const addr = ev.address || {}, dist = addr.district || {};
    const id = (dist && dist["@id"]) || "";
    return id ? tail(id).replace(".json", "") : "";
  }
  function street(ev) {
    const addr = ev.address || {}, area = addr.area || {};
    if (area && typeof area === "object") {
      return [area["street-address"], area["postal-code"], area.locality].filter(Boolean).join(", ");
    }
    return "";
  }

  // ── main search (ported from scrape.py run()) ────────────────────────────
  async function runSearch(job, emit) {
    const age = asInt(job.age, 3, 0, 17);
    const weeks = asInt(job.weeks, 3, 1, 12);
    const wantCats = new Set(job.categories || []);
    const freeOnly = !!job.free_only;
    const strictAge = !!job.strict_age;
    const query = norm(job.query || "");

    const graph = await fetchFeed(emit);
    const wins = weekWindows(weeks);
    const winLo = wins[0][1], winHi = wins[wins.length - 1][2];
    emit("progress", { phase: "filter", msg: "Filtrando " + graph.length + " eventos para " + age + " años…" });

    const out = [];
    for (const ev of graph) {
      const cat = tail(ev["@type"]);
      const title = ev.title || "";
      const desc = ev.description || "";
      const aud = ev.audience || "";
      if (!isKidActivity(cat, aud, title, desc)) continue;
      if (wantCats.size && !wantCats.has(cat)) continue;
      const freeVal = String(ev.free);
      const isFree = freeVal === "1" || freeVal === "true" || freeVal === "True";
      if (freeOnly && !isFree) continue;
      if (query && norm(title + " " + desc).indexOf(query) < 0) continue;

      const rng = parseAgeRange(title + " " + desc);
      const match = ageMatches(rng, age);
      if (match === false) continue;
      if (strictAge && rng === null) continue;

      const evStart = parseDate(ev.dtstart), evEnd = parseDate(ev.dtend);
      const excluded = parseExcluded(ev["excluded-days"]);
      const dates = occursIn(evStart, evEnd, winLo, winHi, ev.recurrence, excluded);
      if (!dates.length) continue;

      const spanDays = evStart ? Math.round(((evEnd || evStart) - evStart) / 86400000) : 0;
      let recDays = "";
      if (ev.recurrence && typeof ev.recurrence === "object") recDays = ev.recurrence.days || "";
      const nRec = recDays.split(",").filter(Boolean).length;
      const allWeek = nRec >= 6;
      const standing = spanDays >= 14 || (allWeek && spanDays >= 5) || dates.length >= 7;

      const ll = latlon(ev);
      out.push({
        id: ev.id, title: title.trim(), description: (desc || "").trim().slice(0, 600),
        category: cat, category_label: KID_CATEGORIES[cat] || prettyCat(cat), audience: aud,
        age_range: rng, age_known: rng !== null, age_match: match, standing: standing,
        score: relevance(cat, aud, title, desc, rng !== null, match, standing),
        free: isFree, price: (ev.price || "").trim(), time: (ev.time || "").trim(),
        venue: (ev["event-location"] || "").trim(), district: district(ev), address: street(ev),
        lat: ll[0], lon: ll[1], link: (ev.link || "").trim(), dates: dates,
      });
    }
    out.sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : a.dates[0] > b.dates[0] ? 1 : b.score - a.score || a.title.toLowerCase().localeCompare(b.title.toLowerCase())));
    emit("progress", { phase: "done", msg: out.length + " actividades encontradas" });

    emit("result", {
      generated: new Date().toISOString(),
      age: age, count: out.length,
      weeks: wins.map((w) => ({ label: w[0], start: iso(w[1]), end: iso(w[2]) })),
      activities: out,
    });
  }

  window.MadridEngine = { runSearch: runSearch };
})();
