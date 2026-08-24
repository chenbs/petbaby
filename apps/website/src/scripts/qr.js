/*
 * 小程序码三触点的交互（方案第 6 章）。与 site.js 分开：site.js 是从原型
 * 原样搬入的文件、一行不改，这块是官网新增的逻辑，混进去以后就分不清哪部分
 * 该与原型保持同步了。
 *
 * 两件事：
 *   ① 弹框开合 —— hover / click 双轨（6.2），键盘可达，Esc 关闭且焦点还回按钮
 *   ② 右下角悬浮按钮的显隐 —— hero 内与 CTA 区不显示（6.4）
 */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /*
   * 用 matchMedia 判断「真的有悬停能力」，而不是判断视口宽度 ——
   * 平板接键鼠、触屏笔记本都存在，按宽度判会判错。
   *
   * 这是这个需求最容易做错的地方：只写 :hover 的话移动端用户点按钮不会有任何
   * 反应，而移动端恰恰是主要流量（微信内访问）。小程序码是全站唯一的转化出口，
   * 不能像自定义光标那样「判断后放弃」，必须双轨。
   */
  var canHover = window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
    : false;

  var anchors = document.querySelectorAll("[data-qr-anchor]");
  var openAnchor = null;

  function popOf(anchor) { return anchor.querySelector("[data-qr-pop]"); }
  function triggerOf(anchor) { return anchor.querySelector("[data-qr-trigger]"); }

  function close(anchor) {
    var pop = popOf(anchor);
    var trigger = triggerOf(anchor);
    if (!pop || !trigger) return;
    if (anchor._qrCloseTimer) { clearTimeout(anchor._qrCloseTimer); anchor._qrCloseTimer = null; }
    trigger.setAttribute("aria-expanded", "false");
    pop.classList.remove("is-open");
    anchor._qrPinned = false;
    if (openAnchor === anchor) openAnchor = null;
    // 等过渡结束再置 hidden，否则收起动画看不到（与原型菜单同一套分工）
    anchor._qrCloseTimer = setTimeout(function () {
      pop.hidden = true;
      anchor._qrCloseTimer = null;
    }, reduced ? 0 : 240);
  }

  /*
   * pinned 表示「用户明确点开的」，与「悬停/聚焦顺带带出来的」区分开。
   * 点开的不会被 mouseleave 关掉（触屏上某些浏览器会在 tap 后合成鼠标事件），
   * 也决定再点一次是关闭而不是重复打开。
   */
  function open(anchor, pinned) {
    var pop = popOf(anchor);
    var trigger = triggerOf(anchor);
    if (!pop || !trigger) return;
    // 同页两个触点不同时开
    if (openAnchor && openAnchor !== anchor) close(openAnchor);
    if (anchor._qrCloseTimer) { clearTimeout(anchor._qrCloseTimer); anchor._qrCloseTimer = null; }
    pop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (pinned) anchor._qrPinned = true;
    openAnchor = anchor;
    // 先取消 hidden 再等一帧加类，否则初始态与终态同帧生效、transition 不触发
    requestAnimationFrame(function () { pop.classList.add("is-open"); });
  }


  Array.prototype.forEach.call(anchors, function (anchor) {
    var trigger = triggerOf(anchor);
    if (!trigger || !popOf(anchor)) return;

    if (canHover) {
      anchor.addEventListener("mouseenter", function () { open(anchor, false); });
      anchor.addEventListener("mouseleave", function () {
        // 触屏下合成的鼠标事件可能在 tap 后到达，点开的不能被它关掉
        if (anchor._qrPinned) return;
        close(anchor);
      });
    }

    /*
     * focusin / focusout 而非 focus / blur：前者会冒泡，弹框内的元素得到焦点时
     * 不会被误判成失焦。
     */
    anchor.addEventListener("focusin", function () { open(anchor, false); });
    anchor.addEventListener("focusout", function (event) {
      if (anchor.contains(event.relatedTarget)) return;
      close(anchor);
    });

    /*
     * click 一律接管，不只在无悬停能力时接 —— 桌面用户点一下按钮也该有反应，
     * 且点开之后要能再点关掉。
     *
     * **判 _qrPinned 而不是判 isOpen**：在触屏上 tap 会先派发 focus（顶栏按钮是
     * <button>，点击即聚焦），focusin 已经把弹框打开了，此刻 isOpen 为真 ——
     * 按 isOpen 取反的话第一次 tap 就变成「关闭」，弹框永远打不开。
     * pinned 只由 click 置位，所以这个判断能区分「用户点过」与「刚被聚焦带出来」。
     */
    trigger.addEventListener("click", function (event) {
      event.stopPropagation();   // 别被 hero 的一次性「看完整片」监听顺手吃掉
      if (anchor._qrPinned) close(anchor);
      else open(anchor, true);
    });

    // 点弹框内部不关（点二维码本身是常见动作）
    var pop = popOf(anchor);
    pop.addEventListener("click", function (event) { event.stopPropagation(); });
  });

  if (anchors.length) {
    // 点弹框外关闭
    document.addEventListener("click", function () {
      if (openAnchor) close(openAnchor);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !openAnchor) return;
      var trigger = triggerOf(openAnchor);
      close(openAnchor);
      if (trigger) trigger.focus();   // 焦点还回按钮，键盘用户不会掉到页首
    });
  }

  /* ══ 右下角悬浮按钮的显隐（方案 6.4）══════════════════════════════════ */

  var fab = document.querySelector("[data-qr-fab]");
  if (fab) {
    var hero = document.querySelector(".hero");
    var cta = document.getElementById("contact");
    var observeHero = fab.hasAttribute("data-observe-hero") && hero;

    if (!observeHero || !("IntersectionObserver" in window)) {
      /*
       * 无 hero 的页面（文章、法务、404）直接显示；
       * 不支持 IO 的浏览器也直接显示 —— 少一条「不碍事」的优化，
       * 好过唯一的转化出口整个消失。
       */
      fab.classList.add("is-visible");
    } else {
      var heroVisible = true;
      var ctaVisible = false;

      var sync = function () {
        fab.classList.toggle("is-visible", !heroVisible && !ctaVisible);
        // 隐藏时若弹框还开着，一并收掉
        if (heroVisible || ctaVisible) close(fab);
      };

      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { heroVisible = entry.isIntersecting; });
        sync();
      }, { threshold: 0 }).observe(hero);

      if (cta) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) { ctaVisible = entry.isIntersecting; });
          sync();
        }, { threshold: 0 }).observe(cta);
      }

      sync();
    }
  }
})();
