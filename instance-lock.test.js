"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { acquireInstanceLock } = require("./instance-lock");

test("only one radar process can own the shared data directory", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-instance-lock-"));
  try {
    const results = await Promise.all([
      acquireInstanceLock(dataDir),
      acquireInstanceLock(dataDir),
    ]);
    const owners = results.filter((result) => result.acquired);
    const blocked = results.filter((result) => !result.acquired);
    assert.equal(owners.length, 1);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].owner.pid, process.pid);

    await owners[0].release();
    const next = await acquireInstanceLock(dataDir);
    assert.equal(next.acquired, true);
    await next.release();
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("a lock left by a stopped process can be reclaimed", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-instance-lock-stale-"));
  try {
    await fs.writeFile(path.join(dataDir, "instance.lock"), JSON.stringify({
      pid: 42424242, token: "stale", startedAt: 1,
    }));
    const lock = await acquireInstanceLock(dataDir, { isProcessAlive: () => false });
    assert.equal(lock.acquired, true);
    await lock.release();
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
