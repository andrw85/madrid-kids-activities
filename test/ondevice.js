const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = "/mnt/c/Users/enddooa/madrid-kids";
const WWW = path.join(ROOT, "cap", "www");
const PORT = 8821;

const types = { ".html": "text/html", ".js": "application/javascript", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((req, res) => {
  let u = req.url.split("?")[0];
  if (u === "/") u = "/index.html";
  const f = path.join(WWW, u);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "Content-Type": types[path.extname(f)] || "text/plain" });
    res.end(d);
  });
});

(async () => {
  await new Promise((r) => srv.listen(PORT, r));
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://localhost:" + PORT + "/", { waitUntil: "networkidle2", timeout: 30000 });
  await p.click("#go");
  await p.waitForSelector(".dayhdr, .empty", { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 500));
  const cards = (await p.$$(".card")).length;
  const count = await p.$eval("#count", (el) => el.textContent).catch(() => "");
  console.log("ON-DEVICE (no API server) search -> cards:", cards, "| count:", count);
  console.log("page errors:", errs.length ? errs.slice(0, 3).join(" || ") : "none");
  await p.screenshot({ path: path.join(ROOT, "test", "shots", "11-ondevice.png") });
  await b.close(); srv.close();
})();
