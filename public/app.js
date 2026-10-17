"use strict";
// brandrune.com: copy buttons, the email signup, the .com checker, and the
// replay of a recorded run. No dependencies, no usage tracking.
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function chip(kind, text) { return el("span", "chip " + kind, text); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // --- copy buttons ---------------------------------------------------------

  document.querySelectorAll("button.copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { btn.textContent = "Select and copy"; });
      } else { btn.textContent = "Select and copy"; }
    });
  });

  // --- email signup (double opt-in; the server sends the confirmation) ------

  (function () {
    var form = document.getElementById("signup");
    if (!form) return;
    var status = document.getElementById("signup-status");
    var email = document.getElementById("email");
    var button = form.querySelector("button[type=submit]");
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    function show(kind, text) { status.className = "status " + kind; status.textContent = text; }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var value = email.value.trim();
      if (!EMAIL_RE.test(value)) { show("err", "That does not look like an email address."); email.focus(); return; }
      button.disabled = true;
      show("", "Sending...");
      fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ email: value, website: document.getElementById("website").value })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
      }).then(function (r) {
        if (r.res.ok && r.body.ok) {
          form.classList.add("done");
          show("ok", "Check your inbox at " + value + ". Click the link in the email from Brandrune to confirm.");
        } else {
          button.disabled = false;
          show("err", r.body.error || "Something went wrong. Try again in a minute.");
        }
      }).catch(function () {
        button.disabled = false;
        show("err", "Could not reach the server. Try again in a minute.");
      });
    });
  })();

  // --- the .com checker -------------------------------------------------------
  //
  // The same rules as the skill's script (brandrune.py 0.3.0), for one
  // extension and no price check: a 404 only counts when it is a real RDAP
  // reply, redirects are not answers, and "no record" is only trusted after
  // the registry reports a known name as registered. normalize() and
  // classifyRecord() are pure and exposed on window.BrandruneCheck for tests.

  var NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  // Kept in step with PARKING_NS and PENDING in brandrune.py.
  var PARKING_NS = ["sedoparking.com", "parkingcrew.net", "bodis.com", "above.com", "afternic.com", "dan.com",
    "undeveloped.com", "hugedomains.com", "namebrightdns.com", "domainmarket.com", "uniregistrymarket.link",
    "parklogic.com", "dnsnameservice.com", "smartname.com", "brandbucket.com", "squadhelp.com", "atom.com"];
  var PENDING = ["pending delete", "pendingdelete", "redemption period", "redemptionperiod", "pending restore", "pendingrestore"];

  function normalize(raw) {
    var s = String(raw).trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
    s = s.split(/[/?#]/)[0].replace(/\.+$/, "");
    if (s.slice(-4) === ".com") s = s.slice(0, -4);
    if (!s) return { error: "Type a name first." };
    if (s.indexOf(".") !== -1) return { error: "This page checks .com only. Type the name without an extension. The skill checks the others." };
    if (/[^\x00-\x7f]/.test(s)) return { error: "Letters, digits and hyphens only here. For a name with accents, use the skill." };
    if (!NAME_RE.test(s)) return { error: "A .com name is letters, digits and hyphens, 1 to 63 characters, with no hyphen at either end." };
    if (s.slice(2, 4) === "--") return { error: "Names with -- in the third and fourth places are reserved for encoded names. Use the skill for those." };
    return { name: s };
  }

  // A 200 body to a status. Anything that is not the shape RDAP promises
  // (status and nameservers are arrays) is unknown, never a guess.
  function classifyRecord(doc, domain) {
    if (!doc || typeof doc !== "object") return { status: "unknown", why: "The reply was not a JSON object." };
    var ldh = String(doc.ldhName || "").toLowerCase().replace(/\.$/, "");
    if (doc.objectClassName !== "domain" || ldh !== domain) return { status: "unknown", why: "The reply was not this domain's record." };
    var rawStatus = doc.status === undefined ? [] : doc.status;
    var rawNs = doc.nameservers === undefined ? [] : doc.nameservers;
    var rawEvents = doc.events === undefined ? [] : doc.events;
    if (!Array.isArray(rawStatus) || !Array.isArray(rawNs) || !Array.isArray(rawEvents)) return { status: "unknown", why: "The reply did not have the shape of an RDAP record." };
    var statuses = rawStatus.map(function (x) { return String(x).toLowerCase(); });
    var ns = rawNs.map(function (n) { return String((n && n.ldhName) || "").toLowerCase().replace(/\.$/, ""); });
    var exp = rawEvents.filter(function (e) { return e && e.eventAction === "expiration"; })[0];
    var out = { expires: exp ? String(exp.eventDate || "").slice(0, 10) : "", nameservers: ns.slice(0, 2) };
    if (statuses.some(function (x) { return PENDING.indexOf(x) !== -1; })) { out.status = "expiring"; return out; }
    var parker = null;
    ns.forEach(function (n) { PARKING_NS.forEach(function (p) { if (!parker && (n === p || n.slice(-p.length - 1) === "." + p)) parker = p; }); });
    if (parker) { out.status = "parked"; out.parker = parker; return out; }
    out.status = "taken";
    return out;
  }

  if (typeof window !== "undefined") window.BrandruneCheck = { normalize: normalize, classifyRecord: classifyRecord };

  (function () {
    var form = document.getElementById("checker");
    if (!form) return;
    var input = document.getElementById("check-name");
    var out = document.getElementById("check-result");
    var button = form.querySelector("button[type=submit]");
    var RDAP = "https://rdap.verisign.com/com/v1/domain/";

    function ask(domain) {
      var started = new Date();
      var opts = { headers: { "Accept": "application/rdap+json, application/json" }, redirect: "manual", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" };
      function once() {
        var ctrl = window.AbortController ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
        if (ctrl) opts.signal = ctrl.signal;
        return fetch(RDAP + domain, opts).finally(function () { if (timer) clearTimeout(timer); });
      }
      function read(res) {
        var answer = { url: RDAP + domain, http: res.status, at: started };
        if (res.type === "opaqueredirect") return Object.assign(answer, { status: "unknown", why: "Verisign sent a redirect, which is not an answer." });
        var ctype = (res.headers.get("Content-Type") || "").toLowerCase();
        if (res.status === 404) {
          if (ctype.indexOf("application/rdap+json") === -1) return Object.assign(answer, { status: "unknown", why: "The 404 was not an RDAP reply, so it is not an answer." });
          return Object.assign(answer, { status: "norecord" });
        }
        if (res.status !== 200) return Object.assign(answer, { status: "unknown", why: "Verisign answered HTTP " + res.status + "." });
        return res.json().then(function (doc) {
          return Object.assign(answer, classifyRecord(doc, domain));
        }, function () { return Object.assign(answer, { status: "unknown", why: "The reply could not be read." }); });
      }
      return once().then(function (res) {
        if (res.status === 429 || res.status >= 500) return wait(1500).then(once);
        return res;
      }).then(read, function () {
        return { url: RDAP + domain, at: started, status: "unknown", why: "Verisign did not answer from your browser (a timeout, a blocker, or no network)." };
      }).catch(function () {
        // Anything unexpected is an unknown, never a hang.
        return { url: RDAP + domain, at: started, status: "unknown", why: "The reply could not be read." };
      });
    }

    var sanity = null;
    function registrySane() {
      if (!sanity) {
        sanity = ask("nic.com").then(function (a) {
          if (a.status === "taken" || a.status === "parked" || a.status === "expiring") return true;
          return ask("google.com").then(function (b) { return b.status === "taken" || b.status === "parked" || b.status === "expiring"; });
        });
        // Only a passed check is remembered; a failure or an error asks again next time.
        sanity.then(function (ok) { if (!ok) sanity = null; }, function () { sanity = null; });
      }
      return sanity;
    }

    function render(domain, a) {
      out.textContent = "";
      var head = el("p", "cr-head");
      head.appendChild(el("span", "cr-name", domain));
      var text;
      if (a.status === "open") {
        head.appendChild(chip("openstar", "open*"));
        text = "Verisign has no record of " + domain + ". The price is not verified, so a premium or reserved name is still possible. A registrar's checkout shows the real price.";
      } else if (a.status === "taken") {
        head.appendChild(chip("taken", "taken"));
        text = "Verisign returned a registration" + (a.expires ? ", paid through " + a.expires : "") + ".";
      } else if (a.status === "parked") {
        head.appendChild(chip("parked", "parked"));
        text = "Registered, and its nameservers are at " + a.parker + ", a parking or domain-sale service. Often buyable from a reseller, at a markup.";
      } else if (a.status === "expiring") {
        head.appendChild(chip("expiring", "expiring"));
        text = "Registered, but in redemption or pending delete. It may drop back to open.";
      } else {
        head.appendChild(chip("unknown", "unknown"));
        text = (a.why || "No usable answer.") + " Not counted as open.";
      }
      out.appendChild(head);
      out.appendChild(el("p", "cr-text", text));
      var src = a.http ? a.url.replace("https://", "") + " answered HTTP " + a.http : a.url.replace("https://", "") + ": no answer";
      out.appendChild(el("p", "cr-src", src + " at " + a.at.toLocaleTimeString() + " (your clock)"));
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var n = normalize(input.value);
      if (n.error) { out.textContent = ""; out.appendChild(el("p", "cr-err", n.error)); input.focus(); return; }
      var domain = n.name + ".com";
      var started = new Date();
      button.disabled = true;
      out.textContent = "";
      out.appendChild(el("p", "cr-idle", "Asking rdap.verisign.com about " + domain + "..."));
      ask(domain).then(function (a) {
        if (a.status !== "norecord") return a;
        return registrySane().then(function (ok) {
          if (ok) { a.status = "open"; return a; }
          a.status = "unknown";
          a.why = "Verisign said no record, but it also failed to report nic.com or google.com as registered, so its answer is not trusted.";
          return a;
        });
      }).catch(function () {
        sanity = null;
        return { url: RDAP + domain, at: started, status: "unknown", why: "Something went wrong reading the answer." };
      }).then(function (a) { render(domain, a); }).finally(function () { button.disabled = false; });
    });
  })();

  // --- the replay -------------------------------------------------------------

  (function () {
    var run = document.getElementById("run");
    if (!run || !window.fetch) return;
    var wall = document.getElementById("run-wall");
    var typed = document.getElementById("run-typed");
    var rest = document.getElementById("run-rest");
    var frame = document.getElementById("run-frame");
    var cue = document.getElementById("run-cue");
    // Shown in this order: the agent's note, the command, the script's first
    // stderr line, then everything the script printed when it finished.
    var lines = ["run-l1", "run-l2", "run-l3", "run-done"].map(function (id) { return document.getElementById(id); });
    var answer = document.getElementById("run-answer");
    var replay = document.getElementById("run-replay");
    var count = document.getElementById("run-count");
    var tallyEl = { com: document.getElementById("tally-com"), ai: document.getElementById("tally-ai") };
    var tools = run.querySelectorAll(".rt, #run-style");
    var styleSel = document.getElementById("run-style");
    var prompt = typed.textContent;
    var data = null, tiles = [], playing = false, generation = 0;
    var RANK = { open: 0, openstar: 0, premium: 1, expiring: 2, parked: 3, reserved: 4, taken: 5, unknown: 6 };
    var ORDER = ["open", "open*", "premium", "expiring", "parked", "reserved", "taken", "unknown"];

    function load() {
      if (!data) data = fetch(run.getAttribute("data-src")).then(function (r) { if (!r.ok) throw new Error("run data " + r.status); return r.json(); });
      return data;
    }

    // Always says how many answers are in, so a mid-run frame never reads as final.
    function tallyText(counts, total) {
      var n = 0;
      var parts = ORDER.filter(function (k) { n += counts[k] || 0; return counts[k]; }).map(function (k) { return counts[k] + " " + k; });
      return (parts.length ? parts.join(", ") : "asking") + " (" + n + " of " + total + ")";
    }

    function updateCue() {
      var more = frame.scrollHeight - frame.clientHeight - frame.scrollTop > 24;
      cue.classList.toggle("off", !more);
    }
    frame.addEventListener("scroll", updateCue, { passive: true });

    function makeTile(row, tlds, final) {
      var li = el("li", "tile");
      li.appendChild(el("div", "tn", row[0]));
      li.appendChild(el("div", "tm", row[1] + " · " + row[2]));
      var chips = el("div", "tc");
      var cs = tlds.map(function (t, i) {
        var c = final ? chip(row[3 + i][0], "." + t + " " + row[3 + i][1]) : chip("checking", "." + t + " ...");
        chips.appendChild(c);
        return c;
      });
      li.appendChild(chips);
      if (final && row[3][0].indexOf("open") === 0) li.classList.add("is-open");
      return { li: li, row: row, chips: cs };
    }

    function sortKey(row, tlds) {
      var opens = 0;
      for (var i = 0; i < tlds.length; i++) if (row[3 + i][0] === "open" || row[3 + i][0] === "openstar") opens++;
      return [RANK[row[3][0]], -opens, row[2], row[0]];
    }
    function cmp(a, b) {
      for (var i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
      return 0;
    }

    function sortWall(d) {
      tiles.sort(function (a, b) { return cmp(sortKey(a.row, d.tlds), sortKey(b.row, d.tlds)); });
      tiles.forEach(function (t) { wall.appendChild(t.li); });
    }

    function applyFilters() {
      var open = run.querySelector('[data-filter="open"]').getAttribute("aria-pressed") === "true";
      var short = run.querySelector('[data-filter="short"]').getAttribute("aria-pressed") === "true";
      var style = styleSel.value;
      var shown = 0;
      tiles.forEach(function (t) {
        var ok = (!open || t.row[3][0] === "open" || t.row[3][0] === "openstar") && (!short || t.row[2] <= 8) && (!style || t.row[1] === style);
        t.li.classList.toggle("hidden", !ok);
        if (ok) shown++;
      });
      count.textContent = shown + " of " + tiles.length;
      if (frame) updateCue();
    }

    function setTools(on) { tools.forEach(function (b) { b.disabled = !on; }); }

    function finalState(d) {
      wall.textContent = "";
      tiles = d.rows.map(function (row) { return makeTile(row, d.tlds, true); });
      sortWall(d);
      applyFilters();
      updateCue();
    }

    function play(d) {
      var gen = ++generation;
      playing = true;
      var alive = function () { return gen === generation; };
      run.classList.add("playing");
      replay.hidden = true;
      setTools(false);
      lines.forEach(function (l) { l.classList.add("pending"); });
      answer.classList.add("pending");
      wall.textContent = "";
      frame.scrollTop = 0;
      tiles = [];
      count.textContent = "0 of " + d.rows.length;
      var counts = {}; d.tlds.forEach(function (t) { counts[t] = {}; tallyEl[t].textContent = tallyText(counts[t], d.rows.length); });

      // The whole prompt stays laid out; typing moves characters from the
      // hidden span to the visible one.
      typed.textContent = "";
      rest.textContent = prompt;
      typed.classList.add("t-typing");
      var i = 0;
      return new Promise(function (resolve) {
        (function type() {
          if (!alive()) return resolve();
          i = Math.min(prompt.length, i + 2);
          typed.textContent = prompt.slice(0, i);
          rest.textContent = prompt.slice(i);
          if (i < prompt.length) setTimeout(type, 22); else resolve();
        })();
      }).then(function () {
        typed.classList.remove("t-typing");
        if (!alive()) return;
        return wait(350).then(function () {
          lines[0].classList.remove("pending");
          // The names arrive in the order the agent wrote them.
          var n = 0;
          return new Promise(function (resolve) {
            (function stream() {
              if (!alive()) return resolve();
              for (var k = 0; k < 3 && n < d.rows.length; k++, n++) {
                var t = makeTile(d.rows[n], d.tlds, false);
                t.li.classList.add("enter");
                tiles.push(t);
                wall.appendChild(t.li);
              }
              count.textContent = n + " of " + d.rows.length;
              updateCue();
              if (n < d.rows.length) setTimeout(stream, 34); else resolve();
            })();
          });
        });
      }).then(function () {
        if (!alive()) return;
        return wait(300).then(function () {
          lines[1].classList.remove("pending");
          return wait(450);
        }).then(function () {
          lines[2].classList.remove("pending");
          // Answers land the way they did: .com quickly, .ai slower, and the
          // .ai lookups the registry rate limited come back last, as unknown.
          var events = [];
          tiles.forEach(function (t, ti) {
            d.tlds.forEach(function (tld, k) {
              var kind = t.row[3 + k][0];
              var base = k === 0 ? 0 : 900;
              var spread = k === 0 ? 1400 : 2100;
              var delay = base + Math.random() * spread + (kind === "unknown" ? 1300 : 0);
              events.push({ at: delay, t: t, k: k, tld: tld });
            });
          });
          events.sort(function (a, b) { return a.at - b.at; });
          var start = performance.now();
          var e = 0;
          return new Promise(function (resolve) {
            (function tick() {
              if (!alive()) return resolve();
              var now = performance.now() - start;
              while (e < events.length && events[e].at <= now) {
                var ev = events[e++];
                var res = ev.t.row[3 + ev.k];
                var c = ev.t.chips[ev.k];
                c.className = "chip " + res[0] + " flip";
                c.textContent = "." + ev.tld + " " + res[1];
                if (ev.k === 0 && res[0].indexOf("open") === 0) ev.t.li.classList.add("is-open");
                var word = res[0] === "openstar" ? "open*" : res[0];
                counts[ev.tld][word] = (counts[ev.tld][word] || 0) + 1;
                tallyEl[ev.tld].textContent = tallyText(counts[ev.tld], d.rows.length);
              }
              if (e < events.length) requestAnimationFrame(tick); else resolve();
            })();
          });
        });
      }).then(function () {
        if (!alive()) return;
        return wait(500).then(function () {
          lines[3].classList.remove("pending");
          sortWall(d);
          frame.scrollTop = 0;
          updateCue();
          tiles.forEach(function (t) { t.li.classList.remove("enter"); t.chips.forEach(function (c) { c.classList.remove("flip"); }); });
          return wait(300);
        }).then(function () {
          answer.classList.remove("pending");
          run.classList.remove("playing");
          setTools(true);
          applyFilters();
          replay.hidden = false;
          playing = false;
        });
      });
    }

    run.querySelectorAll(".rt").forEach(function (b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
        applyFilters();
      });
    });
    styleSel.addEventListener("change", applyFilters);
    replay.addEventListener("click", function () {
      run.querySelectorAll(".rt").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      styleSel.value = "";
      load().then(play);
    });

    function start() {
      load().then(function (d) {
        if (reduceMotion) { finalState(d); return; }
        play(d);
      }).catch(function () {
        wall.textContent = "";
        wall.appendChild(el("li", "wall-empty", "The replay could not load. The full results page below has every name."));
      });
    }

    // Static text stays in place until the replay starts, so nothing shifts
    // and a reader without JavaScript still sees the whole run.
    if (reduceMotion || !("IntersectionObserver" in window)) { start(); return; }
    var seen = false;
    // Start once the top of the terminal is in the upper 60% of the screen.
    // A margin, not a share of the element, so it works however tall the
    // panel is on a phone.
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen) { seen = true; io.disconnect(); start(); }
      });
    }, { threshold: 0, rootMargin: "0px 0px -40% 0px" });
    io.observe(run.querySelector(".run-term"));
    // Fetch the data early, once the page is idle, so the replay starts on time.
    (window.requestIdleCallback || function (f) { setTimeout(f, 1200); })(function () { load().catch(function () {}); });
  })();
})();
