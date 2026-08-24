/**
 * t-glass-sheet：沉浸式玻璃面板。
 *
 * 组件同时承担背景层与面板层：亮度联动要求遮罩强度随面板位移逐帧变化，
 * 若背景在页面、面板在组件，逐帧联动就得跨组件通信，无法在渲染层一次完成（需求 theme-2.md 4.1）。
 *
 * 拖动全部在 index.wxs 内完成，逻辑层只在档位确定时被 onGestureEnd 通知一次。
 * 本文件里的 setData 只发生在：初始化几何、档位变化、背景加载失败、视频播放状态变化。
 */
const manager = require("../../theme/manager");

const ORDER = ["collapsed", "half", "expanded"];
const NAV_BAR_RPX = 88;      // 自定义导航栏标题区高度
const NAV_GAP_RPX = 24;      // 展开档与导航栏之间的留白
const COLLAPSED_MIN_RPX = 340; // 收起档下限，保证把手 + 标题 + 主 CTA 不被裁掉
const EXPANDED_PAUSE_MS = 2000; // 展开档超过该时长暂停视频（需求 9.3.3）

function clampState(value) { return ORDER.indexOf(value) >= 0 ? value : "half"; }

Component({
  options: { multipleSlots: true, addGlobalClass: true },
  properties: {
    backgroundImage: { type: String, value: "" },
    backgroundVideo: { type: String, value: "" },
    poster: { type: String, value: "" },
    state: { type: String, value: "half", observer: "syncExternalState" },
    collapsedHeight: { type: Number, value: 22, observer: "measure" },
    defaultHeight: { type: Number, value: 60, observer: "measure" },
    expandedHeight: { type: Number, value: 90, observer: "measure" },
    blur: { type: Boolean, value: true },
    anim: { type: String, value: "fade" },
    scrimMax: { type: Number, value: 0, observer: "measure" },
    gestureDisabled: { type: Boolean, value: false, observer: "handleGestureDisabled" },
    videoAutoplay: { type: Boolean, value: false },
    title: { type: String, value: "" }
  },
  data: {
    geo: null,
    expandedPx: 0,
    initialOffset: 0,
    initialOpacity: 1,
    initialScrim: 0,
    atTop: true,
    hasImage: false,
    hasVideo: false,
    videoPlaying: false
  },

  lifetimes: {
    attached() {
      this.current = clampState(this.data.state);
      this.measure();
      this.resolveBackground();
      this.setupVideo();
      // 遮罩上限是在 JS 里读的 token，不像其余材质那样跟着 CSS 变量自动换，需订阅主题变更
      this.unsubscribeTheme = manager.subscribe(() => this.measure());
    },
    detached() {
      this.clearExpandedTimer();
      if (typeof this.unsubscribeTheme === "function") { this.unsubscribeTheme(); this.unsubscribeTheme = null; }
    }
  },

  pageLifetimes: {
    // 档位不重置；视频按 9.3.4 暂停 / 恢复
    hide() { this.pauseVideo(); },
    show() { this.resumeVideo(); }
  },

  observers: {
    "backgroundImage, backgroundVideo, poster": function () { this.resolveBackground(); this.setupVideo(); }
  },

  methods: {
    /**
     * 几何量一次算清并作为 dataset 传给 WXS：单位统一为 px，WXS 内不再做单位换算。
     * `--glass-scrim-max` 的覆盖值由 scrim-max 属性提供，为 0 时读主题 token 的默认值。
     */
    measure() {
      let info = {};
      try { info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}; } catch (error) { info = {}; }
      const height = info.windowHeight || 667;
      const width = info.windowWidth || 375;
      const statusBar = info.statusBarHeight || 20;
      const toPx = (rpx) => rpx * width / 750;

      const collapsed = Math.max(height * this.data.collapsedHeight / 100, toPx(COLLAPSED_MIN_RPX));
      const ceiling = height - statusBar - toPx(NAV_BAR_RPX) - toPx(NAV_GAP_RPX);
      const expanded = Math.max(Math.min(height * this.data.expandedHeight / 100, ceiling), collapsed);
      const half = Math.min(Math.max(height * this.data.defaultHeight / 100, collapsed), expanded);

      this.geometry = {
        height,
        collapsed,
        half,
        expanded,
        state: this.current || "half",
        scrimMax: this.resolveScrimMax(),
        disabled: this.data.gestureDisabled
      };
      this.setData({ geo: this.geometry, expandedPx: expanded });
      this.paint(this.current || "half");
    },

    /** scrim-max 为 0 表示用主题 token；组件读不到 CSS 变量，故直接向 ThemeManager 取值。 */
    resolveScrimMax() {
      if (this.data.scrimMax > 0) return this.data.scrimMax;
      try { return manager.getTheme().glassScrimMax; } catch (error) { return 0.35; }
    },

    /** 把当前档位的静态样式写进 data，供首帧与档位变化后的渲染（拖动中不走这里）。 */
    paint(state) {
      const geo = this.geometry;
      if (!geo) return;
      const visible = state === "collapsed" ? geo.collapsed : state === "expanded" ? geo.expanded : geo.half;
      const max = geo.scrimMax;
      const top = Math.min(max + 0.1, 0.6);
      const scrim = state === "collapsed" ? 0 : state === "expanded" ? top : max;
      this.setData({
        initialOffset: geo.expanded - visible,
        initialOpacity: state === "collapsed" ? 0.92 : 1,
        initialScrim: this.data.hasImage || this.data.hasVideo ? scrim : 0
      });
    },

    resolveBackground() {
      const video = this.data.backgroundVideo;
      const image = this.data.backgroundImage || this.data.poster;
      this.setData({ hasVideo: Boolean(video) && !this.videoFailed, hasImage: !video && Boolean(image) });
      // 有无背景资源决定遮罩是否生效，取值变化后必须重画一次
      this.paint(this.current || "half");
    },

    /** 网络类型决定是否自动播放：非 WiFi 只显示 poster，首次点击背景才开始播（需求 9.3.2）。 */
    setupVideo() {
      if (!this.data.backgroundVideo) { this.setData({ videoPlaying: false }); return; }
      this.awaitingFirstTap = false;
      const decide = (wifi) => {
        if (wifi || this.data.videoAutoplay) { this.setData({ videoPlaying: true }); this.playVideo(); }
        else { this.awaitingFirstTap = true; this.setData({ videoPlaying: false }); }
      };
      try { wx.getNetworkType({ success: (result) => decide(result.networkType === "wifi"), fail: () => decide(false) }); }
      catch (error) { decide(false); }
    },

    videoContext() {
      if (!this.context) this.context = wx.createVideoContext("sheet-video", this);
      return this.context;
    },
    playVideo() { if (this.data.hasVideo) { try { this.videoContext().play(); } catch (error) { /* 上下文未就绪时忽略 */ } } },
    pauseVideo() { if (this.data.hasVideo) { try { this.videoContext().pause(); } catch (error) { /* 同上 */ } } },
    resumeVideo() { if (this.data.hasVideo && this.data.videoPlaying && this.current !== "expanded") this.playVideo(); },

    clearExpandedTimer() { if (this.expandedTimer) { clearTimeout(this.expandedTimer); this.expandedTimer = null; } },

    /** 展开档视频几乎不可见，停留超过 2 秒后暂停；回到其他档位立即恢复。 */
    scheduleVideoByState(state) {
      if (!this.data.hasVideo) return;
      this.clearExpandedTimer();
      if (state === "expanded") this.expandedTimer = setTimeout(() => this.pauseVideo(), EXPANDED_PAUSE_MS);
      else this.resumeVideo();
    },

    handleScroll(event) {
      const atTop = (event.detail.scrollTop || 0) <= 0;
      if (atTop !== this.data.atTop) this.setData({ atTop });
    },

    handleImageError() { this.setData({ hasImage: false }); this.paint(this.current || "half"); this.triggerEvent("backgrounderror", { type: "image" }); },
    handleVideoError() {
      // 视频失败退回 poster，poster 也失败时由 handleImageError 退回纯色
      this.videoFailed = true;
      this.setData({ hasVideo: false, videoPlaying: false, hasImage: Boolean(this.data.poster || this.data.backgroundImage) });
      this.paint(this.current || "half");
      this.triggerEvent("backgrounderror", { type: "video" });
    },

    handleBackgroundTap() {
      this.triggerEvent("backgroundtap", {});
      if (this.awaitingFirstTap) { this.awaitingFirstTap = false; this.setData({ videoPlaying: true }); this.playVideo(); return; }
      if (this.data.gestureDisabled) return;
      this.applyState(this.current === "collapsed" ? "half" : "collapsed");
    },

    /** 把手点击：为不能完成拖动手势的用户提供等效路径（需求 6.2.7）。 */
    cycle() {
      if (this.data.gestureDisabled) return;
      const next = ORDER[(ORDER.indexOf(this.current) + 1) % ORDER.length];
      this.applyState(next);
    },

    /** WXS 在手指抬起、目标档位确定后回调一次，这是拖动全过程唯一的一次 setData。 */
    onGestureEnd(detail) {
      this.triggerEvent("dragend", { state: detail.state, ratio: detail.ratio });
      if (detail.state === detail.from) return;
      this.commit(detail.state, detail.from);
    },

    /** 对外方法与点击路径共用：带吸附动画，派发与手势相同的事件。 */
    applyState(next) {
      const target = clampState(next);
      if (target === this.current) return;
      this.commit(target, this.current);
    },

    /**
     * 档位落地。paint() 写回的样式与 WXS 手势动画的终值一致，因此手势路径重画不会产生二次动画；
     * 反过来若不重画，这次 setData 会用陈旧的 initialOffset 覆盖 WXS 刚写进渲染层的样式。
     */
    commit(target, from) {
      this.current = target;
      if (this.geometry) this.geometry.state = target;
      this.paint(target);
      this.setData({ geo: this.geometry, state: target });
      this.scheduleVideoByState(target);
      this.triggerEvent("statechange", { from, to: target });
      if (target === "expanded") this.triggerEvent("expand", { from });
      if (target === "collapsed") this.triggerEvent("collapse", { from });
    },

    /** 外部把 state 属性改成别的值时按受控处理；与内部状态一致则跳过，避免回环。 */
    syncExternalState(value) {
      const target = clampState(value);
      if (!this.geometry || target === this.current) return;
      this.applyState(target);
    },

    handleGestureDisabled(disabled) {
      if (!this.geometry) return;
      this.geometry.disabled = disabled;
      // 禁用手势时面板固定在 half（需求 6.3）
      if (disabled && this.current !== "half") { this.current = "half"; this.geometry.state = "half"; this.paint("half"); }
      this.setData({ geo: this.geometry });
    },

    setState(state) { this.applyState(state); },
    expand() { this.applyState("expanded"); },
    collapse() { this.applyState("collapsed"); },
    half() { this.applyState("half"); }
  }
});
