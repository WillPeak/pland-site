(function () {
  var q = window.location.search || "";
  var a = document.getElementById("open-pland");
  if (a) a.href = "pland://plaid/redirect" + q;
  // Do not navigate to pland:// on load. The https return URL is what the app opens.
})();
