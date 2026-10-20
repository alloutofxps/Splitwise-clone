// Fetched only by browsers too old to draw Divvy properly (the check is in
// src/app/layout.tsx): says so plainly. Old JavaScript on purpose.
(function () {
  document.documentElement.setAttribute("data-unsupported", "");
  function show() {
    var b = document.createElement("div"), g = "margin:0 0 12px;color:#57534e";
    b.setAttribute("role", "alert");
    b.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:#fafaf8;color:#141412;padding:48px 24px;overflow:auto;font:17px/1.5 -apple-system,system-ui,sans-serif";
    b.innerHTML = "<div style='max-width:420px;margin:0 auto'><p style='font-size:26px;font-weight:600;line-height:1.2;margin:0 0 12px'>Divvy needs a newer browser</p><p style='" + g + "'>This browser is too old to show Divvy properly. Update it, or open Divvy in a recent Safari, Chrome or Firefox.</p><p style='" + g + "'>On an iPhone or iPad, Divvy needs iOS 16.4 or later: Settings, General, Software Update.</p></div>";
    document.body.appendChild(b);
  }
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
})();
