// Runs in the page itself to pass every timetable WebUntis loads (via XMLHttpRequest) on to content.js

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
