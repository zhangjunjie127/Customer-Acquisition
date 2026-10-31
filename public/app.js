(function bootstrap(root) {
  "use strict";

  const viewStateApi = (() => {
    const STORAGE_KEY = "xhs-radar-view-state:v1";
    const VALID_MODES = new Set(["keyword", "profile"]);
    const VALID_WORKSPACE_VIEWS = new Set(["discover", "ideas", "reviews", "check"]);

    function normalizeInterruptedView(view) {
      if (view.searchStatus?.kind === "loading") {
        view.searchStatus = {
          kind: "error",
          text: "上次搜索中断，已保留原结果。点击“刷新结果”可重新读取。",
        };
      }
      for (const progress of [view.analysisDisplay, view.accountProgress]) {
        if (progress?.active) {
          progress.elapsed = (progress.elapsed || 0) + Math.max(0, Date.now() - progress.startedAt);
          progress.active = false;
        }
      }
      if (view.analysisProgress) view.analysisStatus = "分析已中断，可继续分析";
      if (view.accountProgress && view.accountProgress.phase !== "done") {
        view.accountStatus = "分析已中断，可继续分析";
      }
      return view;
    }

    function saveViewState(storage, snapshot) {
      try {
        const views = {};
        for (const [mode, source] of Object.entries(snapshot.views || {})) {
          const view = { ...source };
          if (view.detailCache instanceof Map) view.detailCache = Object.fromEntries(view.detailCache);
          delete view.videoFile;
          views[mode] = view;
        }
        storage.setItem(STORAGE_KEY, JSON.stringify({
          version: 1,
          mode: snapshot.mode,
          workspaceView: snapshot.workspaceView,
          views,
        }));
        return true;
      } catch {
        return false;
      }
    }

    function loadViewState(storage) {
      try {
        const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
        if (!value || value.version !== 1 || !value.views || typeof value.views !== "object") return null;
        const views = {};
        for (const [mode, source] of Object.entries(value.views)) {
          if (!VALID_MODES.has(mode) || !source || typeof source !== "object" || Array.isArray(source)) continue;
          const view = { ...source };
          const cache = view.detailCache;
          view.detailCache = new Map(
            cache && typeof cache === "object" && !Array.isArray(cache) ? Object.entries(cache) : [],
          );
          normalizeInterruptedView(view);
          views[mode] = view;
        }
        return {
          mode: VALID_MODES.has(value.mode) ? value.mode : "keyword",
          workspaceView: VALID_WORKSPACE_VIEWS.has(value.workspaceView) ? value.workspaceView : "discover",
          views,
        };
      } catch {
        return null;
      }
    }

    return { STORAGE_KEY, loadViewState, saveViewState };
  })();

  if (typeof module === "object" && module.exports) {
    module.exports = viewStateApi;
    return;
  }
  root.XhsRadarViewState = viewStateApi;

  const $ = (id) => document.getElementById(id);
  const WORD_CHECK_STORAGE_KEY = "xhs-radar-content-risk:v1";
  const contentRisk = window.ContentRisk;

  function loadWordCheckDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(WORD_CHECK_STORAGE_KEY) || "null");
      const validPlatforms = new Set(contentRisk.PLATFORMS.map((platform) => platform.id));
      const allGroups = contentRisk.RULE_GROUPS.map((group) => group.id);
      const validGroups = new Set(allGroups);
      if (!saved || typeof saved !== "object") {
        return {
          text: "",
          checkedText: "",
          selectedPlatforms: ["xiaohongshu"],
          selectedGroups: allGroups,
          ignoredText: "",
          ignoredHits: [],
          undoSnapshot: null,
        };
      }
      const text = typeof saved.text === "string" ? saved.text.slice(0, 20000) : "";
      const checkedText = saved.checkedText === text ? text : "";
      const selectedPlatforms = Array.isArray(saved.selectedPlatforms)
        ? saved.selectedPlatforms.filter((id) => validPlatforms.has(id))
        : ["xiaohongshu"];
      const selectedGroups = Array.isArray(saved.selectedGroups)
        ? saved.selectedGroups.filter((id) => validGroups.has(id))
        : allGroups;
      const ignoredText = saved.ignoredText === text ? text : "";
      const ignoredHits = ignoredText && Array.isArray(saved.ignoredHits)
        ? saved.ignoredHits.filter((key) => typeof key === "string").slice(0, 100)
        : [];
      const savedUndo = saved.undoSnapshot;
      const undoSnapshot = savedUndo && typeof savedUndo.text === "string"
        ? {
          text: savedUndo.text.slice(0, 20000),
          checkedText: savedUndo.checkedText === savedUndo.text ? savedUndo.text : "",
          ignoredText: savedUndo.ignoredText === savedUndo.text ? savedUndo.text : "",
          ignoredHits: savedUndo.ignoredText === savedUndo.text && Array.isArray(savedUndo.ignoredHits)
            ? savedUndo.ignoredHits.filter((key) => typeof key === "string").slice(0, 100)
            : [],
        }
        : null;
      return { text, checkedText, selectedPlatforms, selectedGroups, ignoredText, ignoredHits, undoSnapshot };
    } catch {
      return {
        text: "",
        checkedText: "",
        selectedPlatforms: ["xiaohongshu"],
        selectedGroups: contentRisk.RULE_GROUPS.map((group) => group.id),
        ignoredText: "",
        ignoredHits: [],
        undoSnapshot: null,
      };
    }
  }

  const initialViewState = window.XhsRadarViewState.loadViewState(localStorage);
  const state = {
    connected: false,
    loggedIn: false,
    username: "",
    connectionProblem: "",
    statusChecking: false,
    workspaceView: initialViewState?.workspaceView || "discover",
    wordCheck: { ...loadWordCheckDraft(), locateCursors: new Map() },
    keyword: "",
    mode: initialViewState?.mode || "keyword",
    items: [],
    comparison: null,
    comparing: false,
    selected: null,
    detail: null,
    detailCache: new Map(),
    signals: [],
    draft: null,
    localSort: "platform",
    loadingDetail: false,
    expandedComments: false,
    analyzing: false,
    analysisRun: 0,
    analysisProgress: null,
    analysisDisplay: null,
    analysisResult: null,
    accountOpen: false,
    accountProgress: null,
    accountResult: null,
    accountRunning: false,
    accountRun: 0,
    detailTab: "note",
    detailRun: 0,
    searchRun: 0,
    searchStatus: null,
    lastQuery: null,
    candidates: null,
    pickerOpen: false,
    views: initialViewState?.views || {},
    qrLoading: false,
    ideas: readLocalRecords("xhs-radar-ideas"),
    reviews: readLocalRecords("xhs-radar-reviews"),
    ideaEditId: null,
    reviewEditId: null,
    snapshotReviewId: null,
    snapshotEditId: null,
  };
  let toastTimer;
  let storageWarningShown = false;
  let restoringViewState = false;
  let qrController;
  let analysisController;
  let accountController;
  const viewFields = [
    "keyword", "items", "comparison", "comparing", "selected", "detail", "detailCache",
    "signals", "draft", "localSort", "expandedComments", "analysisProgress", "analysisDisplay",
    "analysisResult", "accountOpen", "accountProgress", "accountResult",
    "detailTab", "searchStatus", "lastQuery", "candidates", "pickerOpen",
  ];

  function saveView(mode) {
    const view = {};
    for (const key of viewFields) view[key] = state[key];
    view.title = $("results-title").textContent;
    view.meta = $("result-meta").textContent;
    view.source = $("result-source").textContent;
    view.analysisStatus = $("analysis-status").textContent;
    view.analysisError = $("analysis-status").classList.contains("is-error");
    view.accountStatus = $("account-status").textContent;
    view.accountError = $("account-status").classList.contains("is-error");
    view.sort = $("sort").value;
    view.time = $("time").value;
    view.formKeyword = mode === "keyword"
      ? $("keyword").value
      : state.views.keyword?.formKeyword || "";
    view.formProfileName = mode === "profile"
      ? $("profile-name").value
      : state.views.profile?.formProfileName || "";
    view.detailOpen = $("workspace").classList.contains("has-selection");
    view.videoFile = $("video-file").files[0] || null;
    state.views[mode] = view;
    persistViewState();
  }

  function persistViewState() {
    if (restoringViewState) return;
    const saved = window.XhsRadarViewState.saveViewState(localStorage, {
      mode: state.mode,
      workspaceView: state.workspaceView,
      views: state.views,
    });
    if (!saved && !storageWarningShown) {
      storageWarningShown = true;
      toast("浏览器本机存储空间不足，当前搜索内容无法完整保存");
    }
  }

  function persistActiveView() {
    if (restoringViewState) return;
    saveView(state.mode);
  }

  function restoreView(mode) {
    const view = state.views[mode];
    if (view) {
      for (const key of viewFields) state[key] = view[key];
      $("results-title").textContent = view.title;
      $("result-meta").textContent = view.meta;
      $("result-source").textContent = view.source;
      $("analysis-status").textContent = view.analysisStatus;
      $("analysis-status").classList.toggle("is-error", view.analysisError);
      $("account-status").textContent = view.accountStatus;
      $("account-status").classList.toggle("is-error", view.accountError);
      $("sort").value = view.sort;
      $("time").value = view.time;
      $("workspace").classList.toggle("has-selection", view.detailOpen);
    } else {
      for (const key of viewFields) state[key] = {
        keyword: "", items: [], comparison: null, comparing: false, selected: null,
        detail: null, detailCache: new Map(), signals: [], draft: null, localSort: "platform",
        expandedComments: false, analysisProgress: null, analysisDisplay: null, analysisResult: null,
        accountOpen: false, accountProgress: null, accountResult: null,
        detailTab: "note", searchStatus: null, lastQuery: null, candidates: null, pickerOpen: false,
      }[key];
      $("results-title").textContent = mode === "profile" ? "对标账号" : "视频发现";
      $("result-meta").textContent = "仅显示视频笔记";
      $("result-source").textContent = mode === "profile" ? "仅当前主页可见笔记" : "数据来自当前搜索结果";
      $("workspace").classList.remove("has-selection");
      $("account-status").textContent = "点击“分析账号”开始";
      $("account-status").classList.remove("is-error");
    }
    $("keyword").value = view?.formKeyword || "";
    $("profile-name").value = view?.formProfileName || "";
    if (view?.sort) $("sort").value = view.sort;
    if (view?.time) $("time").value = view.time;
    const files = new DataTransfer();
    if (view?.videoFile) files.items.add(view.videoFile);
    $("video-file").files = files.files;
    $("video-name").textContent = view?.videoFile?.name || "选择 MP4 / MOV 文件";
  }

  function renderSearchStatus() {
    const status = state.searchStatus;
    const box = $("search-status");
    box.hidden = !status;
    box.classList.toggle("is-loading", status?.kind === "loading");
    box.classList.toggle("is-error", status?.kind === "error");
    if (status) {
      const seconds = status.kind === "loading" ? ` · 已等待 ${Math.floor((Date.now() - status.startedAt) / 1000)} 秒` : "";
      $("search-status-text").textContent = `${status.text}${seconds}`;
    }
    $("results").setAttribute("aria-busy", String(status?.kind === "loading"));
    $("search-button").disabled = status?.kind === "loading";
    $("refresh-results").disabled = !state.lastQuery || status?.kind === "loading";
    $("account-picker").setAttribute("aria-busy", String(status?.kind === "loading"));
  }

  function renderAnalysisProgress() {
    const display = state.analysisDisplay;
    const box = $("analysis-progress");
    box.hidden = !display;
    if (!display) return;
    const total = display.videosTotal + display.batchesTotal + 1;
    const completed = display.readCount + display.batchesDone + (display.phase === "done" ? 1 : 0);
    const phase = {
      reading: "读取评论", model: "模型归纳", synthesis: "综合选题", done: "分析完成",
    }[display.phase];
    const count = display.phase === "reading" ? `${display.readCount}/${display.videosTotal} 条视频`
      : display.phase === "model" ? `${display.batchesDone}/${display.batchesTotal} 批`
        : display.phase === "done" ? `${display.videosTotal} 条视频` : "生成建议中";
    const seconds = Math.floor(((display.active ? Date.now() - display.startedAt : display.elapsed) || 0) / 1000);
    $("analysis-progress-stage").textContent = display.active || display.phase === "done" ? phase : `已暂停 · ${phase}`;
    $("analysis-progress-count").textContent = count;
    $("analysis-progress-steps").textContent = `已完成步骤 ${completed}/${total} · 非时间估算`;
    $("analysis-progress-time").textContent = `已用时 ${seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`}`;
    const bar = $("analysis-progress-bar");
    bar.max = total;
    bar.value = completed;
    bar.setAttribute("aria-valuetext", `${phase} ${count}，已完成步骤 ${completed}/${total}`);
  }

  function pauseAnalysisDisplay() {
    if (!state.analysisDisplay?.active) return;
    state.analysisDisplay.elapsed = Date.now() - state.analysisDisplay.startedAt;
    state.analysisDisplay.active = false;
    renderAnalysisProgress();
  }

  function renderAccountPicker() {
    const data = state.candidates;
    $("account-picker").hidden = state.mode !== "profile" || !state.pickerOpen || !data;
    if (!data || state.mode !== "profile" || !state.pickerOpen) return;
    const exactCount = data.matches.filter((candidate) => candidate.exact).length;
    $("account-picker-title").textContent = `“${data.name}”候选账号 · 精确同名 ${exactCount} 位`;
    const list = document.createDocumentFragment();
    for (const candidate of data.matches) {
      const row = node("div", "account-candidate");
      if (candidate.avatar && /^https:\/\//.test(candidate.avatar)) {
        const image = node("img", "account-avatar");
        image.src = candidate.avatar;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
          const fallback = node("span", "account-avatar account-avatar-fallback");
          fallback.append(icon("user-round"));
          image.replaceWith(fallback);
          icons();
        }, { once: true });
        row.append(image);
      } else {
        const fallback = node("span", "account-avatar account-avatar-fallback");
        fallback.append(icon("user-round"));
        row.append(fallback);
      }
      const info = node("span", "account-info");
      info.append(node("strong", "", candidate.nickname), node("small", "", `账号 ID：${candidate.userId}`));
      if (candidate.exact) info.append(node("span", "account-match", "名称完全一致"));
      const choose = node("button", "button button-quiet", "查看视频");
      choose.type = "button";
      choose.setAttribute("aria-label", `查看 ${candidate.nickname}，账号 ID ${candidate.userId} 的视频`);
      choose.addEventListener("click", () => {
        state.pickerOpen = false;
        renderAccountPicker();
        startSearch({ userId: candidate.userId, xsecToken: candidate.xsecToken });
      });
      row.append(info, choose);
      list.append(row);
    }
    if (!data.matches.length) {
      list.append(node("p", "account-no-match", "当前公开笔记搜索中未找到对应账号；这不代表该账号不存在。可尝试更完整的名称。"));
    }
    $("account-candidates").replaceChildren(list);
    icons();
  }

  function node(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  function icon(name) {
    const element = node("i");
    element.setAttribute("data-lucide", name);
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 4800);
  }

  async function api(route, options = {}) {
    const response = await fetch(route, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `请求失败 (${response.status})`);
    return result;
  }

  function post(route, body, signal) {
    return api(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }

  function compact(value) {
    if (!value) return "0";
    return value >= 10000 ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, "")}万` : Number(value).toLocaleString("zh-CN");
  }

  function titleLength(title) {
    let units = 0;
    for (let index = 0; index < title.length; index++) {
      units += title.charCodeAt(index) > 127 ? 2 : 1;
    }
    return Math.ceil(units / 2);
  }

  function date(value) {
    if (!value) return "";
    const number = Number(value);
    const timestamp = number < 1e11 ? number * 1000 : number;
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(timestamp);
  }

  function snapshotTime(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(value));
  }

  function signed(value) {
    return `${value > 0 ? "+" : value < 0 ? "-" : ""}${compact(Math.abs(value))}`;
  }

  function empty(target, title, subtitle, symbol = "search-x") {
    const box = node("div", "empty-state");
    box.append(icon(symbol), node("strong", "", title));
    if (subtitle) box.append(node("span", "", subtitle));
    target.replaceChildren(box);
    icons();
  }

  function metric(symbol, value, label, extraClass = "") {
    const element = node("span", `metric ${extraClass}`.trim());
    element.title = `${label}：${Number(value).toLocaleString("zh-CN")}`;
    element.append(icon(symbol), node("span", "", compact(value)));
    return element;
  }

  function fallbackCover() {
    const fallback = node("span", "result-cover result-cover-fallback");
    fallback.append(icon("video"), node("span", "", "封面不可用"));
    return fallback;
  }

  function renderConnection() {
    const element = $("connection-status");
    element.className = `connection-status ${state.loggedIn ? "is-online" : state.connected ? "" : "is-error"}`;
    element.lastChild.textContent = state.loggedIn
      ? (state.username || "已连接") : state.connected ? "等待登录" : "连接中";
    $("login-button").disabled = !state.connected || state.loggedIn;
    $("login-button").title = state.loggedIn ? `已连接 ${state.username || "当前账号"}` : "扫码连接小红书";
    $("login-button").setAttribute("aria-label", state.loggedIn
      ? `已连接 ${state.username || "当前账号"}` : "连接小红书账号");
    $("setup-notice").hidden = state.workspaceView !== "discover" || state.connected;
    $("setup-message").textContent = state.connectionProblem || "正在准备小红书连接，首次启动可能需要下载浏览器。";
  }

  function readLocalRecords(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function storeLocalRecords(key, records) {
    try {
      localStorage.setItem(key, JSON.stringify(records));
      return true;
    } catch {
      toast("本机存储空间不足，未能保存这次修改");
      return false;
    }
  }

  function setWorkspaceView(view) {
    if (!["discover", "ideas", "reviews", "check"].includes(view)) return;
    state.workspaceView = view;
    const discover = view === "discover";
    $("search-band").hidden = !discover;
    $("account-picker").hidden = !discover || state.mode !== "profile" || !state.pickerOpen || !state.candidates;
    $("setup-notice").hidden = !discover || state.connected;
    $("workspace").hidden = !discover;
    $("ideas-view").hidden = view !== "ideas";
    $("reviews-view").hidden = view !== "reviews";
    $("word-check-view").hidden = view !== "check";
    for (const name of ["discover", "ideas", "reviews", "check"]) {
      const button = $(`view-${name}`);
      const selected = name === view;
      button.classList.toggle("is-active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (view === "ideas") renderIdeas();
    if (view === "reviews") renderReviews();
    document.title = `内容雷达 · ${{ discover: "发现", ideas: "选题库", reviews: "发布复盘", check: "文案筛查" }[view]}`;
    persistActiveView();
    icons();
  }

  function persistWordCheckDraft() {
    const text = $("word-check-text").value;
    state.wordCheck.text = text;
    try {
      localStorage.setItem(WORD_CHECK_STORAGE_KEY, JSON.stringify({
        text,
        checkedText: state.wordCheck.checkedText === text ? text : "",
        selectedPlatforms: state.wordCheck.selectedPlatforms,
        selectedGroups: state.wordCheck.selectedGroups,
        ignoredText: state.wordCheck.ignoredText === text ? text : "",
        ignoredHits: state.wordCheck.ignoredText === text ? state.wordCheck.ignoredHits : [],
        undoSnapshot: state.wordCheck.undoSnapshot,
      }));
      return true;
    } catch {
      if (!state.wordCheck.storageWarningShown) {
        state.wordCheck.storageWarningShown = true;
        toast("本机存储空间不足，文案筛查内容未能保存");
      }
      return false;
    }
  }

  function renderWordCheckPlatformOptions() {
    const list = $("word-check-platform-list");
    const fragment = document.createDocumentFragment();
    for (const platform of contentRisk.PLATFORMS) {
      const label = node("label", "word-check-platform-option");
      label.title = platform.label;
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.value = platform.id;
      checkbox.checked = state.wordCheck.selectedPlatforms.includes(platform.id);
      checkbox.setAttribute("aria-label", platform.label);
      const logo = node("img", "word-check-platform-logo");
      logo.src = `/platform-icons/${platform.icon}.svg`;
      logo.alt = "";
      logo.setAttribute("aria-hidden", "true");
      const selected = node("span", "word-check-platform-selected");
      selected.setAttribute("aria-hidden", "true");
      selected.append(icon("check"));
      label.append(checkbox, logo, node("span", "sr-only", platform.label), selected);
      fragment.append(label);
    }
    list.replaceChildren(fragment);
    icons();
  }

  function renderWordCheckGroupOptions() {
    const list = $("word-check-group-list");
    const fragment = document.createDocumentFragment();
    for (const group of contentRisk.RULE_GROUPS) {
      const label = node("label", "word-check-group-option");
      const checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.value = group.id;
      checkbox.checked = state.wordCheck.selectedGroups.includes(group.id);
      label.title = group.note || group.label;
      label.append(checkbox, node("span", "", group.label));
      fragment.append(label);
    }
    list.replaceChildren(fragment);
  }

  function renderWordCheckLegend() {
    const legend = $("word-check-legend");
    const fragment = document.createDocumentFragment();
    for (const category of Object.values(contentRisk.CATEGORIES)) {
      const item = node("span", "word-check-legend-item");
      item.append(node("span", `word-check-legend-swatch ${category.className}`, ""), node("span", "", category.label));
      fragment.append(item);
    }
    legend.replaceChildren(fragment);
  }

  function makeSourceLink(sourceId) {
    const source = contentRisk.SOURCES[sourceId];
    if (!source) return null;
    const link = node("a", "word-check-source-link", source.title);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function renderWordCheckSources() {
    const list = $("word-check-source-list");
    const fragment = document.createDocumentFragment();
    const legal = node("section", "word-check-source-group");
    legal.append(node("h3", "", "通用法律条目"));
    const legalLinks = node("div", "word-check-source-links");
    legalLinks.append(
      makeSourceLink("adLaw"),
      makeSourceLink("adGuide"),
      makeSourceLink("adEvidence"),
    );
    legal.append(legalLinks, node("p", "", "相关条目按商业广告场景提示；是否适用须结合实际内容和语境。"));
    fragment.append(legal);

    for (const platform of contentRisk.PLATFORMS) {
      const group = node("section", "word-check-source-group");
      group.append(node("h3", "", platform.label));
      const links = node("div", "word-check-source-links");
      for (const sourceId of platform.sources) links.append(makeSourceLink(sourceId));
      group.append(links, node("p", "", platform.scopeNote));
      fragment.append(group);
    }
    list.replaceChildren(fragment);
    $("word-check-source-date").textContent = `规则源核对：${contentRisk.CHECKED_AT}`;
    $("word-check-checked-date").dateTime = contentRisk.CHECKED_AT;
    $("word-check-checked-date").textContent = contentRisk.CHECKED_AT;
  }

  function renderWordCheckPreview(text, results) {
    const preview = $("word-check-preview");
    const fragment = document.createDocumentFragment();
    if (!text) {
      fragment.append(node("span", "word-check-placeholder", "筛查后将在这里显示文案及命中标记"));
      preview.replaceChildren(fragment);
      return;
    }

    const ranges = Array.isArray(results) ? contentRisk.highlights(results) : [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) fragment.append(document.createTextNode(text.slice(cursor, range.start)));
      const category = contentRisk.CATEGORIES[range.category];
      const mark = node("button", `risk-highlight ${category?.className || ""} word-check-preview-hit`, text.slice(range.start, range.end));
      mark.type = "button";
      mark.dataset.wordCheckStart = String(range.start);
      mark.dataset.wordCheckEnd = String(range.end);
      const categoryLabels = [...new Set([
        range.category,
        ...(range.categories || []),
      ])].map((key) => contentRisk.CATEGORIES[key]?.label).filter(Boolean);
      mark.title = "选中并定位到原文";
      mark.setAttribute("aria-label", `选中原文中的“${text.slice(range.start, range.end)}”，${categoryLabels.join("、")}，${range.level}`);
      fragment.append(mark);
      cursor = range.end;
    }
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    preview.replaceChildren(fragment);
  }

  function wordCheckHitKey(platformId, term) {
    return JSON.stringify([platformId, term]);
  }

  function wordCheckOccurrences(text, term) {
    if (!term) return [];
    const positions = [];
    for (let cursor = 0; cursor <= text.length - term.length;) {
      const start = text.indexOf(term, cursor);
      if (start < 0) break;
      positions.push(start);
      cursor = start + term.length;
    }
    return positions;
  }

  function scrollWordCheckRangeIntoView(editor, start, end) {
    const style = getComputedStyle(editor);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    marker.textContent = editor.value.slice(start, end);
    mirror.append(document.createTextNode(editor.value.slice(0, start)), marker);
    Object.assign(mirror.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: `${editor.clientWidth}px`,
      boxSizing: "border-box",
      padding: style.padding,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      whiteSpace: style.whiteSpace,
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      tabSize: style.tabSize,
      visibility: "hidden",
    });
    document.body.append(mirror);
    const markerTop = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
    editor.scrollTop = Math.max(0, markerTop - editor.clientHeight * 0.4);
    mirror.remove();
  }

  function selectWordCheckLocation(start, term, cursorKey) {
    const editor = $("word-check-text");
    const end = start + term.length;
    if (editor.value.slice(start, end) !== term) return -1;
    const positions = wordCheckOccurrences(editor.value, term);
    const occurrence = positions.indexOf(start);
    if (occurrence < 0) return -1;

    editor.focus();
    editor.setSelectionRange(start, end);
    editor.classList.add("has-located-selection");
    scrollWordCheckRangeIntoView(editor, start, end);
    if (cursorKey) state.wordCheck.locateCursors.set(cursorKey, occurrence);
    $("word-check-status").textContent = `已定位第 ${occurrence + 1} / ${positions.length} 处“${term}”`;
    return occurrence;
  }

  function locateNextWordCheckHit(term, platformId) {
    const editor = $("word-check-text");
    const positions = wordCheckOccurrences(editor.value, term);
    if (!positions.length) return;
    const key = wordCheckHitKey(platformId, term);
    const previous = state.wordCheck.locateCursors.get(key);
    const next = previous === undefined ? 0 : (previous + 1) % positions.length;
    selectWordCheckLocation(positions[next], term, key);
  }

  function renderWordCheckHit(hit, platformId, ignored) {
    const row = node("article", `word-check-hit${ignored ? " is-ignored" : ""}`);
    const head = node("div", "word-check-hit-head");
    const category = contentRisk.CATEGORIES[hit.category];
    head.append(
      node("mark", `risk-highlight ${category.className}`, hit.term),
      node("span", `risk-category ${category.className}`, category.label),
      node("span", "risk-level", hit.level),
      node("span", "word-check-occurrences", `出现 ${hit.count} 次`),
    );
    if (ignored) head.append(node("span", "word-check-ignored-label", "已忽略"));
    row.append(head, node("p", "word-check-hit-scope", `适用范围：${hit.scope}`));
    row.append(node("p", "word-check-hit-reason", hit.explanation));
    const links = node("div", "word-check-source-links");
    for (const sourceId of hit.sources) links.append(makeSourceLink(sourceId));
    row.append(links);

    const actions = node("div", "word-check-hit-actions");
    const addAction = (label, action) => {
      const button = node("button", "word-check-hit-action", label);
      button.type = "button";
      button.dataset.wordCheckAction = action;
      button.dataset.term = hit.term;
      button.dataset.platformId = platformId;
      actions.append(button);
    };
    if (ignored) {
      addAction("恢复提示", "restore-hit");
    } else {
      addAction("定位修改", "locate-hit");
      addAction("全部替换", "open-replace");
      addAction("忽略提示", "ignore-hit");
      const replace = node("div", "word-check-replace");
      replace.hidden = true;
      replace.dataset.term = hit.term;
      const input = node("input");
      input.type = "text";
      input.maxLength = 20000;
      input.placeholder = "输入替换内容";
      input.setAttribute("aria-label", `将文案中所有“${hit.term}”替换为`);
      const apply = node("button", "word-check-hit-action", "确认替换");
      apply.type = "button";
      apply.dataset.wordCheckAction = "apply-replace";
      const cancel = node("button", "word-check-hit-action", "取消");
      cancel.type = "button";
      cancel.dataset.wordCheckAction = "cancel-replace";
      replace.append(input, apply, cancel);
      actions.append(replace);
    }
    row.append(actions);
    return row;
  }

  function renderWordCheckResults() {
    const text = state.wordCheck.checkedText;
    const platformIds = state.wordCheck.selectedPlatforms;
    const status = $("word-check-status");
    status.classList.remove("is-error");
    const resultList = $("word-check-results");
    resultList.replaceChildren();
    $("word-check-undo").hidden = !state.wordCheck.undoSnapshot;

    if (!text) {
      const draft = $("word-check-text").value;
      renderWordCheckPreview(draft, null);
      status.textContent = draft
        ? "文案已修改，点击“开始筛查”更新结果"
        : "输入文案并选择平台和词库范围";
      return;
    }
    if (!platformIds.length) {
      renderWordCheckPreview(text, []);
      status.textContent = "请至少选择一个平台";
      status.classList.add("is-error");
      return;
    }
    if (!state.wordCheck.selectedGroups.length) {
      renderWordCheckPreview(text, []);
      status.textContent = "请至少选择一个词库范围";
      status.classList.add("is-error");
      return;
    }

    const allResults = contentRisk.scan(text, platformIds, state.wordCheck.selectedGroups);
    const ignoredHits = new Set(state.wordCheck.ignoredText === text ? state.wordCheck.ignoredHits : []);
    const results = allResults.map((result) => ({
      ...result,
      hits: result.hits.filter((hit) => !ignoredHits.has(wordCheckHitKey(result.platform.id, hit.term))),
    }));
    const matchedTerms = results.reduce((total, result) => total + result.hits.length, 0);
    const matchedOccurrences = results.reduce(
      (total, result) => total + result.hits.reduce((count, hit) => count + hit.count, 0),
      0,
    );
    const ignoredCount = allResults.reduce(
      (total, result) => total + result.hits.filter((hit) => ignoredHits.has(wordCheckHitKey(result.platform.id, hit.term))).length,
      0,
    );
    status.textContent = matchedTerms
      ? `完成 · ${results.length} 个平台 · ${matchedTerms} 项平台命中 · ${matchedOccurrences} 处${ignoredCount ? ` · 已忽略 ${ignoredCount} 项` : ""}`
      : ignoredCount
        ? `完成 · ${results.length} 个平台 · 已忽略 ${ignoredCount} 项提示`
        : `完成 · ${results.length} 个平台 · 未命中已收录的明确词条`;
    renderWordCheckPreview(text, results);

    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const group = node("section", "word-check-platform-result");
      const heading = node("div", "word-check-result-heading");
      const originalResult = allResults.find((entry) => entry.platform.id === result.platform.id);
      heading.append(
        node("h3", "", result.platform.label),
        node(
          "span",
          "word-check-result-count",
          result.hits.length
            ? `${result.hits.length} 项 · ${result.hits.reduce((count, hit) => count + hit.count, 0)} 处`
            : originalResult?.hits.length
              ? `已忽略 ${originalResult.hits.length} 项`
              : "未命中",
        ),
      );
      group.append(heading);
      group.append(node("p", "word-check-platform-note", result.platform.scopeNote));
      if (result.hits.length) {
        const hits = node("div", "word-check-hit-list");
        for (const hit of result.hits) hits.append(renderWordCheckHit(hit, result.platform.id, false));
        group.append(hits);
      } else if (originalResult?.hits.length) {
        const hits = node("div", "word-check-hit-list");
        const hiddenHits = originalResult.hits
          .filter((hit) => ignoredHits.has(wordCheckHitKey(result.platform.id, hit.term)));
        for (const hit of hiddenHits) hits.append(renderWordCheckHit(hit, result.platform.id, true));
        group.append(hits);
      } else {
        group.append(node("p", "word-check-no-hit", "未命中当前收录的明确词条；不代表平台审核通过。"));
      }
      fragment.append(group);
    }
    resultList.replaceChildren(fragment);
  }

  function initializeWordCheck() {
    $("word-check-text").value = state.wordCheck.text;
    renderWordCheckPlatformOptions();
    renderWordCheckGroupOptions();
    renderWordCheckLegend();
    renderWordCheckSources();
    $("word-check-length").textContent = `${state.wordCheck.text.length.toLocaleString("zh-CN")} / 20000`;
    renderWordCheckResults();

    $("word-check-platform-list").addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== "checkbox") return;
      state.wordCheck.selectedPlatforms = [...$("word-check-platform-list").querySelectorAll("input:checked")]
        .map((input) => input.value);
      persistWordCheckDraft();
      if (state.wordCheck.checkedText && state.wordCheck.checkedText === $("word-check-text").value) {
        renderWordCheckResults();
      } else {
        $("word-check-status").textContent = "平台选择已更新，输入文案后开始筛查";
      }
    });
    $("word-check-group-list").addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== "checkbox") return;
      state.wordCheck.selectedGroups = [...$("word-check-group-list").querySelectorAll("input:checked")]
        .map((input) => input.value);
      persistWordCheckDraft();
      if (state.wordCheck.checkedText && state.wordCheck.checkedText === $("word-check-text").value) {
        renderWordCheckResults();
      } else {
        $("word-check-status").textContent = "词库范围已更新，点击“开始筛查”查看结果";
      }
    });
    $("word-check-text").addEventListener("input", () => {
      $("word-check-text").classList.remove("has-located-selection");
      state.wordCheck.locateCursors.clear();
      $("word-check-length").textContent = `${$("word-check-text").value.length.toLocaleString("zh-CN")} / 20000`;
      state.wordCheck.checkedText = "";
      state.wordCheck.ignoredText = "";
      state.wordCheck.ignoredHits = [];
      state.wordCheck.undoSnapshot = null;
      persistWordCheckDraft();
      renderWordCheckResults();
    });
    $("word-check-preview").addEventListener("click", (event) => {
      const target = event.target.closest("button[data-word-check-start]");
      if (!target) return;
      const start = Number(target.dataset.wordCheckStart);
      const end = Number(target.dataset.wordCheckEnd);
      const editor = $("word-check-text");
      if (editor.value.slice(start, end) !== target.textContent) return;
      selectWordCheckLocation(start, target.textContent);
    });
    $("word-check-results").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-word-check-action]");
      if (!button) return;
      const action = button.dataset.wordCheckAction;
      const term = button.dataset.term || button.closest(".word-check-replace")?.dataset.term || "";
      const platformId = button.dataset.platformId || "";
      const editor = $("word-check-text");

      if (action === "locate-hit") {
        locateNextWordCheckHit(term, platformId);
      } else if (action === "ignore-hit" || action === "restore-hit") {
        const key = wordCheckHitKey(platformId, term);
        const ignored = new Set(state.wordCheck.ignoredHits);
        if (action === "ignore-hit") ignored.add(key);
        else ignored.delete(key);
        state.wordCheck.ignoredHits = [...ignored];
        state.wordCheck.ignoredText = state.wordCheck.checkedText;
        persistWordCheckDraft();
        renderWordCheckResults();
      } else if (action === "open-replace") {
        const panel = button.closest(".word-check-hit").querySelector(".word-check-replace");
        panel.hidden = false;
        panel.querySelector("input").focus();
      } else if (action === "cancel-replace") {
        button.closest(".word-check-replace").hidden = true;
      } else if (action === "apply-replace") {
        const panel = button.closest(".word-check-replace");
        const replacement = panel.querySelector("input").value;
        const currentText = editor.value;
        const result = contentRisk.replaceAllLiteral(currentText, panel.dataset.term, replacement);
        if (!result.count) return;
        if (result.text.length > 20000) {
          $("word-check-status").textContent = "替换后的文案超过 20000 字，请缩短替换内容";
          $("word-check-status").classList.add("is-error");
          return;
        }
        state.wordCheck.undoSnapshot = {
          text: currentText,
          checkedText: state.wordCheck.checkedText,
          ignoredText: state.wordCheck.ignoredText,
          ignoredHits: [...state.wordCheck.ignoredHits],
        };
        editor.value = result.text;
        editor.classList.remove("has-located-selection");
        state.wordCheck.locateCursors.clear();
        state.wordCheck.checkedText = "";
        state.wordCheck.ignoredText = "";
        state.wordCheck.ignoredHits = [];
        $("word-check-length").textContent = `${result.text.length.toLocaleString("zh-CN")} / 20000`;
        persistWordCheckDraft();
        renderWordCheckResults();
        $("word-check-status").textContent = `已替换 ${result.count} 处，可撤销或重新筛查`;
      }
    });
    $("word-check-run").addEventListener("click", () => {
      const text = $("word-check-text").value;
      if (!text.trim()) {
        $("word-check-status").textContent = "请先输入或粘贴要筛查的文案";
        $("word-check-status").classList.add("is-error");
        $("word-check-text").focus();
        return;
      }
      if (!state.wordCheck.selectedPlatforms.length) {
        $("word-check-status").textContent = "请至少选择一个平台";
        $("word-check-status").classList.add("is-error");
        return;
      }
      if (!state.wordCheck.selectedGroups.length) {
        $("word-check-status").textContent = "请至少选择一个词库范围";
        $("word-check-status").classList.add("is-error");
        return;
      }
      state.wordCheck.checkedText = text;
      persistWordCheckDraft();
      renderWordCheckResults();
    });
    $("word-check-select-all").addEventListener("click", () => {
      state.wordCheck.selectedPlatforms = contentRisk.PLATFORMS.map((platform) => platform.id);
      renderWordCheckPlatformOptions();
      persistWordCheckDraft();
      if (state.wordCheck.checkedText === $("word-check-text").value) renderWordCheckResults();
    });
    $("word-check-clear-platforms").addEventListener("click", () => {
      state.wordCheck.selectedPlatforms = [];
      renderWordCheckPlatformOptions();
      persistWordCheckDraft();
      renderWordCheckResults();
    });
    $("word-check-select-all-groups").addEventListener("click", () => {
      state.wordCheck.selectedGroups = contentRisk.RULE_GROUPS.map((group) => group.id);
      renderWordCheckGroupOptions();
      persistWordCheckDraft();
      renderWordCheckResults();
    });
    $("word-check-clear-groups").addEventListener("click", () => {
      state.wordCheck.selectedGroups = [];
      renderWordCheckGroupOptions();
      persistWordCheckDraft();
      renderWordCheckResults();
    });
    $("word-check-clear").addEventListener("click", () => {
      $("word-check-text").value = "";
      $("word-check-text").classList.remove("has-located-selection");
      state.wordCheck.locateCursors.clear();
      state.wordCheck.checkedText = "";
      state.wordCheck.ignoredText = "";
      state.wordCheck.ignoredHits = [];
      state.wordCheck.undoSnapshot = null;
      persistWordCheckDraft();
      $("word-check-length").textContent = "0 / 20000";
      renderWordCheckResults();
      $("word-check-text").focus();
    });
    $("word-check-undo").addEventListener("click", () => {
      const snapshot = state.wordCheck.undoSnapshot;
      if (!snapshot) return;
      $("word-check-text").value = snapshot.text;
      $("word-check-text").classList.remove("has-located-selection");
      state.wordCheck.locateCursors.clear();
      state.wordCheck.checkedText = snapshot.checkedText;
      state.wordCheck.ignoredText = snapshot.ignoredText;
      state.wordCheck.ignoredHits = [...snapshot.ignoredHits];
      state.wordCheck.undoSnapshot = null;
      $("word-check-length").textContent = `${snapshot.text.length.toLocaleString("zh-CN")} / 20000`;
      persistWordCheckDraft();
      renderWordCheckResults();
      $("word-check-text").focus();
    });
  }

  const IDEA_STAGES = {
    planned: "待拍",
    filming: "拍摄中",
    published: "已发布",
    paused: "暂不做",
  };
  const REVIEW_STAGES = { "24h": "发布后 24 小时", "7d": "发布后 7 天", custom: "其他记录" };
  const REVIEW_METRICS = [
    ["views", "播放量"],
    ["likes", "点赞"],
    ["saves", "收藏"],
    ["comments", "评论"],
    ["follows", "新增粉丝"],
  ];

  function localDateTime(value = new Date()) {
    const dateValue = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateValue.getTime())) return "";
    return new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const dateValue = new Date(value);
    if (Number.isNaN(dateValue.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(dateValue);
  }

  function formatMetric(value) {
    return Number.isFinite(value) ? Math.trunc(value).toLocaleString("zh-CN") : "—";
  }

  function renderIdeas() {
    const list = $("ideas-list");
    const filter = $("ideas-status-filter").value;
    const query = $("ideas-search").value.trim().toLocaleLowerCase();
    const ideas = state.ideas.filter((idea) => {
      const matchesStatus = filter === "all" || idea.status === filter;
      const text = [idea.title, idea.hook, idea.reason, idea.keyword].join(" ").toLocaleLowerCase();
      return matchesStatus && (!query || text.includes(query));
    }).sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
    const pending = state.ideas.filter((idea) => idea.status === "planned").length;
    $("ideas-summary").textContent = `${state.ideas.length} 个选题 · ${pending} 个待拍`;
    if (!ideas.length) {
      empty(list, state.ideas.length ? "没有符合条件的选题" : "选题库还是空的",
        state.ideas.length ? "试试其他关键词或状态。" : "分析评论后，可以把有证据的下一条视频建议保存到这里。",
        "notebook-pen");
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const idea of ideas) {
      const row = node("article", "idea-row");
      const head = node("div", "idea-row-head");
      const titleBlock = node("div", "idea-title-block");
      titleBlock.append(node("h2", "", idea.title || "未命名选题"));
      const sourceParts = [];
      if (idea.keyword) sourceParts.push(`关键词：${idea.keyword}`);
      if (idea.sourceVideos) sourceParts.push(`分析 ${idea.sourceVideos} 条视频`);
      if (idea.sourceComments) sourceParts.push(`${idea.sourceComments} 条评论样本`);
      sourceParts.push(`保存于 ${formatDateTime(idea.createdAt)}`);
      titleBlock.append(node("p", "idea-meta", sourceParts.join(" · ")));
      head.append(titleBlock);
      const controls = node("div", "idea-controls");
      const status = node("select", "idea-status");
      status.setAttribute("aria-label", `“${idea.title}”的状态`);
      for (const [value, label] of Object.entries(IDEA_STAGES)) {
        const option = node("option", "", label);
        option.value = value;
        status.append(option);
      }
      status.value = IDEA_STAGES[idea.status] ? idea.status : "planned";
      status.addEventListener("change", () => {
        idea.status = status.value;
        idea.updatedAt = new Date().toISOString();
        storeLocalRecords("xhs-radar-ideas", state.ideas);
        renderIdeas();
      });
      controls.append(status);
      const edit = node("button", "icon-button", "");
      edit.type = "button";
      edit.title = "编辑选题";
      edit.setAttribute("aria-label", `编辑选题：${idea.title}`);
      edit.append(icon("pencil"));
      edit.addEventListener("click", () => openIdeaDialog(idea));
      const remove = node("button", "icon-button idea-remove", "");
      remove.type = "button";
      remove.title = "删除选题";
      remove.setAttribute("aria-label", `删除选题：${idea.title}`);
      remove.append(icon("trash-2"));
      remove.addEventListener("click", () => {
        if (!window.confirm(`确定删除选题“${idea.title}”吗？关联的作品复盘不会删除。`)) return;
        state.ideas = state.ideas.filter((entry) => entry.id !== idea.id);
        storeLocalRecords("xhs-radar-ideas", state.ideas);
        renderIdeas();
      });
      controls.append(edit, remove);
      head.append(controls);
      row.append(head);
      if (idea.hook) row.append(node("p", "idea-hook", `开场：${idea.hook}`));
      if (idea.outline?.length) {
        const outline = node("ol", "idea-outline");
        idea.outline.forEach((line) => outline.append(node("li", "", line)));
        row.append(outline);
      }
      if (idea.reason) row.append(node("p", "idea-reason", `依据：${idea.reason}`));
      if (idea.evidence?.length) {
        const evidence = node("div", "idea-evidence");
        evidence.append(node("strong", "", `评论证据（${idea.evidence.length} 条）`));
        idea.evidence.forEach((entry) => {
          const quote = node("blockquote", "", `“${entry.text}”`);
          quote.append(node("small", "", `来源：${entry.title || "视频"} · 评论原文摘录`));
          evidence.append(quote);
        });
        row.append(evidence);
      }
      const actions = node("div", "idea-row-actions");
      const review = node("button", "text-action", "记录发布");
      review.type = "button";
      review.addEventListener("click", () => openReviewDialog({ topicId: idea.id, title: idea.title }));
      actions.append(review);
      row.append(actions);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    icons();
  }

  function openIdeaDialog(idea = null) {
    state.ideaEditId = idea?.id || null;
    $("idea-dialog-title").textContent = idea ? "编辑选题" : "新建选题";
    $("idea-title").value = idea?.title || "";
    $("idea-hook").value = idea?.hook || "";
    $("idea-outline").value = (idea?.outline || []).join("\n");
    $("idea-reason").value = idea?.reason || "";
    $("idea-keyword").value = idea?.keyword || "";
    $("idea-dialog").showModal();
  }

  function saveCurrentSuggestion() {
    const result = state.analysisResult;
    const next = result?.nextVideo;
    const title = String(next?.title || "").trim();
    if (!title) return toast("当前分析没有足够证据形成可保存的选题");
    const existing = state.ideas.find((idea) => idea.title === title && idea.keyword === state.keyword);
    if (existing) {
      setWorkspaceView("ideas");
      return toast("这个选题已在选题库中");
    }
    const evidence = [];
    const seen = new Set();
    for (const theme of result.themes || []) {
      for (const example of theme.examples || []) {
        const key = `${example.noteId}:${example.text}`;
        if (!example.text || seen.has(key)) continue;
        seen.add(key);
        evidence.push({
          text: String(example.text).slice(0, 180),
          title: String(example.noteTitle || "来源视频").slice(0, 100),
        });
        if (evidence.length >= 4) break;
      }
      if (evidence.length >= 4) break;
    }
    const now = new Date().toISOString();
    state.ideas.unshift({
      id: crypto.randomUUID(),
      title,
      hook: String(next.hook || "").slice(0, 240),
      outline: (next.outline || []).slice(0, 5).map((line) => String(line).slice(0, 240)),
      reason: String(next.reason || "").slice(0, 300),
      keyword: String(state.keyword || "").slice(0, 80),
      sourceVideos: Number(result.coverage?.totalVideos) || 0,
      sourceComments: Number(result.coverage?.comments) || 0,
      evidence,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    });
    if (!storeLocalRecords("xhs-radar-ideas", state.ideas)) {
      state.ideas.shift();
      return;
    }
    setWorkspaceView("ideas");
    toast("选题已保存");
  }

  function openReviewDialog({ review = null, topicId = "", title = "", publishedAt = "" } = {}) {
    state.reviewEditId = review?.id || null;
    $("review-dialog-title").textContent = review ? "编辑作品记录" : "记录已发布作品";
    $("review-title").value = review?.title || title;
    $("review-published-at").value = localDateTime(review?.publishedAt || publishedAt || new Date());
    $("review-link").value = review?.url || "";
    const select = $("review-topic");
    select.replaceChildren(node("option", "", "不关联选题"));
    select.firstElementChild.value = "";
    for (const idea of state.ideas) {
      const option = node("option", "", idea.title);
      option.value = idea.id;
      select.append(option);
    }
    select.value = review?.topicId || topicId || "";
    $("review-dialog").showModal();
  }

  function saveReviewMetadata(event) {
    event.preventDefault();
    const title = $("review-title").value.trim();
    const publishedAt = new Date($("review-published-at").value).toISOString();
    const rawUrl = $("review-link").value.trim();
    let url = "";
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
        url = parsed.href;
      } catch {
        return toast("作品链接需为有效的 http 或 https 地址");
      }
    }
    const topicId = $("review-topic").value;
    let review = state.reviews.find((entry) => entry.id === state.reviewEditId);
    if (review) {
      Object.assign(review, { title, publishedAt, url, topicId });
    } else {
      review = {
        id: crypto.randomUUID(), title, publishedAt, url, topicId,
        snapshots: [], createdAt: new Date().toISOString(),
      };
      state.reviews.unshift(review);
    }
    if (!storeLocalRecords("xhs-radar-reviews", state.reviews)) {
      state.reviews = readLocalRecords("xhs-radar-reviews");
      return;
    }
    if (topicId) {
      const idea = state.ideas.find((entry) => entry.id === topicId);
      if (idea) {
        idea.status = "published";
        idea.updatedAt = new Date().toISOString();
        storeLocalRecords("xhs-radar-ideas", state.ideas);
      }
    }
    $("review-dialog").close();
    renderIdeas();
    renderReviews();
    toast(state.reviewEditId ? "作品记录已更新" : "作品已加入复盘");
  }

  function openSnapshotDialog(reviewId, stage = "24h", snapshot = null) {
    const review = state.reviews.find((entry) => entry.id === reviewId);
    if (!review) return;
    state.snapshotReviewId = reviewId;
    state.snapshotEditId = snapshot?.id || null;
    const targetStage = snapshot?.stage || stage;
    $("snapshot-dialog-title").textContent = `${snapshot ? "更新" : "记录"}${REVIEW_STAGES[targetStage] || "作品"}数据`;
    $("snapshot-stage").value = targetStage;
    $("snapshot-stage").disabled = Boolean(snapshot);
    $("snapshot-recorded-at").value = localDateTime(snapshot?.recordedAt || new Date());
    for (const [key] of REVIEW_METRICS) {
      $(`snapshot-${key}`).value = snapshot?.metrics?.[key] ?? "";
    }
    $("snapshot-dialog").showModal();
  }

  function saveSnapshot(event) {
    event.preventDefault();
    const review = state.reviews.find((entry) => entry.id === state.snapshotReviewId);
    if (!review) return;
    const metrics = Object.fromEntries(REVIEW_METRICS.map(([key]) => {
      const raw = $(`snapshot-${key}`).value.trim();
      return [key, raw === "" ? null : Number(raw)];
    }));
    if (Object.values(metrics).every((value) => value === null)) {
      return toast("至少填写一项平台显示的数据");
    }
    if (Object.values(metrics).some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))) {
      return toast("数据请填写 0 或更大的整数");
    }
    const stage = $("snapshot-stage").value;
    const recordedAt = new Date($("snapshot-recorded-at").value).toISOString();
    review.snapshots ||= [];
    const existing = state.snapshotEditId
      ? review.snapshots.find((entry) => entry.id === state.snapshotEditId)
      : stage === "custom" ? null : review.snapshots.find((entry) => entry.stage === stage);
    if (existing) Object.assign(existing, { recordedAt, metrics });
    else review.snapshots.push({ id: crypto.randomUUID(), stage, recordedAt, metrics });
    review.snapshots.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    if (!storeLocalRecords("xhs-radar-reviews", state.reviews)) {
      state.reviews = readLocalRecords("xhs-radar-reviews");
      return;
    }
    $("snapshot-dialog").close();
    renderReviews();
    toast(existing ? "阶段数据已更新" : "复盘数据已保存");
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  function renderReviewSummary() {
    const stage = $("review-stage-filter").value;
    const summary = $("review-summary");
    const snapshots = state.reviews.flatMap((review) =>
      (review.snapshots || []).filter((entry) => entry.stage === stage));
    if (stage !== "24h" && stage !== "7d") {
      summary.replaceChildren(node("p", "review-summary-note",
        `${state.reviews.length} 条作品记录 · ${state.reviews.reduce((count, review) => count + (review.snapshots || []).length, 0)} 条数据快照。选择 24 小时或 7 天阶段查看同阶段中位数。`));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const [key, label] of [["views", "播放量中位数"], ["likes", "点赞中位数"], ["comments", "评论中位数"], ["follows", "新增粉丝中位数"]]) {
      const values = snapshots.map((entry) => entry.metrics?.[key]).filter(Number.isFinite);
      const stat = node("div", "review-stat");
      stat.append(node("span", "", label), node("strong", "", formatMetric(median(values))),
        node("small", "", `${values.length} 条作品已记录`));
      fragment.append(stat);
    }
    summary.replaceChildren(fragment);
  }

  function renderReviews() {
    renderReviewSummary();
    const list = $("reviews-list");
    if (!state.reviews.length) {
      empty(list, "还没有发布作品记录", "发布后添加作品，之后可补记 24 小时、7 天或其他阶段的数据。", "chart-no-axes-column");
      return;
    }
    const stage = $("review-stage-filter").value;
    const rows = [...state.reviews].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const fragment = document.createDocumentFragment();
    for (const review of rows) {
      const article = node("article", "review-row");
      const head = node("div", "review-row-head");
      const identity = node("div", "review-identity");
      const title = node("h2");
      if (review.url) {
        const link = node("a", "review-title-link", review.title);
        link.href = review.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        title.append(link);
      } else title.textContent = review.title;
      identity.append(title);
      const topic = state.ideas.find((idea) => idea.id === review.topicId);
      const meta = [`发布于 ${formatDateTime(review.publishedAt)}`];
      if (topic) meta.push(`选题：${topic.title}`);
      identity.append(node("p", "review-meta", meta.join(" · ")));
      head.append(identity);
      const actions = node("div", "review-actions");
      const record = node("button", "button button-quiet", "");
      record.type = "button";
      record.append(icon("plus"), node("span", "", stage === "all" ? "补记数据" : "记录阶段数据"));
      record.addEventListener("click", () => openSnapshotDialog(review.id, stage === "all" ? "24h" : stage));
      const edit = node("button", "icon-button", "");
      edit.type = "button";
      edit.title = "编辑作品信息";
      edit.setAttribute("aria-label", `编辑作品：${review.title}`);
      edit.append(icon("pencil"));
      edit.addEventListener("click", () => openReviewDialog({ review }));
      const remove = node("button", "icon-button idea-remove", "");
      remove.type = "button";
      remove.title = "删除作品记录";
      remove.setAttribute("aria-label", `删除作品记录：${review.title}`);
      remove.append(icon("trash-2"));
      remove.addEventListener("click", () => {
        if (!window.confirm(`确定删除“${review.title}”及其复盘数据吗？`)) return;
        state.reviews = state.reviews.filter((entry) => entry.id !== review.id);
        storeLocalRecords("xhs-radar-reviews", state.reviews);
        renderReviews();
      });
      actions.append(record, edit, remove);
      head.append(actions);
      article.append(head);
      const matching = (review.snapshots || []).filter((entry) => stage === "all"
        || (stage === "custom" ? entry.stage === "custom" : entry.stage === stage));
      if (!matching.length) {
        article.append(node("p", "review-empty", stage === "all" ? "还没有记录数据。" : `尚未记录${REVIEW_STAGES[stage]}数据。`));
      } else {
        const table = node("div", "snapshot-list");
        for (const snapshot of matching) {
          const row = node("div", "snapshot-row");
          const label = node("div", "snapshot-label");
          label.append(node("strong", "", REVIEW_STAGES[snapshot.stage] || "其他记录"),
            node("small", "", `记录于 ${formatDateTime(snapshot.recordedAt)} · 手动录入`));
          row.append(label);
          const metrics = node("div", "snapshot-metrics");
          for (const [key, metricLabel] of REVIEW_METRICS) {
            const cell = node("div", "snapshot-metric");
            cell.append(node("span", "", metricLabel), node("strong", "", formatMetric(snapshot.metrics?.[key])));
            metrics.append(cell);
          }
          row.append(metrics);
          const update = node("button", "text-action snapshot-edit", "修改");
          update.type = "button";
          update.addEventListener("click", () => openSnapshotDialog(review.id, snapshot.stage, snapshot));
          row.append(update);
          table.append(row);
        }
        article.append(table);
      }
      fragment.append(article);
    }
    list.replaceChildren(fragment);
    icons();
  }

  async function refreshStatus() {
    if (state.statusChecking) return null;
    state.statusChecking = true;
    $("check-login-status").disabled = true;
    $("refresh-qr").disabled = true;
    try {
      const status = await api("/api/status");
      state.connected = status.connected;
      if (status.connected) {
        state.loggedIn = status.loggedIn;
        state.username = status.loggedIn ? (status.username || state.username) : "";
      }
      state.connectionProblem = status.problem || "";
      renderConnection();
      if (status.loggedIn && $("login-dialog").open) {
        $("login-dialog").close();
        toast(`已连接 ${status.username || "小红书账号"}`);
      }
      return status;
    } catch {
      state.connected = false;
      state.connectionProblem = "状态暂不可用，已保留上次登录结果。可稍后手动检查。";
      renderConnection();
      return null;
    } finally {
      state.statusChecking = false;
      $("check-login-status").disabled = state.qrLoading;
      $("refresh-qr").disabled = state.qrLoading;
    }
  }

  async function showQr() {
    if (state.qrLoading) return;
    state.qrLoading = true;
    const controller = new AbortController();
    qrController = controller;
    let waitHintTimer;
    $("refresh-qr").disabled = true;
    $("check-login-status").disabled = true;
    const body = $("login-modal-body");
    body.setAttribute("role", "status");
    body.setAttribute("aria-live", "polite");
    body.replaceChildren(node("span", "spinner"), node("span", "",
      "正在获取二维码。如弹出小红书安全验证窗口，请在其中手动完成。"));
    waitHintTimer = setTimeout(() => {
      if (qrController === controller && state.qrLoading) {
        body.replaceChildren(node("span", "spinner"), node("span", "",
          "仍在等待小红书响应。请检查弹出的安全验证窗口，不要反复刷新二维码。"));
      }
    }, 30000);
    try {
      const data = await api("/api/login/qrcode", { signal: controller.signal });
      if (data.is_logged_in) {
        await refreshStatus();
        return;
      }
      if (!String(data.img).startsWith("data:image/png;base64,")) throw new Error("二维码格式无效");
      const image = node("img", "qr-image");
      image.src = data.img;
      image.alt = "小红书登录二维码";
      body.replaceChildren(image, node("span", "", "用小红书 App 扫码登录"));
    } catch (error) {
      if (!controller.signal.aborted) {
        body.setAttribute("role", "alert");
        body.replaceChildren(node("span", "", error.message));
      }
    } finally {
      clearTimeout(waitHintTimer);
      state.qrLoading = false;
      if (qrController === controller) qrController = null;
      $("refresh-qr").disabled = false;
      $("check-login-status").disabled = false;
    }
  }

  async function openLoginDialog() {
    if (state.qrLoading || state.statusChecking) return;
    $("login-dialog").showModal();
    const body = $("login-modal-body");
    body.setAttribute("role", "status");
    body.setAttribute("aria-live", "polite");
    body.replaceChildren(node("span", "spinner"), node("span", "", "正在检查已保存的登录状态"));
    const status = await refreshStatus();
    if (!$("login-dialog").open || status?.loggedIn) return;
    if (!status?.connected) {
      body.setAttribute("role", "alert");
      body.replaceChildren(node("span", "", status?.problem || state.connectionProblem ||
        "暂时无法确认登录状态。为避免重复触发验证，请稍后重试。"));
      return;
    }
    await showQr();
  }

  function orderedItems() {
    if (state.comparing && state.comparison) {
      return [...state.items].sort((a, b) => {
        const aChange = state.comparison.deltas[a.id];
        const bChange = state.comparison.deltas[b.id];
        if (!aChange) return bChange ? 1 : 0;
        if (!bChange) return -1;
        return bChange.heat - aChange.heat || b.heat - a.heat;
      });
    }
    return state.localSort === "heat"
      ? [...state.items].sort((a, b) => b.heat - a.heat)
      : state.items;
  }

  function renderResults() {
    $("account-button").hidden = state.mode !== "profile" || !state.items.length;
    $("result-count").textContent = state.items.length;
    const target = $("results");
    if (!state.items.length) {
      const profile = state.mode === "profile";
      empty(target, state.keyword ? "没有找到视频笔记" : profile ? "等待账号" : "等待搜索",
        state.keyword ? (profile ? "当前主页没有可见的视频笔记。" : "换个关键词或扩大时间范围。")
          : profile ? "输入账号名称并确认候选账号后读取。" : "选择一个关键词，查看相关视频。", "clapperboard");
      return;
    }
    const list = document.createDocumentFragment();
    orderedItems().forEach((item, index) => {
      const row = node("button", `result-row ${state.selected?.id === item.id ? "is-selected" : ""}`.trim());
      row.type = "button";
      row.setAttribute("aria-label", `${item.title}，${item.author}，点赞 ${item.stats.likes}`);
      row.append(node("span", "result-rank", String(index + 1).padStart(2, "0")));
      if (item.cover && /^https:\/\//.test(item.cover)) {
        const image = node("img", "result-cover");
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
          image.replaceWith(fallbackCover());
          icons();
        }, { once: true });
        image.src = item.cover;
        row.append(image);
      } else {
        row.append(fallbackCover());
      }
      const body = node("span", "result-body");
      body.append(node("span", "result-title", item.title), node("span", "result-author", item.author));
      const metrics = node("span", "result-metrics");
      metrics.append(
        metric("heart", item.stats.likes, "点赞"),
        metric("bookmark", item.stats.saves, "收藏"),
        metric("message-circle", item.stats.comments, "评论"),
        metric("flame", item.heat, "本地互动分：点赞 + 1.5 × 收藏 + 2.5 × 评论", "metric-heat"),
      );
      body.append(metrics);
      if (state.comparing) {
        const delta = state.comparison.deltas[item.id];
        const growth = node("span", `growth-line ${delta ? delta.heat > 0 ? "is-up" : delta.heat < 0 ? "is-down" : "" : "is-new"}`);
        if (delta) {
          growth.append(icon(delta.heat > 0 ? "trending-up" : delta.heat < 0 ? "trending-down" : "minus"),
            node("span", "", `互动分 ${signed(delta.heat)} · 赞 ${signed(delta.likes)} · 藏 ${signed(delta.saves)} · 评 ${signed(delta.comments)}`));
        } else {
          growth.append(icon("circle-plus"), node("span", "", "本次新见 · 无法计算增长"));
        }
        body.append(growth);
      }
      row.append(body);
      row.addEventListener("click", () => selectItem(item));
      list.append(row);
    });
    target.replaceChildren(list);
    icons();
  }

  function setLocalSort(sort) {
    state.localSort = sort;
    state.comparing = false;
    renderCompareControls();
    renderResults();
    if (state.detail) renderNote();
    persistActiveView();
  }

  function renderCompareControls() {
    const button = $("compare-button");
    button.disabled = !state.comparison;
    button.title = state.comparison
      ? `与 ${snapshotTime(state.comparison.previousAt)} 的同条件结果对比`
      : "首次搜索已保存记录；同条件再次搜索后可对比";
    button.setAttribute("aria-pressed", String(state.comparing));
    button.lastElementChild.textContent = state.comparing ? "退出对比" : "对比上次";
    for (const value of ["platform", "heat"]) {
      const sortButton = $(`sort-${value}`);
      const active = !state.comparing && value === state.localSort;
      sortButton.classList.toggle("is-active", active);
      sortButton.setAttribute("aria-pressed", String(active));
    }
    const summary = $("comparison-summary");
    summary.hidden = !state.comparing;
    if (state.comparing) {
      const result = state.comparison;
      summary.textContent = `${snapshotTime(result.previousAt)} → ${snapshotTime(result.currentAt)} · 可对比 ${result.matched} 条 · 本次新见 ${result.newCount} 条 · 上次出现但本次未入结果 ${result.missingCount} 条`;
    }
  }

  function toggleComparison() {
    if (!state.comparison) return;
    state.comparing = !state.comparing;
    renderCompareControls();
    renderResults();
    if (state.detail) renderNote();
    persistActiveView();
  }

  function applyModeControls(mode) {
    const profile = mode === "profile";
    for (const value of ["keyword", "profile"]) {
      const button = $(`mode-${value}`);
      button.classList.toggle("is-active", value === mode);
      button.setAttribute("aria-pressed", String(value === mode));
    }
    $("keyword-field").hidden = profile;
    $("keyword").disabled = profile;
    $("profile-field").hidden = !profile;
    $("profile-name").disabled = !profile;
    $("search-form").classList.toggle("is-profile", profile);
    document.querySelectorAll(".search-filter").forEach((field) => { field.hidden = profile; });
    $("search-button").lastElementChild.textContent = profile ? "查找账号" : "搜索视频";
    $("search-button").setAttribute("aria-label", profile ? "按名称查找对标账号" : "搜索视频");
  }

  function setMode(mode) {
    const changed = state.mode !== mode;
    if (changed) {
      saveView(state.mode);
      restoringViewState = true;
      state.searchRun++;
      state.analysisRun++;
      analysisController?.abort();
      state.accountRun++;
      accountController?.abort();
      if (state.accountRunning) {
        pauseAccount();
        state.views[state.mode].accountStatus = "分析已暂停，返回后可继续";
      }
      state.detailRun++;
      if (state.views[state.mode].searchStatus?.kind === "loading") {
        state.views[state.mode].searchStatus = { kind: "error", text: "读取已暂停，原结果已保留。点击刷新结果重试。" };
      }
      if (state.analyzing) {
        state.views[state.mode].analysisStatus = "分析已暂停，返回后可继续分析";
        pauseAnalysisDisplay();
      }
      state.analyzing = false;
      state.loadingDetail = false;
      restoreView(mode);
      resetDetail();
      if (state.selected) {
        $("source-link").hidden = false;
        $("source-link").href = `https://www.xiaohongshu.com/explore/${encodeURIComponent(state.selected.id)}?xsec_token=${encodeURIComponent(state.selected.xsecToken)}&xsec_source=pc_search`;
        if (state.detail) {
          renderNote();
          renderComments();
          if (state.draft) renderDraft();
          $("analyze-button").disabled = false;
          $("analyze-button").lastChild.textContent = state.analysisProgress ? "继续分析" : state.analysisResult ? "重新分析" : "开始分析";
          if (state.analysisResult) renderAnalysis(state.analysisResult);
        } else {
          $("note-content").replaceChildren(node("div", "detail-empty", "详情读取已中断，点击该视频重新读取"));
        }
        $("analysis-status").textContent = state.views[mode]?.analysisStatus || "先选择一条视频";
        $("analysis-status").classList.toggle("is-error", Boolean(state.views[mode]?.analysisError));
        selectTab(state.detailTab);
      } else {
        selectTab("note");
      }
      renderAnalysisProgress();
    }
    state.mode = mode;
    applyModeControls(mode);
    renderCompareControls();
    renderResults();
    renderSearchStatus();
    renderAccountPicker();
    renderAccountPane();
    if (changed) restoringViewState = false;
    persistViewState();
  }

  function renderRestoredState() {
    restoringViewState = true;
    try {
      restoreView(state.mode);
      applyModeControls(state.mode);
      resetDetail();
      if (state.selected) {
        $("source-link").hidden = false;
        $("source-link").href = `https://www.xiaohongshu.com/explore/${encodeURIComponent(state.selected.id)}?xsec_token=${encodeURIComponent(state.selected.xsecToken)}&xsec_source=pc_search`;
        if (state.detail) {
          renderNote();
          renderComments();
          if (state.draft) renderDraft();
        } else {
          $("note-content").replaceChildren(node("div", "detail-empty", "详情读取已中断，点击该视频重新读取"));
        }
        $("analyze-button").disabled = !state.detail;
        $("analyze-button").lastChild.textContent = state.analysisProgress
          ? "继续分析" : state.analysisResult ? "重新分析" : "开始分析";
        $("analysis-status").textContent = state.views[state.mode]?.analysisStatus || "先选择一条视频";
        $("analysis-status").classList.toggle("is-error", Boolean(state.views[state.mode]?.analysisError));
        if (state.analysisResult) renderAnalysis(state.analysisResult);
        selectTab(state.detailTab);
      } else {
        selectTab("note");
      }
      renderAnalysisProgress();
      renderCompareControls();
      renderResults();
      renderSearchStatus();
      renderAccountPicker();
      renderAccountPane();
      setWorkspaceView(state.workspaceView);
    } finally {
      restoringViewState = false;
    }
  }

  function search(event) {
    event.preventDefault();
    if (state.mode === "profile") {
      searchAccounts($("profile-name").value.trim());
    } else {
      startSearch({ keyword: $("keyword").value.trim(), sort: $("sort").value, time: $("time").value });
    }
  }

  async function searchAccounts(name) {
    if (!state.loggedIn) return toast("请先连接小红书账号");
    if (!name) return;
    const searchRun = ++state.searchRun;
    state.searchStatus = { kind: "loading", text: `正在按名称查找“${name}”的公开账号…`, startedAt: Date.now() };
    renderSearchStatus();
    try {
      const result = await post("/api/users/search", { name });
      if (searchRun !== state.searchRun || state.mode !== "profile") return;
      state.candidates = { name, matches: result.candidates };
      state.pickerOpen = true;
      const exact = result.candidates.filter((candidate) => candidate.exact).length;
      state.searchStatus = { kind: "done", text: `找到 ${result.candidates.length} 位候选账号，其中名称完全一致 ${exact} 位。请选择账号。` };
      renderAccountPicker();
      persistActiveView();
    } catch (error) {
      if (searchRun !== state.searchRun) return;
      state.searchStatus = { kind: "error", text: `查找账号失败：${error.message}。原结果已保留。` };
      toast(error.message);
      persistActiveView();
    } finally {
      if (searchRun === state.searchRun) renderSearchStatus();
    }
  }

  async function startSearch(query) {
    if (!state.loggedIn) return toast("请先连接小红书账号");
    if (state.mode === "keyword" && !query.keyword) return;
    if (state.mode === "profile" && (!query.userId || !query.xsecToken)) return toast("请先按名称选择账号");
    const mode = state.mode;
    const searchRun = ++state.searchRun;
    state.searchStatus = {
      kind: "loading",
      text: mode === "profile" ? "正在读取选中账号的公开主页…" : "正在搜索并读取前 50 条视频…",
      startedAt: Date.now(),
    };
    renderSearchStatus();
    try {
      const result = mode === "profile"
        ? await post("/api/profile", query)
        : await post("/api/search", query);
      if (searchRun !== state.searchRun) return;
      state.analysisRun++;
      analysisController?.abort();
      state.detailRun++;
      state.analyzing = false;
      state.analysisProgress = null;
      state.analysisDisplay = null;
      state.analysisResult = null;
      state.accountRun++;
      accountController?.abort();
      state.accountRunning = false;
      state.accountOpen = false;
      state.accountProgress = null;
      state.accountResult = null;
      state.selected = null;
      state.detail = null;
      state.detailCache = new Map();
      state.draft = null;
      $("video-file").value = "";
      $("video-name").textContent = "选择 MP4 / MOV 文件";
      state.comparing = false;
      state.keyword = mode === "profile" ? result.author : query.keyword;
      state.items = result.items;
      state.comparison = result.comparison;
      state.lastQuery = { ...query };
      state.searchStatus = {
        kind: "done",
        text: `已完成 · 读取 ${result.items.length} 条视频 · 耗时 ${Math.max(1, Math.ceil((Date.now() - state.searchStatus.startedAt) / 1000))} 秒`,
      };
      $("workspace").classList.remove("has-selection");
      resetDetail();
      selectTab("note");
      renderCompareControls();
      $("results-title").textContent = mode === "profile" ? result.author : "视频发现";
      const recordState = result.historyProblem ? "记录失败"
        : !result.items.length ? "无记录"
          : result.comparison ? "可对比上次" : "首次记录";
      $("result-meta").textContent = mode === "profile"
        ? `主页可见视频 ${result.items.length} · ${recordState}`
        : `视频 ${result.items.length} · 原始结果 ${result.sourceCount} · ${recordState}`;
      $("result-source").textContent = mode === "profile" ? "仅当前主页可见笔记" : "数据来自当前搜索结果";
      if (result.historyProblem) toast(result.historyProblem);
      renderResults();
      renderAccountPane();
      persistActiveView();
    } catch (error) {
      if (searchRun !== state.searchRun) return;
      state.searchStatus = { kind: "error", text: `读取失败：${error.message}。原结果已保留。` };
      toast(error.message);
      persistActiveView();
    } finally {
      if (searchRun === state.searchRun) renderSearchStatus();
    }
  }

  function resetDetail() {
    $("source-link").hidden = true;
    $("comment-tab-count").textContent = "";
    $("note-content").className = "detail-empty";
    $("comments-content").className = "detail-empty";
    $("note-content").replaceChildren(node("div", "detail-empty", "选择一条视频查看详情"));
    $("comments-content").replaceChildren(node("div", "detail-empty", "选择一条视频查看评论"));
    $("draft-intro").hidden = false;
    $("draft-editor").hidden = true;
    $("analyze-button").disabled = true;
    $("analyze-button").lastChild.textContent = "开始分析";
    $("stop-analysis").hidden = true;
    $("analysis-progress").hidden = true;
    $("analysis-status").textContent = "先选择一条视频";
    $("analysis-status").classList.remove("is-error");
    $("analysis-content").replaceChildren();
  }

  function selectTab(name) {
    state.detailTab = name;
    for (const value of ["note", "comments", "insights", "draft"]) {
      const tab = $(`tab-${value}`);
      const selected = value === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      $(`panel-${value}`).hidden = !selected;
    }
    $("panel-account").hidden = !state.accountOpen;
    persistActiveView();
  }

  function rememberSelectedDetail() {
    if (!state.selected || !state.detail) return;
    state.detailCache.set(state.selected.id, {
      detail: state.detail, signals: state.signals, draft: state.draft,
      expandedComments: state.expandedComments,
    });
    persistActiveView();
  }

  async function selectItem(item) {
    if (state.selected?.id === item.id && !state.accountOpen && (state.detail || state.loadingDetail)) {
      $("workspace").classList.add("has-selection");
      return;
    }
    rememberSelectedDetail();
    const cached = state.detailCache.get(item.id);
    const mode = state.mode;
    const detailRun = ++state.detailRun;
    state.analysisRun++;
    analysisController?.abort();
    state.analyzing = false;
    state.analysisProgress = null;
    state.analysisDisplay = null;
    state.analysisResult = null;
    state.accountRun++;
    accountController?.abort();
    pauseAccount();
    state.accountOpen = false;
    state.selected = item;
    state.detail = cached?.detail || null;
    state.signals = cached?.signals || [];
    state.draft = cached?.draft || null;
    $("video-file").value = "";
    $("video-name").textContent = "选择 MP4 / MOV 文件";
    state.expandedComments = cached?.expandedComments || false;
    $("workspace").classList.add("has-selection");
    renderResults();
    persistActiveView();
    resetDetail();
    selectTab("note");
    renderAccountPane();
    if (state.detail) {
      renderNote();
      renderComments();
      if (state.draft) renderDraft();
      $("analyze-button").disabled = false;
      $("analysis-status").textContent = `可综合当前结果前 ${Math.min(state.items.length, 50)} 条视频的公开评论，当前视频作重点对照`;
    } else {
      $("note-content").replaceChildren(node("div", "detail-empty", "正在读取笔记与公开评论…"));
    }
    $("source-link").hidden = false;
    $("source-link").href = `https://www.xiaohongshu.com/explore/${encodeURIComponent(item.id)}?xsec_token=${encodeURIComponent(item.xsecToken)}&xsec_source=pc_search`;
    if (state.detail && state.draft) {
      state.loadingDetail = false;
      return;
    }
    state.loadingDetail = !state.detail;
    try {
      const detail = state.detail || await post("/api/detail", { id: item.id, xsecToken: item.xsecToken });
      if (detailRun !== state.detailRun || mode !== state.mode) return;
      if (!state.detail) {
        state.detail = detail;
        syncSelectedStats(detail);
        renderResults();
        renderNote();
        renderComments();
        rememberSelectedDetail();
      }
      $("analyze-button").disabled = state.analyzing;
      $("analysis-status").textContent = `可综合当前结果前 ${Math.min(state.items.length, 50)} 条视频的公开评论，当前视频作重点对照`;
      const analysis = await post("/api/draft", { keyword: state.keyword, detail });
      if (detailRun !== state.detailRun || mode !== state.mode) return;
      state.signals = analysis.signals;
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(`xhs-radar-draft:${item.id}`));
      } catch {
        localStorage.removeItem(`xhs-radar-draft:${item.id}`);
      }
      state.draft = saved && typeof saved.title === "string" && typeof saved.content === "string"
        ? saved : analysis.draft;
      rememberSelectedDetail();
      renderNote();
      renderComments();
      renderDraft();
    } catch (error) {
      if (detailRun === state.detailRun && mode === state.mode) {
        if (!state.detail) $("note-content").replaceChildren(node("div", "detail-empty", error.message));
        toast(error.message);
        persistActiveView();
      }
    } finally {
      if (detailRun === state.detailRun) state.loadingDetail = false;
    }
  }

  function syncSelectedStats(detail) {
    const item = state.items.find((entry) => entry.id === state.selected?.id);
    if (!item) return;
    item.stats.comments = detail.stats.comments;
    item.heat = Math.round(item.stats.likes + item.stats.saves * 1.5 + item.stats.comments * 2.5);
  }

  function renderNote() {
    const detail = state.detail;
    const container = node("div", "note-summary");
    container.append(node("span", "detail-eyebrow", "视频笔记"), node("h3", "", detail.title));
    container.append(node("div", "note-byline", `${detail.author}${detail.publishedAt ? ` · ${date(detail.publishedAt)}` : ""}`));
    const stats = node("div", "stat-strip");
    for (const [label, value] of [["点赞", detail.stats.likes], ["收藏", detail.stats.saves], ["评论", detail.stats.comments]]) {
      const block = node("div");
      block.append(node("strong", "", compact(value)), node("span", "", label));
      stats.append(block);
    }
    container.append(stats, node("div", "section-label", "笔记内容"), node("p", "note-description", detail.description || "无文字描述"));
    if (state.comparing) {
      const delta = state.comparison?.deltas[state.selected.id];
      container.append(node("p", "note-byline", delta
        ? `较上次：互动分 ${signed(delta.heat)}，点赞 ${signed(delta.likes)}，收藏 ${signed(delta.saves)}，评论 ${signed(delta.comments)}`
        : "本次新见，暂无法计算增长。"));
    }
    const signals = node("div", "signal-section");
    signals.append(node("div", "section-label", "评论关注点"));
    const chips = node("div", "signal-list");
    if (state.signals.length) {
      state.signals.forEach((signal) => chips.append(node("span", "signal-chip", `${signal.label} ${signal.count}`)));
    } else {
      chips.append(node("span", "note-byline", "当前评论中暂无可归纳的问题"));
    }
    signals.append(chips);
    $("note-content").className = "";
    $("note-content").replaceChildren(container, signals);
  }

  function renderComments() {
    const detail = state.detail;
    const target = $("comments-content");
    target.className = "";
    $("comment-tab-count").textContent = compact(detail.stats.comments);
    const header = node("div", "comment-head");
    header.append(node("span", "section-label", `公开评论 ${compact(detail.stats.comments)} · 已载入 ${detail.comments.length} 条`));
    if (!detail.comments.length) {
      const placeholder = node("div");
      empty(placeholder, "暂无已载入评论", "这条笔记暂时没有读取到公开评论。", "message-circle");
      target.replaceChildren(header, placeholder);
      return;
    }
    const list = node("div", "comment-list");
    detail.comments.forEach((comment) => {
      const item = node("article", `comment ${comment.parentId ? "is-reply" : ""}`.trim());
      const top = node("div", "comment-top");
      if (comment.avatar && /^https:\/\//.test(comment.avatar)) {
        const image = node("img", "comment-avatar");
        image.src = comment.avatar;
        image.alt = "";
        image.loading = "lazy";
        top.append(image);
      } else {
        const fallback = node("span", "comment-avatar comment-avatar-fallback");
        fallback.append(icon("user-round"));
        top.append(fallback);
      }
      const person = node("span", "comment-person");
      person.append(node("span", "comment-name", comment.nickname), node("span", "comment-date", date(comment.createdAt)));
      top.append(person);
      if (comment.userId) {
        const profile = node("a", "icon-button comment-profile");
        profile.href = `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(comment.userId)}`;
        profile.target = "_blank";
        profile.rel = "noopener noreferrer";
        profile.title = `查看 ${comment.nickname} 的公开主页`;
        profile.setAttribute("aria-label", profile.title);
        profile.append(icon("external-link"));
        top.append(profile);
      }
      item.append(top, node("p", "comment-text", comment.text));
      list.append(item);
    });
    const parts = [header, list];
    if (detail.hasMoreComments && !state.expandedComments) {
      const more = node("button", "button button-quiet comment-more", "加载更多公开评论");
      more.type = "button";
      more.addEventListener("click", loadMoreComments);
      parts.push(more);
    }
    parts.push(node("div", "comment-note", "评论来自当前可见页面；数量可能少于笔记展示的总评论数。"));
    target.replaceChildren(...parts);
    icons();
  }

  async function loadMoreComments(event) {
    if (state.loadingDetail || !state.selected) return;
    const item = state.selected;
    const mode = state.mode;
    const detailRun = ++state.detailRun;
    state.loadingDetail = true;
    event.currentTarget.disabled = true;
    try {
      const detail = await post("/api/detail", { id: item.id, xsecToken: item.xsecToken, more: true });
      if (detailRun !== state.detailRun || mode !== state.mode) return;
      state.detail = detail;
      syncSelectedStats(detail);
      renderResults();
      state.expandedComments = true;
      rememberSelectedDetail();
      renderNote();
      renderComments();
      const analysis = await post("/api/draft", { keyword: state.keyword, detail });
      if (detailRun !== state.detailRun || mode !== state.mode) return;
      state.signals = analysis.signals;
      rememberSelectedDetail();
      renderNote();
    } catch (error) {
      if (detailRun === state.detailRun && mode === state.mode) {
        toast(error.message);
        event.currentTarget.disabled = false;
      }
    } finally {
      if (detailRun === state.detailRun) state.loadingDetail = false;
    }
  }

  function renderDraft() {
    $("draft-intro").hidden = true;
    $("draft-editor").hidden = false;
    $("draft-title").value = state.draft.title;
    $("draft-content").value = state.draft.content;
    $("video-name").textContent = $("video-file").files[0]?.name || "选择 MP4 / MOV 文件";
  }

  async function refreshModels() {
    const status = $("model-status");
    try {
      const data = await api("/api/models");
      const select = $("model-select");
      const names = [...new Set([data.selected, ...data.installed])];
      select.replaceChildren(...names.map((name) => {
        const option = node("option", "", `${name}${data.installed.includes(name) ? "" : "（未安装）"}`);
        option.value = name;
        option.disabled = !data.installed.includes(name);
        return option;
      }));
      select.value = data.selected;
      select.disabled = !data.connected || !data.installed.length;
      status.textContent = data.connected
        ? (data.installed.includes(data.selected) ? `当前使用 ${data.selected}` : "当前模型尚未下载，请在下方安装或切换")
        : data.problem;
      $("ollama-link").hidden = data.connected;
      const catalog = document.createDocumentFragment();
      for (const vram of [6, 12]) {
        catalog.append(node("div", "model-group-title", `RTX 3060 ${vram} GB 显存${vram === 12 ? "及以上" : "起步"}`));
        for (const entry of data.downloads.filter((item) => item.vram === vram)) {
          const row = node("div", "model-option");
          const label = node("span");
          const source = node("a", "model-source", entry.label);
          source.href = `https://ollama.com/library/${encodeURIComponent(entry.name)}`;
          source.target = "_blank";
          source.rel = "noopener noreferrer";
          source.title = `查看 ${entry.label} 官方模型页`;
          label.append(source, node("small", "", `${entry.name} · 下载约 ${entry.size} · ${entry.description}`));
          const installed = data.installed.includes(entry.name);
          const selected = data.selected === entry.name;
          const button = node("button", "button button-quiet", installed ? (selected ? "使用中" : "使用") : "下载");
          button.type = "button";
          button.disabled = !data.connected || selected && installed;
          button.addEventListener("click", () => installed ? chooseModel(entry.name) : pullModel(entry.name));
          row.append(label, button);
          catalog.append(row);
        }
      }
      $("model-downloads").replaceChildren(catalog);
      $("model-button").title = `模型设置 · ${data.selected}`;
      icons();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function pullModel(name) {
    const progress = $("model-progress");
    progress.hidden = false;
    progress.textContent = `正在下载 ${name}，请保持页面打开…`;
    $("model-downloads").querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch("/api/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "下载未能开始");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const update = JSON.parse(line);
          if (update.error) throw new Error(update.error);
          if (update.done) completed = true;
          const percent = update.total ? ` ${Math.round(100 * update.completed / update.total)}%` : "";
          progress.textContent = update.done ? `${name} 已安装并选用` : `${update.status || "下载中"}${percent}`;
        }
      }
      if (!completed) throw new Error("下载中断，请重试");
      await refreshModels();
    } catch (error) {
      progress.textContent = `下载失败：${error.message}`;
      await refreshModels();
    }
  }

  async function chooseModel(name = $("model-select").value) {
    const select = $("model-select");
    try {
      const result = await post("/api/models", { model: name });
      $("model-status").textContent = `当前使用 ${result.selected}`;
      $("model-button").title = `模型设置 · ${result.selected}`;
      toast(`已切换到 ${result.selected}`);
      await refreshModels();
    } catch (error) {
      toast(error.message);
      await refreshModels();
    }
  }

  function renderAnalysis(result) {
    state.analysisResult = result;
    const target = $("analysis-content");
    const next = result.nextVideo;
    const section = node("div", "analysis-result");
    section.append(node("h4", "", "建议拍摄"));
    section.append(node("strong", "", next.title || "暂无足够证据形成选题"));
    if (next.hook) section.append(node("p", "", `开头：${next.hook}`));
    if (next.outline.length) {
      const list = node("ol");
      next.outline.forEach((line) => list.append(node("li", "", line)));
      section.append(list);
    }
    if (next.reason) section.append(node("p", "", `依据：${next.reason}`));
    const saveTopic = node("button", "button button-quiet save-topic", "");
    saveTopic.type = "button";
    saveTopic.append(icon("bookmark-plus"), node("span", "", "保存到选题库"));
    saveTopic.addEventListener("click", saveCurrentSuggestion);
    section.append(saveTopic);
    section.append(node("h4", "", "评论参与者兴趣分类"));
    section.append(node("p", "analysis-note", "仅归纳已读取的公开评论，不能代表全部浏览者、粉丝或账号的真实受众。"));
    if (!result.audiences?.length) section.append(node("p", "", "样本不足，暂不作群体分类。"));
    (result.audiences || []).forEach((group) => {
      const block = node("div", "audience");
      block.append(node("strong", "", group.label), node("small", "", `${group.count} 条评论 · ${group.videoCount} 条视频`));
      block.append(node("p", "", `兴趣：${group.interest}`));
      if (group.need) block.append(node("p", "", `关注点：${group.need}`));
      if (group.contentAngle) block.append(node("p", "", `内容方向：${group.contentAngle}`));
      group.examples.forEach((example) => {
        const quote = node("blockquote", "", example.text);
        const item = state.items.find((entry) => entry.id === example.noteId);
        if (item) {
          const link = node("a", "", `来源：${example.noteTitle || item.title}`);
          link.href = `https://www.xiaohongshu.com/explore/${encodeURIComponent(item.id)}?xsec_token=${encodeURIComponent(item.xsecToken)}&xsec_source=pc_search`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          quote.append(link);
        }
        block.append(quote);
      });
      section.append(block);
    });
    section.append(node("h4", "", "评论需求主题"));
    if (!result.themes.length) section.append(node("p", "", "可读取评论不足，暂时没有可靠的共同关注点。"));
    result.themes.forEach((theme) => {
      const block = node("div", "theme");
      const title = node("div", "theme-title");
      title.append(node("strong", "", theme.label),
        node("span", "", `${theme.repeated ? "重复出现" : "单条观察"} · ${theme.count} 条证据 · ${theme.videoCount} 条视频 · 当前 ${theme.currentCount} 条`));
      block.append(title, node("p", "", theme.insight));
      theme.examples.forEach((example) => {
        const quote = node("blockquote", "", example.text);
        const item = state.items.find((entry) => entry.id === example.noteId);
        if (item) {
          const link = node("a", "", `来源：${example.noteTitle || item.title}`);
          link.href = `https://www.xiaohongshu.com/explore/${encodeURIComponent(item.id)}?xsec_token=${encodeURIComponent(item.xsecToken)}&xsec_source=pc_search`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          quote.append(link);
        }
        block.append(quote);
      });
      section.append(block);
    });
    target.replaceChildren(section);
    $("analysis-status").textContent = `覆盖当前结果 ${result.coverage.totalVideos} 条视频，其中 ${result.coverage.videos} 条有可读评论；分 ${result.batches} 批处理 ${result.coverage.comments} 条评论（当前视频 ${result.coverage.currentComments} 条） · ${result.model}。仅代表本次可见样本，不是全部浏览者或官方播放热度。`;
    persistActiveView();
  }

  function renderAccountPane() {
    const open = state.mode === "profile" && state.accountOpen;
    $("panel-account").hidden = !open;
    $("detail-pane").setAttribute("aria-label", open ? "对标账号分析" : "笔记详情");
    $("detail-title").textContent = open ? "对标账号分析" : "笔记详情";
    $("account-title").textContent = `${state.keyword || "对标账号"} · 账号分析`;
    $("detail-pane").querySelector(".tabs").hidden = open;
    if (open) {
      for (const name of ["note", "comments", "insights", "draft"]) $(`panel-${name}`).hidden = true;
      $("source-link").hidden = true;
    } else if (state.selected) {
      $("source-link").hidden = false;
      selectTab(state.detailTab);
    }
    $("account-stop").hidden = !open || !state.accountRunning;
    $("account-start").hidden = !open || state.accountRunning || !state.accountProgress && !state.accountResult;
    $("account-start").lastChild.textContent = state.accountResult ? "重新分析" : "继续分析";
    renderAccountProgress();
    if (open && state.accountResult) renderAccountResult(state.accountResult);
  }

  function renderAccountProgress() {
    const progress = state.accountProgress;
    $("account-progress").hidden = !state.accountOpen || !progress;
    if (!progress || !state.accountOpen) return;
    const total = progress.queue.length + progress.batchesTotal + 5;
    const done = progress.index + progress.coverDone + progress.batchesDone
      + progress.textDone + (progress.phase === "done" ? 1 : 0);
    const stage = {
      reading: "读取公开视频", cover: "检查抽样封面", batch: "分批归纳证据",
      text: "综合账号证据", done: "分析完成",
    }[progress.phase];
    const count = progress.phase === "reading" ? `${progress.index}/${progress.queue.length} 条`
      : progress.phase === "cover" ? progress.coverTotal ? `${progress.coverCount}/${progress.coverTotal} 张` : "准备中"
        : progress.phase === "batch" ? `${progress.batchesDone}/${progress.batchesTotal} 批`
        : progress.phase === "done" ? `${progress.queue.length} 条视频` : "模型处理中";
    $("account-stage").textContent = progress.active || progress.phase === "done" ? stage : `已暂停 · ${stage}`;
    $("account-count").textContent = count;
    $("account-steps").textContent = `已完成步骤 ${done}/${total} · 非时间估算`;
    const seconds = Math.floor(((progress.active ? Date.now() - progress.startedAt : progress.elapsed) || 0) / 1000);
    $("account-time").textContent = `已用时 ${seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`}`;
    $("account-bar").max = total;
    $("account-bar").value = done;
    $("account-bar").setAttribute("aria-valuetext", `${stage} ${count}，已完成步骤 ${done}/${total}`);
  }

  function pauseAccount() {
    const progress = state.accountProgress;
    if (progress?.active) {
      progress.elapsed = Date.now() - progress.startedAt;
      progress.active = false;
    }
    state.accountRunning = false;
    renderAccountProgress();
  }

  function accountEvidence(target, entries) {
    const links = node("div", "account-evidence");
    for (const entry of entries) {
      const item = state.items.find((candidate) => candidate.id === entry.id);
      if (!item) continue;
      const link = node("a", "", `${entry.title} · 赞 ${compact(entry.stats.likes)} / 藏 ${compact(entry.stats.saves)} / 评 ${compact(entry.stats.comments)}`);
      link.href = `https://www.xiaohongshu.com/explore/${encodeURIComponent(item.id)}?xsec_token=${encodeURIComponent(item.xsecToken)}&xsec_source=pc_search`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (entry.quote) link.append(node("span", "account-quote", `原文：「${entry.quote}」`));
      links.append(link);
    }
    target.append(links);
  }

  function renderAccountResult(result) {
    state.accountResult = result;
    const section = node("div", "analysis-result");
    const metrics = node("div", "account-metrics");
    for (const [value, label] of [
      [result.metrics.videos, "本次视频"], [compact(result.metrics.medianLikes), "点赞中位数"],
      [compact(result.metrics.medianSaves), "收藏中位数"],
    ]) {
      const cell = node("div");
      cell.append(node("strong", "", String(value)), node("span", "", label));
      metrics.append(cell);
    }
    section.append(metrics, node("p", "analysis-note",
      `已读取 ${result.metrics.videos} 条视频、${result.metrics.withComments} 条有可见评论，共 ${result.metrics.sampledComments} 条评论样本。中位数只在本账号当前样本内比较。`));
    for (const [title, entries, emptyText] of [
      ["可观察的长处", result.strengths, "样本不足，暂不能归纳共同长处。"],
      ["可观察的短处", result.gaps, "没有足够证据确认共同短处。"],
      ["可借鉴的做法", result.takeaways, "暂无足够证据形成具体做法。"],
    ]) {
      section.append(node("h4", "", title));
      if (!entries.length) section.append(node("p", "", emptyText));
      for (const entry of entries) {
        const block = node("div", "account-finding");
        block.append(node("p", "", entry.text));
        accountEvidence(block, entry.evidence);
        section.append(block);
      }
    }
    section.append(node("h4", "", "抽样封面观察"));
    section.append(node("p", "analysis-note", result.coverStatus));
    for (const entry of result.covers) {
      const item = state.items.find((candidate) => candidate.id === entry.evidence[0].id);
      const block = node("div", "account-finding account-cover-row");
      if (item?.cover) {
        const image = node("img", "account-cover");
        image.src = item.cover;
        image.alt = `视频封面：${item.title}`;
        image.referrerPolicy = "no-referrer";
        block.append(image);
      }
      const description = node("div");
      description.append(node("p", "", entry.observation));
      accountEvidence(description, entry.evidence);
      block.append(description);
      section.append(block);
    }
    section.append(node("h4", "", "无法据此判断"));
    section.append(node("p", "", "平台未提供可核实的播放量、粉丝增长、推荐曝光及转化数据；本工具不能断言该账号为何流量高或粉丝多，也未分析视频画面与口播。"));
    $("account-content").replaceChildren(section);
    $("account-status").textContent = `分析完成 · ${result.model}。以上均为当前可见样本的观察，请核对来源视频。`;
    persistActiveView();
  }

  function openAccount() {
    if (state.mode !== "profile" || !state.items.length) return;
    state.accountOpen = true;
    $("workspace").classList.add("has-selection");
    renderAccountPane();
    persistActiveView();
    if (!state.accountResult && !state.accountRunning) analyzeAccount();
  }

  async function analyzeAccount() {
    if (state.accountRunning || !state.accountOpen) return;
    const run = ++state.accountRun;
    if (!state.accountProgress || state.accountResult) {
      const queue = state.items.slice(0, 50);
      state.accountProgress = {
        queue, notes: [], index: 0, phase: "reading", coverDone: 0,
        coverCount: 0, coverTotal: 0, batchesDone: 0, batchesTotal: Math.ceil(queue.length / 10),
        textDone: 0, active: true,
        startedAt: Date.now(), elapsed: 0,
      };
      state.accountResult = null;
      $("account-content").replaceChildren();
    } else {
      state.accountProgress.active = true;
      state.accountProgress.startedAt = Date.now() - state.accountProgress.elapsed;
      state.accountProgress.phase = state.accountProgress.index < state.accountProgress.queue.length ? "reading" : "cover";
      state.accountProgress.coverDone = 0;
      state.accountProgress.batchesDone = 0;
      state.accountProgress.textDone = 0;
    }
    state.accountRunning = true;
    $("account-stop").hidden = false;
    $("account-start").hidden = true;
    $("account-status").classList.remove("is-error");
    const progress = state.accountProgress;
    persistActiveView();
    const controller = new AbortController();
    accountController = controller;
    renderAccountProgress();
    try {
      while (progress.index < progress.queue.length) {
        const item = progress.queue[progress.index];
        $("account-status").textContent = `读取公开资料 ${progress.index + 1}/${progress.queue.length}：${item.title}`;
        const detail = state.selected?.id === item.id && state.detail ? state.detail
          : await post("/api/detail", { id: item.id, xsecToken: item.xsecToken }, controller.signal);
        if (run !== state.accountRun) return;
        progress.notes.push({
          id: item.id, title: item.title, cover: item.cover, description: detail.description,
          stats: detail.stats,
          comments: detail.comments.slice(0, 4).map((comment) => ({ text: comment.text })),
        });
        progress.index++;
        renderAccountProgress();
      }
      if (run !== state.accountRun) return;
      progress.phase = "cover";
      renderAccountProgress();
      $("account-status").textContent = "正在检查模型与抽样封面…";
      const result = await streamAnalysis({
        author: state.keyword, notes: progress.notes,
      }, (event) => {
        if (run !== state.accountRun) return;
        progress.phase = event.phase;
        if (event.phase === "cover") {
          progress.coverCount = event.completed;
          progress.coverTotal = event.total;
          progress.coverDone = event.total ? Math.round(event.completed / event.total * 3) : 3;
          $("account-status").textContent = `识别抽样封面 ${event.completed}/${event.total} 张…`;
        } else if (event.phase === "batch") {
          progress.coverDone = 3;
          progress.batchesDone = event.completed;
          $("account-status").textContent = `模型归纳 ${event.completed}/${event.total} 批…`;
        } else {
          progress.coverDone = 3;
          progress.batchesDone = progress.batchesTotal;
          progress.textDone = event.completed;
          $("account-status").textContent = "正在综合全部批次的长处与短处…";
        }
        renderAccountProgress();
      }, controller.signal, "/api/account/analyze/stream");
      if (run !== state.accountRun) return;
      progress.phase = "done";
      progress.coverDone = 3;
      progress.batchesDone = progress.batchesTotal;
      progress.textDone = 1;
      pauseAccount();
      renderAccountProgress();
      renderAccountResult(result);
    } catch (error) {
      if (run !== state.accountRun) return;
      pauseAccount();
      $("account-status").classList.add("is-error");
      $("account-status").textContent = `分析暂停：${error.message}。检查登录或模型后可继续。`;
      persistActiveView();
    } finally {
      if (run === state.accountRun) {
        accountController = null;
        state.accountRunning = false;
        $("account-stop").hidden = true;
        $("account-start").hidden = false;
        $("account-start").lastChild.textContent = state.accountResult ? "重新分析" : "继续分析";
        persistActiveView();
      }
    }
  }

  function stopAccount() {
    if (!state.accountRunning) return;
    state.accountRun++;
    accountController?.abort();
    pauseAccount();
    $("account-stop").hidden = true;
    $("account-start").hidden = false;
    $("account-start").lastChild.textContent = "继续分析";
    $("account-status").textContent = "已暂停。点击“继续分析”接着读取；模型阶段会重新归纳。";
  }

  async function streamAnalysis(body, onProgress, signal, route = "/api/analyze/stream") {
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "分析未能开始");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;
    const consume = (line) => {
      if (!line.trim()) return;
      const update = JSON.parse(line);
      if (update.error) throw new Error(update.error);
      if (update.done) result = update.result;
      else onProgress(update);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) consume(line);
      }
      consume(buffer + decoder.decode());
    } finally {
      reader.releaseLock();
    }
    if (!result) throw new Error("分析中断，请重试");
    return result;
  }

  async function analyze() {
    if (!state.selected || !state.detail || state.analyzing) return;
    const selectedId = state.selected.id;
    const run = ++state.analysisRun;
    state.analyzing = true;
    const button = $("analyze-button");
    button.disabled = true;
    $("stop-analysis").hidden = false;
    if (!state.analysisProgress || state.analysisProgress.selectedId !== selectedId) {
      const queue = state.items.slice(0, 50);
      if (!queue.some((item) => item.id === selectedId)) queue.push(state.selected);
      state.analysisProgress = { selectedId, queue, notes: [], index: 0 };
      state.analysisDisplay = null;
      state.analysisResult = null;
      $("analysis-content").replaceChildren();
    }
    const progress = state.analysisProgress;
    if (!state.analysisDisplay) {
      state.analysisDisplay = {
        phase: "reading", videosTotal: progress.queue.length, readCount: progress.index,
        batchesTotal: Math.ceil(progress.queue.length / 8), batchesDone: 0,
        startedAt: Date.now(), elapsed: 0, active: true,
      };
    } else {
      state.analysisDisplay.startedAt = Date.now() - state.analysisDisplay.elapsed;
      state.analysisDisplay.active = true;
      state.analysisDisplay.phase = progress.index < progress.queue.length ? "reading" : "model";
      state.analysisDisplay.batchesDone = 0;
    }
    renderAnalysisProgress();
    $("analysis-status").classList.remove("is-error");
    try {
      while (progress.index < progress.queue.length) {
        const item = progress.queue[progress.index];
        if (run !== state.analysisRun) return;
        $("analysis-status").textContent = `读取公开评论 ${progress.index + 1}/${progress.queue.length}：${item.title}`;
        try {
          const detail = item.id === selectedId ? state.detail
            : await post("/api/detail", { id: item.id, xsecToken: item.xsecToken });
          if (run !== state.analysisRun) return;
          progress.notes.push({
            id: item.id, title: item.title, heat: item.heat,
            comments: detail.comments.slice(0, 20).map((comment) => ({ text: String(comment.text ?? "").slice(0, 120) })),
          });
          progress.index++;
          state.analysisDisplay.readCount = progress.index;
          renderAnalysisProgress();
        } catch (error) {
          throw new Error(`读取暂停：${error.message}。请检查小红书登录或验证状态，处理后点击“继续分析”；如持续受限，请停止本次分析。`);
        }
      }
      if (run !== state.analysisRun) return;
      state.analysisDisplay.phase = "model";
      renderAnalysisProgress();
      const controller = new AbortController();
      analysisController = controller;
      const result = await streamAnalysis({ keyword: state.keyword, selectedId, notes: progress.notes }, (update) => {
        if (run !== state.analysisRun) return;
        state.analysisDisplay.phase = update.phase === "synthesis" ? "synthesis" : "model";
        state.analysisDisplay.batchesDone = update.completed;
        renderAnalysisProgress();
        $("analysis-status").textContent = update.phase === "synthesis"
          ? `已完成 ${update.total} 批，正在综合全部视频需求并生成下一条选题…`
          : `模型归纳 ${update.completed}/${update.total} 批（共 ${progress.queue.length} 条视频）…`;
      }, controller.signal);
      if (run === state.analysisRun) {
        state.analysisDisplay.phase = "done";
        pauseAnalysisDisplay();
        renderAnalysisProgress();
        renderAnalysis(result);
        state.analysisProgress = null;
        button.lastChild.textContent = "重新分析";
      }
    } catch (error) {
      if (run === state.analysisRun) {
        pauseAnalysisDisplay();
        $("analysis-status").classList.add("is-error");
        $("analysis-status").textContent = error.message;
        button.lastChild.textContent = "继续分析";
        if (/模型|Ollama/.test(error.message)) {
          $("model-dialog").showModal();
          refreshModels();
        }
      }
    } finally {
      if (analysisController?.signal.aborted || run === state.analysisRun) analysisController = null;
      if (run === state.analysisRun) {
        state.analyzing = false;
        button.disabled = !state.detail;
        $("stop-analysis").hidden = true;
        persistActiveView();
      }
    }
  }

  function stopAnalysis() {
    if (!state.analyzing) return;
    state.analysisRun++;
    analysisController?.abort();
    state.analyzing = false;
    pauseAnalysisDisplay();
    $("stop-analysis").hidden = true;
    $("analyze-button").disabled = false;
    $("analyze-button").lastChild.textContent = "继续分析";
    $("analysis-status").textContent = "已暂停。可继续读取剩余视频，或重新进行模型归纳。";
  }

  function saveDraft() {
    if (!state.selected) return;
    state.draft = { title: $("draft-title").value, content: $("draft-content").value };
    localStorage.setItem(`xhs-radar-draft:${state.selected.id}`, JSON.stringify(state.draft));
    rememberSelectedDetail();
  }

  async function regenerateDraft() {
    if (!state.detail || !confirm("重新生成会覆盖当前草稿，继续吗？")) return;
    const selectedId = state.selected.id;
    try {
      const analysis = await post("/api/draft", { keyword: state.keyword, detail: state.detail });
      if (state.selected?.id !== selectedId) return;
      state.draft = analysis.draft;
      saveDraftFromState();
      rememberSelectedDetail();
      renderDraft();
    } catch (error) {
      toast(error.message);
    }
  }

  function saveDraftFromState() {
    if (state.selected) localStorage.setItem(`xhs-radar-draft:${state.selected.id}`, JSON.stringify(state.draft));
  }

  async function publish() {
    if (!state.loggedIn) return toast("请先连接小红书账号");
    const file = $("video-file").files[0];
    const title = $("draft-title").value.trim();
    const content = $("draft-content").value.trim();
    if (!file || !title || !content) return toast("请填写标题、正文并选择视频");
    if (titleLength(title) > 20) return toast("标题超过小红书的 20 字限制");
    if (file.size > 500 * 1024 * 1024) return toast("视频不能超过 500 MB");
    $("confirm-video").textContent = file.name;
    $("confirm-title").textContent = title;
    $("publish-dialog").showModal();
  }

  async function confirmPublish() {
    const button = $("confirm-publish");
    const file = $("video-file").files[0];
    if (!file) return;
    button.disabled = true;
    button.lastChild.textContent = "正在上传";
    try {
      const upload = await api(`/api/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      button.lastChild.textContent = "正在发布";
      const result = await post("/api/publish", {
        uploadId: upload.uploadId,
        title: $("draft-title").value.trim(),
        content: $("draft-content").value.trim(),
      });
      $("publish-dialog").close();
      const publishedTitle = $("draft-title").value.trim();
      const publishedAt = new Date().toISOString();
      const matchedIdea = state.ideas.find((idea) => idea.title === publishedTitle);
      state.reviews.unshift({
        id: crypto.randomUUID(),
        title: publishedTitle,
        publishedAt,
        url: "",
        topicId: matchedIdea?.id || "",
        snapshots: [],
        createdAt: publishedAt,
      });
      const saved = storeLocalRecords("xhs-radar-reviews", state.reviews);
      if (!saved) state.reviews.shift();
      if (matchedIdea) {
        matchedIdea.status = "published";
        matchedIdea.updatedAt = publishedAt;
        storeLocalRecords("xhs-radar-ideas", state.ideas);
      }
      toast(saved
        ? `${result.status || result.message || "发布完成"} · 已建立复盘记录`
        : "发布完成，但本机复盘记录未能保存");
      $("video-file").value = "";
      $("video-name").textContent = "选择 MP4 / MOV 文件";
    } catch (error) {
      toast(`发布未完成：${error.message}`);
    } finally {
      button.disabled = false;
      button.lastChild.textContent = "确认发布";
    }
  }

  $("search-form").addEventListener("submit", search);
  $("keyword").addEventListener("input", persistActiveView);
  $("profile-name").addEventListener("input", persistActiveView);
  $("sort").addEventListener("change", persistActiveView);
  $("time").addEventListener("change", persistActiveView);
  window.addEventListener("pagehide", persistActiveView);
  window.addEventListener("storage", (event) => {
    if (event.key !== window.XhsRadarViewState.STORAGE_KEY) return;
    const saved = window.XhsRadarViewState.loadViewState(localStorage);
    if (!saved) return;
    state.views = saved.views;
    state.mode = saved.mode;
    state.workspaceView = saved.workspaceView;
    renderRestoredState();
  });
  $("view-discover").addEventListener("click", () => setWorkspaceView("discover"));
  $("view-ideas").addEventListener("click", () => setWorkspaceView("ideas"));
  $("view-reviews").addEventListener("click", () => setWorkspaceView("reviews"));
  $("view-check").addEventListener("click", () => setWorkspaceView("check"));
  $("add-idea").addEventListener("click", () => openIdeaDialog());
  $("ideas-search").addEventListener("input", renderIdeas);
  $("ideas-status-filter").addEventListener("change", renderIdeas);
  $("idea-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const fields = {
      title: $("idea-title").value.trim(),
      hook: $("idea-hook").value.trim(),
      outline: $("idea-outline").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8),
      reason: $("idea-reason").value.trim(),
      keyword: $("idea-keyword").value.trim(),
    };
    const idea = state.ideas.find((entry) => entry.id === state.ideaEditId);
    if (idea) Object.assign(idea, fields, { updatedAt: now });
    else state.ideas.unshift({
      id: crypto.randomUUID(), ...fields, sourceVideos: 0, sourceComments: 0,
      evidence: [], status: "planned", createdAt: now, updatedAt: now,
    });
    if (!storeLocalRecords("xhs-radar-ideas", state.ideas)) {
      state.ideas = readLocalRecords("xhs-radar-ideas");
      return;
    }
    $("idea-dialog").close();
    renderIdeas();
    toast(state.ideaEditId ? "选题已更新" : "选题已保存");
  });
  $("add-review").addEventListener("click", () => openReviewDialog());
  $("review-form").addEventListener("submit", saveReviewMetadata);
  $("review-stage-filter").addEventListener("change", renderReviews);
  $("snapshot-form").addEventListener("submit", saveSnapshot);
  $("refresh-results").addEventListener("click", () => {
    if (state.lastQuery) startSearch({ ...state.lastQuery });
  });
  for (const mode of ["keyword", "profile"]) {
    $(`mode-${mode}`).addEventListener("click", () => setMode(mode));
  }
  $("sort-platform").addEventListener("click", () => setLocalSort("platform"));
  $("sort-heat").addEventListener("click", () => setLocalSort("heat"));
  $("compare-button").addEventListener("click", toggleComparison);
  $("account-button").addEventListener("click", openAccount);
  $("account-start").addEventListener("click", analyzeAccount);
  $("account-stop").addEventListener("click", stopAccount);
  for (const name of ["note", "comments", "insights", "draft"]) {
    $(`tab-${name}`).addEventListener("click", () => selectTab(name));
  }
  $("mobile-back").addEventListener("click", () => {
    $("workspace").classList.remove("has-selection");
    persistActiveView();
  });
  $("login-button").addEventListener("click", openLoginDialog);
  $("model-button").addEventListener("click", () => { $("model-dialog").showModal(); refreshModels(); });
  $("model-select").addEventListener("change", () => chooseModel());
  $("analyze-button").addEventListener("click", analyze);
  $("stop-analysis").addEventListener("click", stopAnalysis);
  $("refresh-qr").addEventListener("click", showQr);
  $("check-login-status").addEventListener("click", refreshStatus);
  $("login-dialog").addEventListener("close", () => qrController?.abort());
  $("retry-button").addEventListener("click", refreshStatus);
  document.querySelectorAll(".dialog-close").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  $("regenerate-button").addEventListener("click", regenerateDraft);
  $("draft-title").addEventListener("input", saveDraft);
  $("draft-content").addEventListener("input", saveDraft);
  $("copy-draft").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${$("draft-title").value}\n\n${$("draft-content").value}`);
      toast("草稿已复制");
    } catch {
      toast("复制失败，请手动选中草稿");
    }
  });
  $("video-file").addEventListener("change", () => {
    $("video-name").textContent = $("video-file").files[0]?.name || "选择 MP4 / MOV 文件";
    persistActiveView();
  });
  $("publish-button").addEventListener("click", publish);
  $("confirm-publish").addEventListener("click", confirmPublish);
  setInterval(() => {
    if (state.searchStatus?.kind === "loading") renderSearchStatus();
    if (state.analyzing) renderAnalysisProgress();
    if (state.accountRunning) renderAccountProgress();
  }, 1000);
  refreshStatus();
  renderIdeas();
  renderReviews();
  initializeWordCheck();
  renderRestoredState();
  icons();
})(globalThis);
