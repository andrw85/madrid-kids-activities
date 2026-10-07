#!/usr/bin/env node
/*
 * server.js — local backend for the Madrid kids-activities finder.
 *
 * Serves index.html and exposes:
 *   GET  /            -> the page
 *   POST /api/search  -> runs scrape.py, streams newline-delimited JSON
 *                        ({type:"progress"|"log"} ... then {type:"result"}).
 *
 * The scraping/filtering is done by Python (scrape.py) which pulls the
 * Ayuntamiento de Madrid open-data agenda feed and filters by age/week/
 * category. Node only orchestrates + serves.
 *
 * Run from WSL:
 *   cd /mnt/c/Users/enddooa/madrid-kids && node server.js
 * Then open http://localhost:8788/
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const HERE = __dirname;
const PORT = process.env.PORT || 8788;

// Prefer a venv python if present, else fall back to python3 on PATH.
function findPython() {
  const cands = [
    path.join(HERE, ".venv", "bin", "python"),
    path.join(HERE, ".venv", "Scripts", "python.exe"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return process.env.PYTHON || "python3";
}
const PY = findPython();
const SCRIPT = path.join(HERE, "scrape.py");

function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function serveFile(res, file, type) {
  fs.readFile(path.join(HERE, file), (err, data) => {
    if (err) return send(res, 404, "text/plain", "not found");
    send(res, 200, type, data);
  });
}

function runSearch(job, res) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
  });

  const jobDir = path.join(HERE, "tmp");
  try { fs.mkdirSync(jobDir, { recursive: true }); } catch (e) {}
  const jobFile = path.join(
    jobDir, `job_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job), "utf-8");

  const child = spawn(PY, [SCRIPT, "@" + jobFile], { cwd: HERE });
  child.on("close", () => { try { fs.unlinkSync(jobFile); } catch (e) {} });

  let stdout = "";
  let stderrBuf = "";

  child.stdout.on("data", (d) => (stdout += d.toString()));

  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
    let idx;
    while ((idx = stderrBuf.indexOf("\n")) >= 0) {
      const line = stderrBuf.slice(0, idx).trim();
      stderrBuf = stderrBuf.slice(idx + 1);
      if (line.startsWith("PROGRESS ")) {
        try {
          res.write(JSON.stringify({ type: "progress",
            data: JSON.parse(line.slice(9)) }) + "\n");
        } catch (e) {}
      } else if (line) {
        res.write(JSON.stringify({ type: "log", data: line }) + "\n");
      }
    }
  });

  child.on("close", (code) => {
    if (code === 0 && stdout.trim()) {
      try {
        res.write(JSON.stringify({ type: "result",
          data: JSON.parse(stdout) }) + "\n");
      } catch (e) {
        res.write(JSON.stringify({ type: "error",
          data: "bad JSON from python: " + e.message }) + "\n");
      }
    } else {
      res.write(JSON.stringify({ type: "error",
        data: "python exited " + code }) + "\n");
    }
    res.end();
  });

  child.on("error", (e) => {
    res.write(JSON.stringify({ type: "error", data: String(e) }) + "\n");
    res.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index")) {
    return serveFile(res, "index.html", "text/html; charset=utf-8");
  }
  if (req.method === "GET" && req.url === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "max-age=86400" });
    return res.end();
  }
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, "application/json", JSON.stringify({ ok: true }));
  }
  if (req.method === "GET" && req.url === "/manifest.webmanifest") {
    return serveFile(res, "manifest.webmanifest", "application/manifest+json; charset=utf-8");
  }
  if (req.method === "GET" && req.url === "/sw.js") {
    return serveFile(res, "sw.js", "application/javascript; charset=utf-8");
  }
  if (req.method === "POST" && req.url === "/api/search") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let job;
      try { job = JSON.parse(body || "{}"); }
      catch (e) { return send(res, 400, "text/plain", "bad json"); }
      runSearch(job, res);
    });
    return;
  }
  send(res, 404, "text/plain", "not found");
});

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Madrid kids activities on http://localhost:${PORT}/`);
  console.log(`on your phone (same Wi-Fi): http://<this-PC-IP>:${PORT}/`);
  console.log(`python: ${PY}`);
});
