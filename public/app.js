"use strict";
(function () {
  document.querySelectorAll("button.copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { btn.textContent = "Select and copy"; });
      } else { btn.textContent = "Select and copy"; }
    });
  });

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
        show("ok", "You are on the list. Updates go to " + value + ".");
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
