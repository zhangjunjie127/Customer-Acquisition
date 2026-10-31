"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createHistory } = require("./history");

test("compares the last matching observation and does not count new cards as growth", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-history-"));
  let clock = new Date("2026-10-27T00:00:00Z");
  const history = createHistory(dataDir, () => clock);
  const scope = { mode: "keyword", keyword: "通勤", sort: "最多点赞", time: "一周内" };
  const item = (id, likes, saves, comments) => ({
    id, stats: { likes, saves, comments }, heat: Math.round(likes + 1.5 * saves + 2.5 * comments),
    xsecToken: "do-not-save", authorId: "do-not-save", title: "do-not-save",
  });
  try {
    assert.equal(await history.record(scope, [item("abcdefgh", 100, 10, 2), item("ijklmnop", 40, 0, 1)]), null);
    clock = new Date("2026-10-28T00:00:00Z");
    const result = await history.record(scope, [item("abcdefgh", 120, 12, 5), item("qrstuvwx", 900, 0, 0)]);
    assert.deepEqual(result.deltas.abcdefgh, { likes: 20, saves: 2, comments: 3, heat: 31 });
    assert.equal(result.deltas.qrstuvwx, undefined);
    assert.equal(result.newCount, 1);
    assert.equal(result.missingCount, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.previousAt, "2026-10-27T00:00:00.000Z");
    assert.equal(await history.record({ ...scope, time: "不限" }, [item("abcdefgh", 200, 0, 0)]), null);
    const files = await fs.readdir(path.join(dataDir, "history"));
    assert.equal(files.length, 2);
    const stored = await fs.readFile(path.join(dataDir, "history", files[0]), "utf8");
    assert.ok(!stored.includes("do-not-save"));
    assert.ok(!stored.includes("xsecToken"));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("serializes simultaneous writes to one search condition and keeps only two snapshots", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-history-"));
  let tick = 0;
  const history = createHistory(dataDir, () => new Date(Date.UTC(2026, 9, 27, 0, 0, tick++)));
  const scope = { mode: "profile", userId: "author123" };
  const item = (likes) => [{ id: "abcdefgh", stats: { likes, saves: 0, comments: 0 }, heat: likes }];
  try {
    const results = await Promise.all([history.record(scope, item(1)), history.record(scope, item(2)), history.record(scope, item(3))]);
    assert.equal(results[0], null);
    assert.equal(results[1].deltas.abcdefgh.heat, 1);
    assert.equal(results[2].deltas.abcdefgh.heat, 1);
    const [file] = await fs.readdir(path.join(dataDir, "history"));
    const stored = JSON.parse(await fs.readFile(path.join(dataDir, "history", file), "utf8"));
    assert.equal(stored.observations.length, 2);
    assert.deepEqual(stored.observations.map((entry) => entry.items.abcdefgh.likes), [2, 3]);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
