// Runs inside the WebUntis page itself ("world": "MAIN" in manifest.json), because
// only there it can see the page's own requests. Passes every timetable WebUntis
// loads on to content.js, so the extension doesn't have to fetch it a second time.
// WebUntis uses XMLHttpRequest, not fetch (tested).

// Inside a function, so our variables don't end up in the page's global scope
(() => {
  const open = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    // only ".../timetable/entries", not ".../timetable/entries/settings"
    if (new URL(url, location.href).pathname.endsWith("/timetable/entries")) {
      this.addEventListener("load", () => {
        if (this.status !== 200) return;
        try {
          const body =
            this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          if (!Array.isArray(body?.days)) return;
          window.postMessage(
            { source: "until-webuntis", url: String(url), days: body.days },
            location.origin,
          );
        } catch {
          // not JSON (e.g. the login page), ignore
        }
      });
    }
    return open.call(this, method, url, ...rest);
  };
})();
