"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("./server");

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("serves the local content screening rules module", async () => {
  const app = createApp();
  const local = await listen(app.handler);
  try {
    const response = await fetch(`${local.url}/content-risk.js`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
    assert.match(body, /const PLATFORMS/);
  } finally {
    await close(local.server);
  }
});

test("serves only the bundled platform icon assets", async () => {
  const app = createApp();
  const local = await listen(app.handler);
  const icons = ["xiaohongshu", "douyin", "wechat", "kuaishou", "weibo", "bilibili"];
  try {
    for (const icon of icons) {
      const response = await fetch(`${local.url}/platform-icons/${icon}.svg`);
      assert.equal(response.status, 200, icon);
      assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
      assert.match(await response.text(), /^<svg /);
    }
    const unknown = await fetch(`${local.url}/platform-icons/unknown.svg`);
    assert.equal(unknown.status, 404);
  } finally {
    await close(local.server);
  }
});

test("proxies search, filters videos, and keeps token off the browser", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-search-test-"));
  let searches = 0;
  const upstream = await listen(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-secret");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/feeds/search") {
      searches++;
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).filters.note_type, "视频");
      assert.equal(JSON.parse(body).limit, 50);
      return res.end(JSON.stringify({ success: true, data: searches === 2 ? { count: 0, feeds: [] } : {
        count: 2, feeds: [
          { id: "abcdefgh", xsecToken: "secret-token", noteCard: { type: "video", displayTitle: "视频", interactInfo: { likedCount: "12" } } },
          { id: "ijklmnop", noteCard: { type: "normal" } },
        ],
      } }));
    }
    res.end(JSON.stringify({ success: true, data: { status: "healthy", is_logged_in: false } }));
  });
  const app = createApp({ upstream: upstream.url, token: "test-secret", dataDir });
  const local = await listen(app.handler);
  try {
    const response = await fetch(`${local.url}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: local.url },
      body: JSON.stringify({ keyword: "穿搭" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].title, "视频");
    assert.equal(body.comparison, null);
    const second = await fetch(`${local.url}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: local.url },
      body: JSON.stringify({ keyword: "穿搭" }),
    });
    const next = await second.json();
    assert.equal(next.comparison, null);
    assert.equal(next.items.length, 0);
    const third = await fetch(`${local.url}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: local.url },
      body: JSON.stringify({ keyword: "穿搭" }),
    });
    const compared = await third.json();
    assert.equal(compared.comparison.matched, 1);
    assert.equal(compared.comparison.deltas.abcdefgh.heat, 0);
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  } finally {
    await close(local.server);
    await close(upstream.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("rejects cross-origin writes and invalid detail requests", async () => {
  const app = createApp();
  const local = await listen(app.handler);
  try {
    const blocked = await fetch(`${local.url}/api/search`, {
      method: "POST",
      headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "test" }),
    });
    assert.equal(blocked.status, 403);
    const otherLocalPort = await fetch(`${local.url}/api/search`, {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:9999", "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "test" }),
    });
    assert.equal(otherLocalPort.status, 403);
    const missingOrigin = await fetch(`${local.url}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "test" }),
    });
    assert.equal(missingOrigin.status, 403);
    const spoofedHost = await new Promise((resolve, reject) => {
      const request = http.request(`${local.url}/api/status`, {
        headers: { Host: "attacker.example" },
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(spoofedHost, 403);
    const invalid = await fetch(`${local.url}/api/detail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: local.url },
      body: JSON.stringify({ id: "bad", xsecToken: "" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await close(local.server);
  }
});

test("proxies a complete profile URL and returns only public video cards", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-profile-test-"));
  const upstream = await listen(async (req, res) => {
    assert.equal(req.url, "/api/v1/user/profile");
    assert.equal(req.headers.authorization, "Bearer test-secret");
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.user_id, "64f1a2b3c4d5e6f7a8b9c0d1");
    assert.equal(input.xsec_token, "abc");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { data: {
      userBasicInfo: { nickname: "公开作者" },
      feeds: [{ id: "abcdefgh", xsecToken: "note-token", noteCard: { type: "video", displayTitle: "公开笔记" } }],
    } } }));
  });
  const app = createApp({ upstream: upstream.url, token: "test-secret", dataDir });
  const local = await listen(app.handler);
  try {
    const response = await fetch(`${local.url}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: local.url },
      body: JSON.stringify({ url: "https://www.xiaohongshu.com/user/profile/64f1a2b3c4d5e6f7a8b9c0d1?xsec_token=abc" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.author, "公开作者");
    assert.equal(result.items[0].title, "公开笔记");
    assert.equal(result.comparison, null);
    assert.equal(JSON.stringify(result).includes("test-secret"), false);
  } finally {
    await close(local.server);
    await close(upstream.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("finds name-matched accounts from public search before loading the selected profile", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-account-test-"));
  let profiles = 0;
  const upstream = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(req.headers.authorization, "Bearer test-secret");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/feeds/search") {
      assert.equal(input.keyword, "大姚爱叨叨");
      assert.equal(input.filters.note_type, "不限");
      assert.equal(input.filters.publish_time, "不限");
      return res.end(JSON.stringify({ success: true, data: { count: 2, feeds: [
        { xsecToken: "feed-token", noteCard: { user: { userId: "author123", nickname: "大姚爱叨叨" } } },
        { xsecToken: "other-token", noteCard: { user: { userId: "another12", nickname: "大姚爱叨叨" } } },
      ] } }));
    }
    assert.equal(req.url, "/api/v1/user/profile");
    assert.equal(input.user_id, "another12");
    assert.equal(input.xsec_token, "other-token");
    profiles++;
    res.end(JSON.stringify({ success: true, data: { data: {
      userBasicInfo: { nickname: "大姚爱叨叨" },
      feeds: [{ id: "abcdefgh", xsecToken: "note-token", noteCard: { type: "video", displayTitle: "公开视频" } }],
    } } }));
  });
  const app = createApp({ upstream: upstream.url, token: "test-secret", dataDir });
  const local = await listen(app.handler);
  const post = async (route, body) => fetch(`${local.url}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: local.url },
    body: JSON.stringify(body),
  });
  try {
    const result = await post("/api/users/search", { name: "大姚爱叨叨" });
    assert.equal(result.status, 200);
    const candidates = (await result.json()).candidates;
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].exact, true);
    assert.equal(profiles, 0);
    const selected = await post("/api/profile", candidates[1]);
    assert.equal(selected.status, 200);
    assert.equal((await selected.json()).items[0].title, "公开视频");
    assert.equal(profiles, 1);
    assert.equal((await post("/api/profile", { userId: "bad", xsecToken: "x" })).status, 400);
  } finally {
    await close(local.server);
    await close(upstream.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("closing the login request cancels the upstream browser request", async () => {
  let started;
  let closed;
  const upstreamStarted = new Promise((resolve) => { started = resolve; });
  const upstreamClosed = new Promise((resolve) => { closed = resolve; });
  const upstream = await listen((req, res) => {
    assert.equal(req.url, "/api/v1/login/qrcode");
    res.on("close", closed);
    started();
  });
  const app = createApp({ upstream: upstream.url });
  const local = await listen(app.handler);
  try {
    const controller = new AbortController();
    const request = fetch(`${local.url}/api/login/qrcode`, { signal: controller.signal });
    await upstreamStarted;
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    await Promise.race([
      upstreamClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("上游取码没有取消")), 3000)),
    ]);
  } finally {
    await close(local.server);
    await close(upstream.server);
  }
});

test("uploads locally and publishes only after a separate confirmed request", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-radar-test-"));
  let publishes = 0;
  const upstream = await listen(async (req, res) => {
    assert.equal(req.url, "/api/v1/publish_video");
    publishes++;
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.visibility, "公开可见");
    assert.equal((await fs.readFile(input.video)).toString(), "mock video");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: { status: "发布完成" } }));
  });
  const app = createApp({ upstream: upstream.url, token: "test-secret", dataDir });
  const local = await listen(app.handler);
  try {
    const uploaded = await fetch(`${local.url}/api/upload?name=clip.mp4`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "video/mp4" },
      body: Buffer.from("mock video"),
    });
    assert.equal(uploaded.status, 200);
    const { uploadId } = await uploaded.json();
    assert.equal(publishes, 0);

    const tooLong = await fetch(`${local.url}/api/publish`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, title: "长".repeat(21), content: "原创内容" }),
    });
    assert.equal(tooLong.status, 400);
    assert.equal(publishes, 0);

    const published = await fetch(`${local.url}/api/publish`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, title: "测试视频", content: "原创内容" }),
    });
    assert.equal(published.status, 200);
    assert.equal(publishes, 1);
    assert.equal(app.state.uploads.size, 0);
  } finally {
    await close(local.server);
    await close(upstream.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("switches only to installed models and analyzes with the selected local model", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-model-test-"));
  let generatedWith = "";
  const ollama = await listen(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") {
      return res.end(JSON.stringify({ models: [{ name: "qwen3.5:9b" }, { name: "test-model:1b" }] }));
    }
    if (req.url === "/api/generate") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      generatedWith = input.model;
      assert.equal(input.format, "json");
      assert.equal(body.includes("private-id"), false);
      return res.end(JSON.stringify({ response: JSON.stringify({
        themes: [{ label: "预算", insight: "明确预算", commentIds: ["1-1", "made-up"] }],
        nextVideo: { title: "预算内实测", hook: "先看结果", outline: ["展示对比"], reason: "真实提问" },
      }) }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  const app = createApp({ ollama: ollama.url, dataDir });
  const local = await listen(app.handler);
  const post = (route, body) => fetch(`${local.url}${route}`, {
    method: "POST",
    headers: { Origin: local.url, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    const uninstalled = await post("/api/models", { model: "not-installed:2b" });
    assert.equal(uninstalled.status, 400);
    const selected = await post("/api/models", { model: "test-model:1b" });
    assert.equal(selected.status, 200);
    const analysis = await post("/api/analyze", {
      keyword: "穿搭",
      selectedId: "abcdefgh",
      notes: [{ id: "abcdefgh", title: "A", heat: 100, comments: [{ text: "预算多少", userId: "private-id" }] }],
    });
    assert.equal(analysis.status, 200);
    const result = await analysis.json();
    assert.equal(result.model, "test-model:1b");
    assert.equal(result.themes[0].count, 1);
    assert.equal(generatedWith, "test-model:1b");
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, "settings.json"), "utf8")).model, "test-model:1b");
  } finally {
    await close(local.server);
    await close(ollama.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("streams all fifty videos plus selected extra through batches and validates final evidence", async () => {
  const prompts = [];
  const ollama = await listen(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3.5:9b" }] }));
    assert.equal(req.url, "/api/generate");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { prompt } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    prompts.push(prompt);
    let output;
    if (prompt.includes("综合所有批次")) {
      assert.match(prompt, /49-1/);
      output = {
        themes: [{ label: "共同问题", commentIds: ["1-1", "49-1", "made-up"] }],
        audiences: [{ label: "求教程", interest: "操作步骤", commentIds: ["1-1", "49-1"] }],
        nextVideo: { title: "50条视频后的选题", hook: "先看问题", outline: ["展示步骤"], reason: "跨视频证据" },
      };
    } else {
      const batch = JSON.parse(prompt.split("\n").at(-1));
      output = { themes: [{ label: "共同问题", commentIds: [batch[0].comments[0].id] }] };
    }
    res.end(JSON.stringify({ response: JSON.stringify(output) }));
  });
  const app = createApp({ ollama: ollama.url });
  const local = await listen(app.handler);
  const notes = Array.from({ length: 51 }, (_, index) => ({
    id: `note${String(index).padStart(5, "0")}`,
    title: `视频 ${index}`,
    heat: 100 - index,
    comments: [{ text: `想看步骤 ${index}`, userId: "private-id" }],
  }));
  try {
    const response = await fetch(`${local.url}/api/analyze/stream`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: "穿搭", selectedId: notes[50].id, notes }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    const result = events.at(-1).result;
    assert.equal(prompts.length, 8);
    assert.equal(events.filter((event) => event.phase === "batch" && event.completed === 7).length, 1);
    assert.equal(events.at(-2).phase, "synthesis");
    assert.equal(result.coverage.totalVideos, 51);
    assert.equal(result.coverage.comments, 51);
    assert.equal(result.coverage.currentComments, 1);
    assert.equal(result.batches, 7);
    assert.equal(result.themes[0].count, 2);
    assert.equal(result.themes[0].videoCount, 2);
    assert.equal(result.audiences[0].count, 2);
    assert.ok(prompts.every((prompt) => !prompt.includes("private-id")));
  } finally {
    await close(local.server);
    await close(ollama.server);
  }
});

test("account diagnosis streams grounded findings and bounded vision samples", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-account-test-"));
  const prompts = [];
  const ollama = await listen(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3.5:9b" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "vision"] }));
    assert.equal(req.url, "/api/generate");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    prompts.push(input);
    const result = input.images
      ? { covers: [{ noteId: JSON.parse(input.prompt.split("\n").at(-1))[0].id, observation: "主体居中" }] }
      : {
        strengths: [{ observation: "公开标题呈现一致主题", sources: [
          { noteId: "abcdefgh", quote: "尺码实测" },
          { noteId: "ijklmnop", quote: "请求对比一下" },
          { noteId: "fake", quote: "虚构来源" },
        ] }],
        gaps: [{ observation: "没有足够来源", sources: [{ noteId: "fake", quote: "虚构来源" }] }],
        takeaways: [],
      };
    res.end(JSON.stringify({ response: JSON.stringify(result) }));
  });
  const app = createApp({
    ollama: ollama.url, dataDir,
    loadCover: async () => Buffer.from("test-image").toString("base64"),
  });
  const local = await listen(app.handler);
  try {
    const response = await fetch(`${local.url}/api/account/analyze/stream`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "application/json" },
      body: JSON.stringify({ author: "对标账号", notes: [
        { id: "abcdefgh", title: "视频一", cover: "https://sns.xhscdn.com/a.jpg",
          description: "尺码实测", stats: { likes: 100, saves: 30, comments: 10 },
          comments: [{ text: "怎么选", userId: "private-id" }] },
        { id: "ijklmnop", title: "视频二", cover: "https://sns.xhscdn.com/b.jpg",
          stats: { likes: 50, saves: 10, comments: 4 }, comments: [{ text: "请求对比一下" }] },
      ] }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    const result = events.at(-1).result;
    assert.equal(events.filter((event) => event.phase === "cover" && event.completed === 2).length, 1);
    assert.equal(result.covers.length, 2);
    assert.equal(result.strengths[0].evidence.length, 2);
    assert.equal(result.strengths[0].evidence[0].quote, "尺码实测");
    assert.equal(result.gaps.length, 0);
    assert.equal(result.metrics.medianLikes, 75);
    assert.equal(prompts.filter((entry) => entry.images).length, 2);
    assert.ok(prompts.every((entry) => !entry.prompt.includes("private-id")));
    assert.ok(!prompts.at(-1).prompt.includes("xhscdn.com"));
  } finally {
    await close(local.server);
    await close(ollama.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("account diagnosis covers all fifty videos in five bounded batches", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-account-batches-"));
  const prompts = [];
  const ollama = await listen(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3.5:9b" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion"] }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const prompt = JSON.parse(Buffer.concat(chunks).toString("utf8")).prompt;
    prompts.push(prompt);
    let output;
    if (prompt.includes("跨批比较")) {
      assert.match(prompt, /note00000/);
      assert.match(prompt, /note00049/);
      output = { strengths: [{ observation: "多个视频呈现同类主题", sources: [
        { noteId: "note00000", quote: "想看同类主题" }, { noteId: "note00049", quote: "想看同类主题" },
      ] }] };
    } else {
      const batch = JSON.parse(prompt.split("\n").at(-1));
      output = { strengths: [{ observation: "主题一致", sources: [
        { noteId: batch[0].id, quote: "想看同类主题" },
        { noteId: batch.at(-1).id, quote: "想看同类主题" },
      ] }] };
    }
    res.end(JSON.stringify({ response: JSON.stringify(output) }));
  });
  const app = createApp({ ollama: ollama.url, dataDir });
  const local = await listen(app.handler);
  try {
    const notes = Array.from({ length: 50 }, (_, index) => ({
      id: `note${String(index).padStart(5, "0")}`,
      title: `视频 ${index}`, stats: { likes: index + 1 },
      comments: [{ text: "想看同类主题", nickname: "private-name" }],
    }));
    const response = await fetch(`${local.url}/api/account/analyze/stream`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "application/json" },
      body: JSON.stringify({ author: "账号", notes }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    const result = events.at(-1).result;
    assert.equal(prompts.length, 6);
    assert.equal(events.filter((event) => event.phase === "batch" && event.completed === 5).length, 1);
    assert.equal(result.metrics.videos, 50);
    assert.equal(result.strengths[0].evidence.length, 2);
    assert.equal(result.coverStatus, "当前模型不支持封面识别");
    assert.ok(prompts.every((prompt) => !prompt.includes("private-name")));
  } finally {
    await close(local.server);
    await close(ollama.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("streams model download progress and selects the completed model", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-pull-test-"));
  const ollama = await listen(async (req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ models: [] }));
    }
    assert.equal(req.url, "/api/pull");
    res.setHeader("Content-Type", "application/x-ndjson");
    res.write(JSON.stringify({ status: "下载中", completed: 5, total: 10 }) + "\n");
    res.end(JSON.stringify({ status: "success" }) + "\n");
  });
  const app = createApp({ ollama: ollama.url, dataDir });
  const local = await listen(app.handler);
  try {
    const response = await fetch(`${local.url}/api/models/pull`, {
      method: "POST",
      headers: { Origin: local.url, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen3.5:9b" }),
    });
    assert.equal(response.status, 200);
    const lines = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.equal(lines[0].status, "下载中");
    assert.deepEqual(lines.at(-1), { done: true, selected: "qwen3.5:9b" });
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, "settings.json"), "utf8")).model, "qwen3.5:9b");
  } finally {
    await close(local.server);
    await close(ollama.server);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
