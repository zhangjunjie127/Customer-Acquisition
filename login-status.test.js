"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8");
const refreshStatusSource = appSource.match(
  /async function refreshStatus\(\) \{([\s\S]*?)\n  \}\n\n  async function showQr/,
)?.[1];

test("login status is not polled in the background", () => {
  assert.doesNotMatch(appSource, /setInterval\s*\(\s*refreshStatus\b/);
});

test("a failed login status check does not clear the previous login state", () => {
  assert.ok(refreshStatusSource, "refreshStatus function should exist");
  const catchBlock = refreshStatusSource.match(/catch\s*\{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.doesNotMatch(catchBlock, /state\.loggedIn\s*=\s*false/);
  assert.doesNotMatch(catchBlock, /state\.username\s*=\s*""/);
});

test("the login dialog provides an explicit status check after scanning", () => {
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  assert.match(html, /id="check-login-status"/);
  assert.match(appSource, /check-login-status"\)\.addEventListener\("click", refreshStatus\)/);
});

test("opening the login dialog checks the saved session before creating a QR code", () => {
  const openLoginDialog = appSource.match(
    /async function openLoginDialog\(\) \{([\s\S]*?)\n  \}\n\n  function orderedItems/,
  )?.[1];
  assert.ok(openLoginDialog, "openLoginDialog function should exist");
  assert.ok(openLoginDialog.indexOf("await refreshStatus()") < openLoginDialog.indexOf("await showQr()"));
  assert.match(appSource, /login-button"\)\.addEventListener\("click", openLoginDialog\)/);
  assert.match(openLoginDialog, /if \(!status\?\.connected\)/);
  assert.match(openLoginDialog, /if \(!\$\("login-dialog"\)\.open \|\| status\?\.loggedIn\)/);
});
