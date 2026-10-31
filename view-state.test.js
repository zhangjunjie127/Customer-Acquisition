"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadViewState, saveViewState } = require("./public/app");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    values,
  };
}

test("restores both search modes and cached video details after a page reload", () => {
  const storage = memoryStorage();
  const detail = { title: "已加载详情", comments: [{ text: "尺码怎么选？" }] };
  const snapshot = {
    mode: "profile",
    workspaceView: "discover",
    views: {
      keyword: {
        formKeyword: "通勤穿搭",
        sort: "最多点赞",
        time: "一周内",
        items: [{ id: "keyword-video", title: "关键词结果" }],
        lastQuery: { keyword: "通勤穿搭", sort: "最多点赞", time: "一周内" },
        detailCache: new Map([["keyword-video", { detail }]]),
      },
      profile: {
        formProfileName: "穿搭博主",
        items: [{ id: "profile-video", title: "主页结果" }],
        lastQuery: { userId: "author123", xsecToken: "token" },
        detailCache: new Map(),
      },
    },
  };

  assert.equal(saveViewState(storage, snapshot), true);
  const restored = loadViewState(storage);
  assert.equal(restored.mode, "profile");
  assert.equal(restored.views.keyword.formKeyword, "通勤穿搭");
  assert.equal(restored.views.keyword.items[0].id, "keyword-video");
  assert.deepEqual(restored.views.keyword.detailCache.get("keyword-video").detail, detail);
  assert.equal(restored.views.profile.formProfileName, "穿搭博主");
  assert.equal(restored.views.profile.items[0].id, "profile-video");
});

test("restores the selected workspace tab including content screening", () => {
  const storage = memoryStorage();
  saveViewState(storage, {
    mode: "keyword",
    workspaceView: "check",
    views: {},
  });

  assert.equal(loadViewState(storage).workspaceView, "check");
});

test("turns interrupted requests into a recoverable state without discarding prior results", () => {
  const storage = memoryStorage();
  saveViewState(storage, {
    mode: "keyword",
    workspaceView: "discover",
    views: {
      keyword: {
        items: [{ id: "previous-result" }],
        searchStatus: { kind: "loading", text: "正在搜索", startedAt: 1 },
      },
    },
  });

  const restored = loadViewState(storage);
  assert.equal(restored.views.keyword.items[0].id, "previous-result");
  assert.equal(restored.views.keyword.searchStatus.kind, "error");
  assert.match(restored.views.keyword.searchStatus.text, /中断/);
});

test("ignores malformed snapshots and reports storage quota failures", () => {
  const broken = memoryStorage({ "xhs-radar-view-state:v1": "{" });
  assert.equal(loadViewState(broken), null);

  const failing = { setItem() { throw new Error("quota"); } };
  assert.equal(saveViewState(failing, { mode: "keyword", workspaceView: "discover", views: {} }), false);
});
