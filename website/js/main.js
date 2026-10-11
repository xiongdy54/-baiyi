/* 增量阅读官网 · 唯一脚本（零依赖，渐进增强）
   职责：1) reveal 入场（MOTION-DESIGN-SPEC §10-R2 同构）
        2) 导航 scrollspy（aria-current）
        3) 页脚年份                                                    */
(function () {
  "use strict";

  var reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 1 · reveal：进入视口即播，播过即弃 */
  var revealables = Array.prototype.slice.call(
    document.querySelectorAll(".reveal")
  );

  function showAll() {
    revealables.forEach(function (el) {
      el.classList.add("is-in");
    });
  }

  if (reduceMotion || !("IntersectionObserver" in window)) {
    showAll();
  } else {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    revealables.forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* 2 · scrollspy：视口 40% 带所在区块 → 导航 aria-current */
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll(".site-nav a[href^='#']")
  );

  if (navLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    navLinks.forEach(function (link) {
      byId[link.getAttribute("href").slice(1)] = link;
    });

    function setCurrent(id) {
      navLinks.forEach(function (link) {
        if (link.getAttribute("href") === "#" + id) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    }

    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && byId[entry.target.id]) {
            setCurrent(entry.target.id);
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );

    Object.keys(byId).forEach(function (id) {
      var section = document.getElementById(id);
      if (section) spy.observe(section);
    });
  }

  /* 3 · 页脚年份 */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
