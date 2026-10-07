/*
 * api-shim.js — makes the untouched Madrid UI run fully on-device.
 *
 * index.html does: POST /api/search -> newline-delimited JSON stream of
 *   {type:"progress", data:{phase,msg}} ... then {type:"result", data:{...}}.
 * There is no server in the packaged app, so we monkey-patch window.fetch to
 * detect that URL and satisfy it from window.MadridEngine, reproducing the
 * streaming ndjson Response the UI reader expects. All other fetches (the
 * agenda feed, map tiles, Leaflet CDN) pass through to native fetch.
 */
(function () {
  const nativeFetch = window.fetch.bind(window);
  const enc = new TextEncoder();

  function ndjsonStreamResponse(runner) {
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const push = (obj) => {
          if (closed) return;
          try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch (e) {}
        };
        // engine emits ("progress"|"result", data); UI expects {type, data}
        const emit = (type, data) => push({ type: type, data: data });
        const done = (err) => {
          if (closed) return;
          if (err) push({ type: "error", data: String((err && err.message) || err) });
          closed = true;
          try { controller.close(); } catch (e) {}
        };
        Promise.resolve()
          .then(() => runner(emit))
          .then(() => done())
          .catch((e) => done(e));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method === "POST" && url.indexOf("/api/search") !== -1) {
      let job = {};
      try {
        const body = init && init.body;
        job = JSON.parse(typeof body === "string" ? body : "{}");
      } catch (e) { job = {}; }
      return Promise.resolve(
        ndjsonStreamResponse((emit) => window.MadridEngine.runSearch(job, emit))
      );
    }
    return nativeFetch(input, init);
  };
})();
