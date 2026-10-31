"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.resolve(__dirname, "..", "public");
const item = (id, title, comments) => ({
  id, title, author: "测试作者", xsecToken: "fixture", cover: "",
  stats: { likes: 120, saves: 30, comments }, heat: 120 + 45 + comments * 2.5,
});
const searchItem = item("search-note", "关键词测试视频", 12);
const profileItem = item("profile-note", "账号测试视频", 25);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const requests = { search: 0, profile: 0, users: 0, detail: {}, draft: {} };

const port = Number(process.env.UI_FIXTURE_PORT || 4181);

http.createServer(async (req, res) => {
  const route = new URL(req.url, "http://localhost").pathname;
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  if (route === "/__requests") return send(200, requests);
  if (route.startsWith("/api/")) {
    let body = {};
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    if (route === "/api/status") return send(200, { connected: true, loggedIn: true, username: "测试账号" });
    if (route === "/api/search") {
      requests.search++;
      if (body.keyword === "slow") await new Promise((resolve) => setTimeout(resolve, 1800));
      if (body.keyword === "fail") return send(500, { error: "模拟读取失败" });
      if (body.keyword === "fifty") return send(200, {
        items: Array.from({ length: 50 }, (_, index) =>
          item(`note${String(index).padStart(5, "0")}`, `测试视频 ${index + 1}`, index + 1)),
        sourceCount: 50,
        comparison: null,
      });
      return send(200, { items: [searchItem], sourceCount: 1, comparison: null });
    }
    if (route === "/api/users/search") {
      requests.users++;
      return send(200, {
        sourceCount: 3,
        candidates: [
          { userId: "author123", nickname: body.name, xsecToken: "author-token", avatar: "", exact: true },
          { userId: "another12", nickname: body.name, xsecToken: "other-token", avatar: "", exact: true },
          { userId: "similar12", nickname: `${body.name}穿搭`, xsecToken: "similar-token", avatar: "", exact: false },
        ],
      });
    }
    if (route === "/api/profile") {
      requests.profile++;
      if (!["author123", "another12", "similar12"].includes(body.userId)) return send(400, { error: "请先选择账号" });
      return send(200, {
        author: "测试账号主页",
        items: Array.from({ length: 4 }, (_, index) =>
          item(`profile${String(index).padStart(5, "0")}`, `账号视频 ${index + 1}`, index + 2)),
        comparison: null,
      });
    }
    if (route === "/api/detail") {
      requests.detail[body.id] = (requests.detail[body.id] || 0) + 1;
      if (body.id.startsWith("note")) await new Promise((resolve) => setTimeout(resolve, 35));
      return send(200, {
        id: body.id, title: body.id === searchItem.id ? searchItem.title : profileItem.title,
        author: "测试作者", description: "测试简介", publishedAt: null,
        stats: { likes: 120, saves: 30, comments: 247 },
        comments: [{ id: "comment-1", nickname: "测试评论", text: "尺码怎么选？", createdAt: null }],
        hasMoreComments: false,
      });
    }
    if (route === "/api/draft") {
      requests.draft[body.detail.id] = (requests.draft[body.detail.id] || 0) + 1;
      return send(200, {
      signals: [{ label: "规格与细节", count: 1 }],
      draft: { title: "测试选题", content: "测试正文" },
    });
    }
    if (route === "/api/analyze/stream") {
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
      const total = Math.ceil(body.notes.length / 8);
      res.write(JSON.stringify({ phase: "batch", completed: 0, total }) + "\n");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      res.write(JSON.stringify({ phase: "synthesis", completed: total, total }) + "\n");
      res.end(JSON.stringify({ done: true, result: {
        model: "测试模型", batches: total,
        themes: [{ label: "尺码", insight: "有反复提问", count: 2, videoCount: 2, currentCount: 1, repeated: true, examples: [] }],
        audiences: [], nextVideo: { title: "尺码选题", hook: "先展示对比", outline: ["展示尺码"], reason: "跨视频评论" },
        coverage: { totalVideos: body.notes.length, videos: body.notes.length, comments: body.notes.length, currentComments: 1 },
      } }) + "\n");
      return;
    }
    if (route === "/api/account/analyze/stream") {
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
      res.write(JSON.stringify({ phase: "batch", completed: 0, total: 1 }) + "\n");
      await new Promise((resolve) => setTimeout(resolve, 1800));
      res.write(JSON.stringify({ phase: "batch", completed: 1, total: 1 }) + "\n");
      res.write(JSON.stringify({ phase: "text", completed: 0, total: 1 }) + "\n");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const evidence = body.notes.slice(0, 2).map((note) => ({
        id: note.id, title: note.title, stats: note.stats,
      }));
      res.end(JSON.stringify({ done: true, result: {
        model: "测试模型", coverStatus: "当前模型不支持封面识别", covers: [],
        metrics: { videos: body.notes.length, withComments: body.notes.length, sampledComments: body.notes.length,
          medianLikes: 120, medianSaves: 30, medianComments: 247 },
        strengths: [{ text: "标题主题一致", evidence }], gaps: [], takeaways: [],
      } }) + "\n");
      return;
    }
    return send(404, { error: "测试接口不存在" });
  }
  const file = route === "/" ? "/index.html" : route;
  if (!["/index.html", "/app.js", "/styles.css", "/vendor/lucide.js"].includes(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": `${types[path.extname(file)]}; charset=utf-8` });
  fs.createReadStream(path.join(publicDir, file)).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`UI fixture: http://127.0.0.1:${port}/`));
