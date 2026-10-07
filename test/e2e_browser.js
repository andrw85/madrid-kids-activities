const puppeteer = require("puppeteer-core");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = "/usr/bin/google-chrome";
const ROOT = "/mnt/c/Users/enddooa/madrid-kids";
const PORT = 8802;
const SHOT = path.join(ROOT, "test", "shots");
fs.mkdirSync(SHOT, { recursive: true });

function log(...a){ console.log(...a); }
const results = [];
function assert(name, cond, extra=""){
  results.push({name, ok: !!cond, extra});
  log(`${cond ? "PASS" : "FAIL"}  ${name}${extra?"  — "+extra:""}`);
}

(async () => {
  const srv = spawn("node", ["server.js"], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
  });
  await new Promise(r => setTimeout(r, 1200));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    // Grant + set a fake location (Puerta del Sol, Madrid) for near-me testing
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(`http://localhost:${PORT}`, ["geolocation"]);
    await page.setGeolocation({ latitude: 40.4168, longitude: -3.7038 });
    const errors = [];
    page.on("console", m => { if (m.type()==="error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push("PAGEERROR: "+e.message));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle2", timeout: 20000 });

    assert("title present", (await page.title()).includes("Madrid"));
    assert("category chips rendered", (await page.$$(".cat")).length >= 10);
    assert("age input default 3", (await page.$eval("#age", el=>el.value)) === "3");
    // Leaflet should NOT be loaded on initial page load (lazy-loaded with the map)
    assert("Leaflet lazy (absent on load)", (await page.evaluate(()=>typeof window.L==="undefined")));

    // ── Accessibility ──
    assert("html lang=es", (await page.$eval("html", el=>el.lang)) === "es");
    assert("category chips are buttons", await page.$eval("#cats .cat", el=>el.tagName)==="BUTTON");
    assert("control chips are buttons", await page.$eval("#ctrl .chip", el=>el.tagName)==="BUTTON");
    // Keyboard-toggle a category chip via Space
    const catState = await page.evaluate(()=>{
      const c=document.querySelector("#cats .cat");
      c.focus();
      const before=c.getAttribute("aria-pressed");
      c.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true}));
      c.click(); // buttons also fire click on Space/Enter in real browsers
      return {before, after:c.getAttribute("aria-pressed"), focused:document.activeElement===c};
    });
    assert("category chip keyboard-focusable", catState.focused);
    assert("category chip toggles aria-pressed", catState.before==="false" && catState.after==="true", JSON.stringify(catState));
    // reset that chip
    await page.evaluate(()=>{ const c=document.querySelector("#cats .cat.on"); if(c) c.click(); });

    // ── Dark mode ──
    assert("theme toggle button present", (await page.$("#themeBtn")) !== null);
    // auto -> light -> dark via clicks
    await page.click("#themeBtn");
    const t1 = await page.$eval("html", el=>el.getAttribute("data-theme"));
    await page.click("#themeBtn");
    const t2 = await page.$eval("html", el=>el.getAttribute("data-theme"));
    assert("theme cycles to light then dark", t1==="light" && t2==="dark", `${t1}->${t2}`);
    const darkBg = await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
    assert("dark theme darkens background", /rgb\((\d+),/.test(darkBg) && parseInt(darkBg.match(/\d+/)[0],10) < 60, darkBg);
    const storedTheme = await page.evaluate(()=>localStorage.getItem("mk_theme"));
    assert("theme persisted", storedTheme==="dark", String(storedTheme));
    // back to auto to not affect later screenshots
    await page.click("#themeBtn");
    await new Promise(r=>setTimeout(r,100));

    // ── Install prompt banner (simulate beforeinstallprompt) ──
    const installFlow = await page.evaluate(async ()=>{
      localStorage.removeItem("mk_installDismissed");
      // craft a fake beforeinstallprompt event with prompt()/userChoice
      const ev = new Event("beforeinstallprompt");
      let prompted=false;
      ev.preventDefault=()=>{};
      ev.prompt=()=>{ prompted=true; };
      ev.userChoice=Promise.resolve({outcome:"accepted"});
      window.dispatchEvent(ev);
      await new Promise(r=>setTimeout(r,50));
      const shown = !document.getElementById("installBanner").classList.contains("hidden");
      document.getElementById("installBtn").click();
      await new Promise(r=>setTimeout(r,50));
      const hiddenAfterInstall = document.getElementById("installBanner").classList.contains("hidden");
      return {shown, prompted, hiddenAfterInstall};
    });
    assert("install banner shows on beforeinstallprompt", installFlow.shown);
    assert("install button triggers prompt()", installFlow.prompted);
    assert("banner hides after install choice", installFlow.hiddenAfterInstall);

    // ── PWA checks ──
    const manifest = await page.evaluate(async ()=>{
      const r = await fetch("/manifest.webmanifest");
      if(!r.ok) return {ok:false};
      try { const j = await r.json(); return {ok:true, name:j.name, icons:(j.icons||[]).length, display:j.display}; }
      catch(e){ return {ok:false}; }
    });
    assert("manifest served & valid JSON", manifest.ok && manifest.icons>=1, JSON.stringify(manifest));
    assert("manifest standalone display", manifest.display === "standalone");
    const swResp = await page.evaluate(async ()=>{ const r=await fetch("/sw.js"); return {status:r.status, ct:r.headers.get("content-type")}; });
    assert("sw.js served", swResp.status===200 && /javascript/.test(swResp.ct||""), JSON.stringify(swResp));
    const swReg = await page.evaluate(async ()=>{
      if(!("serviceWorker" in navigator)) return false;
      try { const reg = await navigator.serviceWorker.ready; return !!reg; } catch(e){ return false; }
    });
    assert("service worker registers", swReg);

    await page.screenshot({ path: path.join(SHOT, "01-mobile-form.png"), fullPage: false });

    await page.click("#go");
    await page.waitForSelector(".dayhdr, .empty", { timeout: 25000 });
    await new Promise(r=>setTimeout(r,400));

    const dayCount = (await page.$$(".dayhdr")).length;
    const cardCount = (await page.$$(".card")).length;
    assert("search produced day headers", dayCount > 0, `${dayCount} days`);
    assert("search produced cards", cardCount > 0, `${cardCount} cards`);
    assert("count label shown", (await page.$eval("#count", el=>el.textContent)).length > 0,
      await page.$eval("#count", el=>el.textContent));

    const firstDay = await page.$eval(".dayhdr", el=>el.textContent.trim());
    assert("first day label non-empty", firstDay.length>0, firstDay);

    const btns = await page.$$eval(".card .cardbtns a", els=>els.slice(0,3).map(e=>e.textContent.trim()));
    assert("card has Cómo llegar btn", btns.some(b=>/llegar/i.test(b)), btns.join(" | "));
    assert("card has Calendario btn", btns.some(b=>/calendario/i.test(b)));

    const calHref = await page.$$eval(".card .cardbtns a", els=>{
      const a=els.find(x=>/calendario/i.test(x.textContent)); return a?a.href:""; });
    assert("calendar link valid", calHref.includes("calendar.google.com") && calHref.includes("dates="), calHref.slice(0,60));
    const dirHref = await page.$$eval(".card .cardbtns a", els=>{
      const a=els.find(x=>/llegar/i.test(x.textContent)); return a?a.href:""; });
    assert("directions link valid", dirHref.includes("google.com/maps/dir"), dirHref.slice(0,50));

    await page.screenshot({ path: path.join(SHOT, "02-mobile-results.png"), fullPage: false });

    await page.click(".card .fav");
    await new Promise(r=>setTimeout(r,150));
    const favN = await page.$eval("#favN", el=>el.textContent);
    assert("favorite increments counter", favN === "1", `favN=${favN}`);
    const ls = await page.evaluate(()=>localStorage.getItem("mk_favs"));
    assert("favorite persisted to localStorage", ls && JSON.parse(ls).length===1, ls);

    // Share button present; clipboard fallback works (no navigator.share in headless)
    const shareBtns = (await page.$$(".card .share")).length;
    assert("share button on cards", shareBtns > 0, `${shareBtns} share btns`);
    const clipText = await page.evaluate(async ()=>{
      // stub navigator.share away to force clipboard path, capture clipboard write
      let captured="";
      const origWrite = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
      if(navigator.clipboard){ navigator.clipboard.writeText = (t)=>{ captured=t; return Promise.resolve(); }; }
      delete navigator.share;
      document.querySelector(".card .share").click();
      await new Promise(r=>setTimeout(r,100));
      if(origWrite) navigator.clipboard.writeText = origWrite;
      return captured;
    });
    assert("share copies text to clipboard (fallback)", clipText.length > 0, clipText.slice(0,40));

    await page.click("#favChip");
    await new Promise(r=>setTimeout(r,250));
    const cardsAfterFav = (await page.$$(".card")).length;
    assert("fav filter narrows to 1", cardsAfterFav === 1, `${cardsAfterFav} cards`);
    await page.click("#favChip");
    await new Promise(r=>setTimeout(r,250));

    const distOpts = (await page.$$("#district option")).length;
    assert("district filter populated", distOpts > 3, `${distOpts} options`);

    // Weekend quick-filter: only Sat/Sun days remain
    await page.click("#weekendChip");
    await new Promise(r=>setTimeout(r,250));
    const weekendDays = await page.$$eval(".dayhdr", els=>els.map(e=>e.textContent));
    // After weekend filter, every day card's dates should be Sat/Sun. Verify via the first .when chip set.
    const allWeekend = await page.evaluate(()=>{
      const whens=[...document.querySelectorAll(".card .when")].map(w=>w.textContent.trim());
      // Spanish short day prefixes for Sat/Sun are "sáb"/"dom"
      return whens.length>0 && whens.every(t=> t.startsWith("sáb")||t.startsWith("dom")|| t==="…");
    });
    assert("weekend filter shows only Sat/Sun", allWeekend, `days=${weekendDays.length}`);
    await page.click("#weekendChip"); // off
    await new Promise(r=>setTimeout(r,250));

    await page.click("#mapChip");
    await page.waitForSelector("#map .leaflet-marker-icon", { timeout: 8000 }).catch(()=>{});
    const pins = (await page.$$("#map .leaflet-marker-icon")).length;
    assert("map shows markers", pins > 0, `${pins} pins`);
    assert("Leaflet loaded after opening map", (await page.evaluate(()=>typeof window.L!=="undefined")));
    const floatHidden = await page.$eval("#mapToggle", el=>getComputedStyle(el).display);
    assert("floating map btn hidden while map open", floatHidden === "none", floatHidden);
    await new Promise(r=>setTimeout(r,500));
    await page.screenshot({ path: path.join(SHOT, "03-mobile-map.png"), fullPage: false });
    // close map again
    await page.click("#mapChip");
    await new Promise(r=>setTimeout(r,300));

    // Near-me: click, wait for distance sort to apply
    await page.click("#nearChip");
    await page.waitForFunction(()=>document.querySelector(".distbadge")!==null, { timeout: 8000 }).catch(()=>{});
    const badges = (await page.$$(".distbadge")).length;
    assert("distance badges rendered after near-me", badges > 0, `${badges} badges`);
    const nearOn = await page.$eval("#nearChip", el=>el.classList.contains("on"));
    assert("near-me chip active", nearOn);
    // Verify nearest-first ordering: parse first few distances
    const dists = await page.$$eval(".distbadge", els=>els.slice(0,8).map(e=>{
      const t=e.textContent.replace("📍","").trim();
      return t.endsWith("km") ? parseFloat(t)*1000 : parseFloat(t);
    }));
    const sortedOK = dists.every((v,i)=> i===0 || v>=dists[i-1]-1);
    assert("activities sorted nearest-first", sortedOK, dists.slice(0,5).join(", "));
    await page.screenshot({ path: path.join(SHOT, "05-mobile-nearme.png"), fullPage: false });
    // toggle near-me off -> back to day grouping
    await page.click("#nearChip");
    await page.waitForSelector(".dayhdr", { timeout: 5000 });
    assert("near-me off restores day grouping", (await page.$$(".dayhdr")).length > 0);

    const overflow = await page.evaluate(()=> document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert("no horizontal overflow on mobile", overflow <= 2, `overflow=${overflow}px`);

    assert("no JS runtime errors", errors.length === 0, errors.slice(0,3).join(" || "));

    // Reload with the service worker now active, confirm live search still works.
    await page.reload({ waitUntil: "networkidle2", timeout: 20000 });
    await page.click("#go");
    await page.waitForSelector(".dayhdr, .empty", { timeout: 25000 });
    const cards2 = (await page.$$(".card")).length;
    assert("search works with SW active (after reload)", cards2 > 0, `${cards2} cards`);

    // ── Persistence: set a distinctive search, reload, expect it restored + auto-run ──
    await page.evaluate(()=>{ document.getElementById("age").value="5"; });
    await page.select("#weeks","1");
    await page.type("#query","teatro");
    await page.click("#go");
    await page.waitForSelector(".dayhdr, .empty", { timeout: 25000 });
    await new Promise(r=>setTimeout(r,200));
    await page.reload({ waitUntil: "networkidle2", timeout: 20000 });
    // auto-run should produce results without clicking
    await page.waitForSelector(".dayhdr, .empty", { timeout: 25000 });
    const restored = await page.evaluate(()=>({
      age: document.getElementById("age").value,
      weeks: document.getElementById("weeks").value,
      query: document.getElementById("query").value,
    }));
    assert("last search restored on reload", restored.age==="5" && restored.weeks==="1" && restored.query==="teatro", JSON.stringify(restored));
    assert("auto-run rendered results after reload", (await page.$$(".card")).length > 0);

    // ── Clear filters: resets form + chips + localStorage ──
    await page.evaluate(()=>{ document.getElementById("age").value="8"; });
    await page.evaluate(()=>{ document.querySelector("#cats .cat").click(); }); // select a category
    await page.click("#clearBtn");
    await page.waitForSelector(".dayhdr, .empty", { timeout: 25000 });
    const cleared = await page.evaluate(()=>({
      age: document.getElementById("age").value,
      weeks: document.getElementById("weeks").value,
      query: document.getElementById("query").value,
      catsOn: document.querySelectorAll("#cats .cat.on").length,
      lastSearch: localStorage.getItem("mk_lastSearch"),
    }));
    assert("clear resets age/weeks/query", cleared.age==="3" && cleared.weeks==="3" && cleared.query==="", JSON.stringify(cleared));
    assert("clear resets category chips", cleared.catsOn===0, `catsOn=${cleared.catsOn}`);

    await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
    await new Promise(r=>setTimeout(r,400));
    await page.screenshot({ path: path.join(SHOT, "04-desktop-results.png"), fullPage: false });

  } finally {
    await browser.close();
    srv.kill("SIGTERM");
  }

  const failed = results.filter(r=>!r.ok);
  log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
