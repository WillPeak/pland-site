(function () {
  var ENDPOINT = "https://api.pland.ai/waitlist";
  var form = document.getElementById("waitlist-form");
  var status = document.getElementById("waitlist-status");
  var button = form ? form.querySelector("button") : null;
  if (!form || !status || !button) return;

  var sending = false;
  var buttonLabel = button.textContent;

  function say(kind, text) {
    status.className = kind ? "form-status " + kind : "form-status";
    status.textContent = text;
  }

  function cleanName(value) {
    var name = value.trim().replace(/\s+/g, " ");
    if (!name || name.length > 120) return "";
    if (/[\u0000-\u001f]/.test(name)) return "";
    return name;
  }

  function cleanEmail(value) {
    var email = value.trim();
    if (!email || email.length > 200) return "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
    return email;
  }

  function allowedSelect(select) {
    var value = select.value;
    if (!value) return "";
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value && !select.options[i].disabled) return value;
    }
    return "";
  }

  function messageFor(statusCode, code) {
    if (statusCode === 429 || code === "rate_limited") {
      return "That's a few too many tries. Wait a little, or email hello@pland.ai.";
    }
    if (code === "invalid_email") {
      return "That email doesn't look right. Check it and try again, or email hello@pland.ai.";
    }
    if (code === "invalid_name" || code === "invalid_household" || code === "invalid_iphone") {
      return "Check your name, household, and whether you use iPhones, or email hello@pland.ai.";
    }
    return "That didn't save. Try again in a moment, or email hello@pland.ai.";
  }

  function finishError(text) {
    sending = false;
    button.disabled = false;
    button.textContent = buttonLabel;
    form.removeAttribute("aria-busy");
    say("err", text);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (sending) return;

    var name = cleanName(form.name.value);
    var email = form.email.value.trim();
    var household = allowedSelect(form.household);
    var ios = allowedSelect(form.ios);
    form.email.removeAttribute("aria-invalid");

    if (!name || !email || !household || !ios) {
      if (form.name.value.trim() && !name) {
        say("err", "Check your name and try again.");
        return;
      }
      say("err", "Add your name, email, household, and whether you use iPhones.");
      return;
    }
    if (!cleanEmail(email)) {
      form.email.setAttribute("aria-invalid", "true");
      say("err", "That email doesn't look right. Check it and try again.");
      return;
    }

    sending = true;
    button.disabled = true;
    button.textContent = "Joining…";
    form.setAttribute("aria-busy", "true");
    say("", "Joining the waitlist…");

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        email: email,
        household: household,
        ios: ios
      }),
      signal: controller.signal,
      credentials: "omit",
      mode: "cors",
      cache: "no-store"
    }).then(function (res) {
      return res.json().then(function (body) {
        return { statusCode: res.status, body: body };
      }).catch(function () {
        return { statusCode: res.status, body: null };
      });
    }).then(function (result) {
      var body = result.body && typeof result.body === "object" ? result.body : {};
      if (result.statusCode >= 200 && result.statusCode < 300 && body.ok === true) {
        form.hidden = true;
        form.removeAttribute("aria-busy");
        say("ok", "You're on the list. We'll write with TestFlight details.");
        return;
      }
      finishError(messageFor(result.statusCode, typeof body.error === "string" ? body.error : ""));
    }).catch(function () {
      finishError("That didn't save. Try again in a moment, or email hello@pland.ai.");
    }).finally(function () {
      clearTimeout(timer);
    });
  });
})();
