(function () {
  var form = document.getElementById("waitlist-form");
  var status = document.getElementById("waitlist-status");
  if (!form || !status) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var household = form.household.value;
    var ios = form.ios.value;
    if (!name || !email || !household || !ios) {
      status.className = "form-status err";
      status.textContent = "Add your name, email, household, and whether you use iPhones.";
      return;
    }
    var subject = encodeURIComponent("Pland household beta — access request");
    var body = encodeURIComponent(
      "Name: " + name + "\n" +
      "Household: " + household + "\n" +
      "iOS: " + ios + "\n" +
      "Email: " + email + "\n"
    );
    status.className = "form-status ok";
    status.textContent = "Opening an email to hello@pland.ai.";
    var href = "mailto:hello@pland.ai?subject=" + subject + "&body=" + body;
    if (window.plOpenMail) window.plOpenMail(href);
    else window.location.href = href;
  });
})();
