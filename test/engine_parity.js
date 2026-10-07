// Verify engine.js (on-device port) matches scrape.py output.
const fs = require("fs");
const path = require("path");
const ROOT = "/mnt/c/Users/enddooa/madrid-kids";

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {} };
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, "cache", "agenda.json"), "utf8"));
global.fetch = async () => ({ json: async () => feed });

require(path.join(ROOT, "app", "engine.js"));

(async () => {
  const jobs = [
    { age: 3, weeks: 3, categories: [], free_only: false, strict_age: false, query: "" },
    { age: 3, weeks: 3, categories: ["CuentacuentosTiteresMarionetas"] },
    { age: 3, weeks: 2, free_only: true },
    { age: 3, weeks: 3, strict_age: true },
    { age: 8, weeks: 3 },
    { age: 0, weeks: 4 },
    { age: 3, weeks: 1, categories: ["ClubesLectura"], free_only: true, strict_age: true, query: "zzzznotfound" },
  ];
  for (const job of jobs) {
    let result = null;
    await window.MadridEngine.runSearch(job, (type, data) => { if (type === "result") result = data; });
    const dated = result.activities.filter((a) => !a.standing).length;
    const standing = result.activities.filter((a) => a.standing).length;
    console.log(
      "age=" + job.age + " w=" + job.weeks + " cats=" + ((job.categories || []).length) +
      " free=" + (!!job.free_only) + " strict=" + (!!job.strict_age) + " q=\"" + (job.query || "") + "\"" +
      " -> total=" + result.count + " dated=" + dated + " standing=" + standing
    );
  }
})();
