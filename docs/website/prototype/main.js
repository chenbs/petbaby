/*
 * 官网原型的全部脚本。四件事，互不依赖：
 *   ① hero 视频的 5 秒截断循环（规格 2.2）
 *   ② hero 入场时间线（规格 2.5）
 *   ③ 滚动入场（规格 5 章，once + 提前 80px）
 *   ④ 移动菜单
 *
 * 不引框架 —— KittyPaw 用 framer-motion，但那套参数都能翻成 CSS transition + 一个类名，
 * 原型只需验证节奏。spring 落点过冲用 cubic-bezier 近似（见 styles.css 的 --ease-spring）。
 *
 * 自定义光标（规格 2.7）已确认不做：微信内移动端 cursor 无效，桌面端隐藏系统指针
 * 对依赖指针定位的用户是实打实的可用性损失。
 */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ══ ① hero 视频：5 秒截断循环 ═══════════════════════════════════════
   *
   * 进站看到的是「猫探头 → 抬头看壁虎」这 5 秒高潮片段在循环；完整 10 秒叙事
   * 留给愿意交互的人（规格 2.2 明确这个取舍要保留）。
   *
   * 两处必须注意：
   *   · currentTime = 0 后要显式 play()：Safari 上 seek 会暂停播放。
   *   · 自动播放可能被浏览器拒绝（低电量模式、节流策略），所以挂一次性的
   *     click/touchstart 兜底恢复播放 —— 这也顺带是「点击播完整片」的入口。
   */
  var video = document.querySelector("[data-hero-video]");
  var TRUNCATE_AT = 5;

  if (video) {
    var expanded = false;   // 用户是否已交互，交互后放开到完整 10 秒

    video.loop = false;     // 初始由 timeupdate 手动归零，不用原生 loop

    video.addEventListener("timeupdate", function () {
      if (expanded) return;
      if (video.currentTime >= TRUNCATE_AT) {
        video.currentTime = 0;
        var replay = video.play();
        if (replay && replay.catch) replay.catch(function () { /* 自动播放被拒，等用户交互 */ });
      }
    });

    /*
     * 「看完整片」与「解锁自动播放」拆成两件事，挂在不同阶段。
     *
     * expand 走冒泡阶段（window），所以菜单按钮的 stopPropagation 能挡住它 ——
     * 点菜单不该被当成「我想看完整叙事」，规格 2.2 的取舍是截断循环留给没交互的人。
     *
     * 但自动播放解锁不能一起被挡掉：浏览器拒绝 autoplay 时（低电量模式等），
     * 若用户第一次点的恰好是菜单按钮，视频就一直停着。因此 kick 走捕获阶段，
     * 任何点击都能到，且只负责调 play()、不改 loop。
     */
    var kick = function () {
      if (video.paused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
    };
    window.addEventListener("click", kick, { capture: true, once: true });
    window.addEventListener("touchstart", kick, { capture: true, once: true, passive: true });

    var expand = function () {
      if (expanded) return;
      expanded = true;
      video.loop = true;                       // 放开后交给原生循环
      var resume = video.play();
      if (resume && resume.catch) resume.catch(function () {});
    };

    // 冒泡阶段：可被 stopPropagation 拦下，这是刻意的（见上）
    window.addEventListener("click", expand, { once: true });
    window.addEventListener("touchstart", expand, { once: true, passive: true });

    /*
     * 离屏时暂停。规格 2.2 用 IntersectionObserver(threshold 0.15) 判断首屏是否在
     * 视野内，原本是为光标逻辑服务的；光标不做，这个观察器改去省电 ——
     * 长页面滚到底部时还在解码 1080p 视频纯属浪费。
     */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var play = video.play();
            if (play && play.catch) play.catch(function () {});
          } else {
            video.pause();
          }
        });
      }, { threshold: 0.15 }).observe(video);
    }
  }

  /* ══ ② hero 入场时间线（规格 2.5 的精确值）═════════════════════════════
   *
   *   顶栏     y:-40 → duration 1.4,  ease [.16,1,.3,1]
   *   标题容器 staggerChildren 0.18, delayChildren 0.8
   *   标题单词 x:-50  → spring(stiffness 70, damping 12)
   *   说明文字 y:15   → delay 1.8, duration 1
   *   底部条   y:40   → delay 2.2, duration 1.2
   *
   * 位移与缓动写在 CSS，这里只负责在正确时刻加 .is-in，并把逐词 stagger 的
   * transition-delay 按下标算出来（词数会随文案变，写死在 CSS 里不合适）。
   */
  var words = document.querySelectorAll("[data-hero-title] .word");
  for (var w = 0; w < words.length; w += 1) {
    words[w].style.transitionDelay = (0.8 + w * 0.18).toFixed(2) + "s";
  }

  var heroStage = [
    ["[data-hero-topbar]", 0],
    ["[data-hero-title]", 0],
    ["[data-hero-sub]", 0],
    ["[data-hero-bar]", 0]
  ];

  function enterHero() {
    heroStage.forEach(function (pair) {
      var node = document.querySelector(pair[0]);
      if (node) node.classList.add("is-in");
    });
  }

  // 等一帧再加类，否则初始态与终态在同一帧生效、transition 不触发
  if (reduced) {
    enterHero();
  } else {
    requestAnimationFrame(function () { requestAnimationFrame(enterHero); });
  }

  /* ══ ③ 滚动入场：once + 提前 80px（规格 5 章）═════════════════════════ */
  var nodes = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window) || reduced) {
    for (var i = 0; i < nodes.length; i += 1) nodes[i].classList.add("is-in");
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);       // once：滚回去不重播
      });
    }, { rootMargin: "0px 0px -80px 0px", threshold: 0 });

    nodes.forEach(function (node) { observer.observe(node); });
  }

  /* ══ ④ 菜单：一个按钮，两个面板 ═══════════════════════════════════════
   *
   * 桌面 w-64 下拉与移动全屏面板共用一个开合状态，由 CSS 断点决定谁可见
   * （原站也是这个结构：hidden md:block / md:hidden 两个分支同一个 state）。
   * 所以这里一律对两个面板同时操作，不按视口分支 —— 判视口就得监听 resize，
   * 而 CSS 已经把该显示谁说清楚了。
   *
   * hidden 属性与 .is-open 类分工：hidden 管可访问性树（关闭时对读屏隐藏），
   * .is-open 管动画。关闭时要等过渡结束再置 hidden，否则收起动画看不到。
   * 两个面板过渡时长不同（下拉 240ms、全屏 400ms），按长的算。
   */
  var toggle = document.querySelector("[data-menu-toggle]");
  var panels = [
    document.querySelector("[data-menu-desktop]"),
    document.querySelector("[data-menu-mobile]")
  ].filter(Boolean);

  if (toggle && panels.length) {
    var closeTimer = null;
    var isOpen = function () { return toggle.getAttribute("aria-expanded") === "true"; };

    var mobilePanel = document.querySelector("[data-menu-mobile]");

    var setOpen = function (open) {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      toggle.setAttribute("aria-expanded", String(open));

      if (open) {
        // 先取消 hidden，否则下面量不到尺寸
        panels.forEach(function (p) { p.hidden = false; });
        /*
         * 只有全屏面板该锁滚动，下拉不该 —— 桌面开着下拉时页面仍能正常滚。
         * 量它的宽度判断此刻是否真的可见（CSS 断点说了算），比在 JS 里复读
         * 一遍 767px 断点可靠：改断点只需动 CSS。
         *
         * 不能用 offsetParent —— 它对 position:fixed 元素恒为 null，
         * 与可见性无关，会让这里永远判成不可见。
         */
        var fullscreenVisible = mobilePanel ? mobilePanel.getBoundingClientRect().width > 0 : false;
        document.body.classList.toggle("menu-open", fullscreenVisible);
        requestAnimationFrame(function () {
          panels.forEach(function (p) { p.classList.add("is-open"); });
        });
      } else {
        document.body.classList.remove("menu-open");
        panels.forEach(function (p) { p.classList.remove("is-open"); });
        closeTimer = setTimeout(function () {
          panels.forEach(function (p) { p.hidden = true; });
        }, reduced ? 0 : 400);
      }
    };

    toggle.addEventListener("click", function (event) {
      event.stopPropagation();                 // 别被 hero 的一次性 expand 顺手吃掉
      setOpen(!isOpen());
    });

    // 点导航项后关闭，让锚点跳转可见
    panels.forEach(function (panel) {
      panel.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () { setOpen(false); });
      });
      // 点面板内部空白处不该关（下拉尤其明显：点标题区就收了会很意外）
      panel.addEventListener("click", function (event) { event.stopPropagation(); });
    });

    var closeBtn = document.querySelector("[data-menu-close]");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        setOpen(false);
      });
    }

    /*
     * 点面板外关闭。下拉必须有这条 —— 它不铺满屏幕，点页面别处若不收，
     * 面板会一直挂在顶栏上。挂在 document 上，靠上面几处 stopPropagation
     * 把面板内与按钮自身的点击挡掉。
     */
    document.addEventListener("click", function () { if (isOpen()) setOpen(false); });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();                        // 焦点还回按钮，键盘用户不会掉到页首
      }
    });
  }

  /* ══ ⑤ 首屏自定义光标（规格 2.7）════════════════════════════════════
   *
   * 外圈 80px，文字按 rotate(i/n*360deg) 逐字符排一圈、12 秒匀速自转；
   * 圆心 3px 白点带光晕。跟随用 spring(damping 28 / stiffness 280 / mass 0.4)。
   *
   * 启用条件卡得比原站严，三道门都过才建 DOM：
   *   ① 有精确指针（(pointer: fine)）—— 触屏上 cursor 完全无效，建了纯浪费
   *   ② 视口 ≥1024px —— 与原站一致
   *   ③ 不是 reduced-motion —— 12 秒自转 + 实时跟随对眩晕敏感的用户是负担
   * 任一不满足就整块不启用，系统指针原样保留。
   *
   * 与原站的一处刻意差异：**只在 hero 区域内隐藏系统指针**，不改
   * documentElement/body 的 cursor。原站是全局设 cursor:none 再靠 hover
   * 白名单恢复，漏一个选择器就有一片区域没有指针；限定在 hero 内则天然安全 ——
   * 这也是规格 2.7 当初否掉它的主要理由（依赖指针定位的用户的可用性损失）。
   */
  var cursorMount = document.querySelector("[data-cursor-mount]");
  var hero = document.querySelector(".hero");
  var canFinePoint = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  var wideEnough = window.matchMedia && window.matchMedia("(min-width: 1024px)").matches;

  if (cursorMount && hero && canFinePoint && wideEnough && !reduced) {
    /*
     * 文案要短。原站是 "Touch to Continue • Walk Cat •"（29 字符，但英文字形窄）；
     * 中文字面宽约为英文两倍，字数与半径必须一起压。取 8 字、半径 32px。
     *
     * **不放 • 间隔点**：原站用它分隔两个短语（Touch to Continue / Walk Cat），
     * 我们只有一个短语，孤立的 • 排在环上会被看成第二个圆心白点。
     * 也不留首尾空格 —— 空格会占掉一个字符位，让环出现一段空缺。
     */
    var LABEL = "点击看完整片段";
    var RADIUS = 32;

    // 逐字符排一圈。用 span 而非 canvas：字体与描边跟随 CSS，不必自己处理 DPR
    var ring = document.createElement("div");
    ring.className = "hero-cursor";
    var ringText = document.createElement("div");
    ringText.className = "hero-cursor-ring";
    var chars = LABEL.split("");
    chars.forEach(function (ch, i) {
      var s = document.createElement("span");
      s.textContent = ch;
      /*
       * 变换顺序要紧：先把字符自身中心移到锚点（translate -50%），
       * 再绕锚点转到自己的角度，最后沿半径推出去。
       * 顺序写反（先 translateY 再 rotate）会让每个字绕自己转而不是绕环心排。
       */
      s.style.transform = "translate(-50%,-50%) rotate(" + (i / chars.length * 360) + "deg) translateY(-" + RADIUS + "px)";
      ringText.appendChild(s);
    });
    var dot = document.createElement("span");
    dot.className = "hero-cursor-dot";
    ring.appendChild(ringText);
    ring.appendChild(dot);
    cursorMount.appendChild(ring);

    /*
     * spring 跟随，逐帧积分。damping 28 / stiffness 280 / mass 0.4 是规格给的
     * framer-motion 参数，这里按 F = -k·x - c·v 直接算 —— 比用 CSS transition
     * 近似更贴原手感（transition 无法表达「速度」，快速划过时会明显滞后）。
     */
    var K = 280, C = 28, M = 0.4;
    var targetX = 0, targetY = 0;       // 鼠标位置
    var x = 0, y = 0, vx = 0, vy = 0;   // 环的位置与速度
    var placed = false;                 // 首次进入时直接落位，不从 (0,0) 飞过来
    var inside = false;
    var raf = null;

    function step() {
      // 固定步长 1/60，不用真实 delta —— 掉帧时用真实 delta 会让 spring 发散
      var dt = 1 / 60;
      var ax = (-K * (x - targetX) - C * vx) / M;
      var ay = (-K * (y - targetY) - C * vy) / M;
      vx += ax * dt; vy += ay * dt;
      x += vx * dt;  y += vy * dt;
      ring.style.transform = "translate3d(" + x + "px," + y + "px,0) translate(-50%,-50%)";
      // 静止且已离开时停掉 rAF，不空转
      if (!inside && Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) { raf = null; return; }
      raf = requestAnimationFrame(step);
    }
    function kick() { if (raf === null) raf = requestAnimationFrame(step); }

    hero.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;    // 触控笔/手指不接管
      var r = hero.getBoundingClientRect();
      targetX = e.clientX - r.left;
      targetY = e.clientY - r.top;
      if (!placed) { x = targetX; y = targetY; placed = true; }
      kick();
    });

    hero.addEventListener("pointerenter", function (e) {
      if (e.pointerType !== "mouse") return;
      inside = true;
      hero.classList.add("cursor-on");
      ring.classList.add("is-in");
      kick();
    });

    hero.addEventListener("pointerleave", function () {
      inside = false;
      hero.classList.remove("cursor-on");
      ring.classList.remove("is-in");
      kick();
    });

    /*
     * 悬到可交互元素上时环淡出并恢复系统指针（规格 2.7 的白名单）。
     * 用 pointerover + closest 而非给每个元素挂监听 —— 后者在 DOM 变化时会漏。
     */
    var INTERACTIVE = "button, a, input, select, textarea, [role='button']";
    hero.addEventListener("pointerover", function (e) {
      var onControl = e.target.closest && e.target.closest(INTERACTIVE);
      ring.classList.toggle("is-muted", Boolean(onControl));
      hero.classList.toggle("cursor-on", !onControl && inside);
    });

    // 视口变窄或切到触屏（如平板旋转、外接鼠标拔掉）时整块退出
    var mq = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    var onMqChange = function () {
      if (mq.matches) return;
      hero.classList.remove("cursor-on");
      ring.remove();
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    };
    if (mq.addEventListener) mq.addEventListener("change", onMqChange);
    else if (mq.addListener) mq.addListener(onMqChange);        // Safari <14

    /*
     * 离屏时停掉。规格 2.7 原文：「首屏另用 IntersectionObserver(threshold: 0.15)
     * 判断是否在视野内，离屏时停掉光标逻辑」。
     */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var visible = entry.isIntersecting;
          ring.style.display = visible ? "" : "none";
          if (!visible) {
            hero.classList.remove("cursor-on");
            if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
          }
        });
      }, { threshold: 0.15 }).observe(hero);
    }
  }
})();
