"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const LOCK_NAME = "instance.lock";

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function acquireInstanceLock(dataDir, options = {}) {
  const pid = options.pid ?? process.pid;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const file = path.join(dataDir, LOCK_NAME);
  const token = crypto.randomUUID();
  await fs.mkdir(dataDir, { recursive: true });

  for (let attempt = 0; attempt < 12; attempt++) {
    let handle;
    try {
      handle = await fs.open(file, "wx", 0o600);
      const owner = { pid, token, startedAt: Date.now() };
      await handle.writeFile(JSON.stringify(owner), "utf8");
      await handle.close();
      handle = null;
      let released = false;
      return {
        acquired: true,
        owner,
        async release() {
          if (released) return;
          released = true;
          const current = await fs.readFile(file, "utf8").catch((error) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
          if (current && JSON.parse(current).token === token) {
            await fs.unlink(file).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
          }
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;

      const current = await fs.readFile(file, "utf8").catch((readError) => {
        if (readError.code === "ENOENT") return null;
        throw readError;
      });
      if (current === null) continue;

      let owner;
      try {
        owner = JSON.parse(current);
      } catch {
        const details = await fs.stat(file).catch((statError) => {
          if (statError.code === "ENOENT") return null;
          throw statError;
        });
        if (details && Date.now() - details.mtimeMs > 30000) {
          const latest = await fs.readFile(file, "utf8").catch((readError) => {
            if (readError.code === "ENOENT") return null;
            throw readError;
          });
          if (latest === current) {
            await fs.unlink(file).catch((unlinkError) => {
              if (unlinkError.code !== "ENOENT") throw unlinkError;
            });
            continue;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }

      if (Number.isInteger(owner.pid) && await isProcessAlive(owner.pid)) {
        return { acquired: false, owner };
      }

      const latest = await fs.readFile(file, "utf8").catch((readError) => {
        if (readError.code === "ENOENT") return null;
        throw readError;
      });
      if (latest === current) {
        await fs.unlink(file).catch((unlinkError) => {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        });
      }
    }
  }

  return { acquired: false, owner: null };
}

module.exports = { acquireInstanceLock };
