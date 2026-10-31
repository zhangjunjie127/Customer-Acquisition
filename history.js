"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function snapshot(items, capturedAt) {
  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return {
    capturedAt,
    items: Object.fromEntries(items.filter((item) => /^[\w-]{8,100}$/.test(item.id)).map((item) => [
      item.id,
      {
        likes: count(item.stats.likes),
        saves: count(item.stats.saves),
        comments: count(item.stats.comments),
        heat: count(item.heat),
      },
    ])),
  };
}

function compare(previous, current) {
  if (!previous) return null;
  const deltas = {};
  let newCount = 0;
  for (const [id, stats] of Object.entries(current.items)) {
    if (!Object.hasOwn(previous.items, id)) {
      newCount++;
      continue;
    }
    const before = previous.items[id];
    deltas[id] = Object.fromEntries(["likes", "saves", "comments", "heat"]
      .map((key) => [key, stats[key] - before[key]]));
  }
  return {
    previousAt: previous.capturedAt,
    currentAt: current.capturedAt,
    matched: Object.keys(deltas).length,
    newCount,
    missingCount: Object.keys(previous.items).filter((id) => !Object.hasOwn(current.items, id)).length,
    deltas,
  };
}

function createHistory(dataDir, now = () => new Date()) {
  const pending = new Map();

  async function record(scope, items) {
    const key = JSON.stringify(scope);
    const prior = pending.get(key) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
      const directory = path.join(dataDir, "history");
      const file = path.join(directory, `${crypto.createHash("sha256").update(key).digest("hex")}.json`);
      await fs.mkdir(directory, { recursive: true });
      let observations = [];
      try {
        const stored = JSON.parse(await fs.readFile(file, "utf8"));
        if (stored.scope !== key || !Array.isArray(stored.observations)) throw new Error("历史记录格式无效");
        observations = stored.observations;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const current = snapshot(items, now().toISOString());
      const result = compare(observations.at(-1), current);
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify({
          version: 1,
          scope: key,
          observations: [...observations.slice(-1), current],
        }), { flag: "wx" });
        await fs.rename(temp, file);
      } catch (error) {
        await fs.rm(temp, { force: true });
        throw error;
      }
      return result;
    });
    pending.set(key, task);
    try {
      return await task;
    } finally {
      if (pending.get(key) === task) pending.delete(key);
    }
  }

  return { record };
}

module.exports = { compare, createHistory, snapshot };
