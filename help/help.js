"use strict";
/* Tabs for the guide page: the URL hash picks the tab (#token, #usage, #problems). */
(function () {
  const panes = [...document.querySelectorAll(".pane")];
  const tabs = [...document.querySelectorAll(".tabs a")];
  function show() {
    const id = (location.hash || "#token").slice(1);
    const pane = panes.find(p => p.id === "p-" + id) || panes[0];
    panes.forEach(p => p.classList.toggle("on", p === pane));
    tabs.forEach(t => t.setAttribute("aria-selected", String("p-" + t.getAttribute("href").slice(1) === pane.id)));
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", show);
  show();
})();
