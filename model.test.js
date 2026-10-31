"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DOWNLOADS, analysisPrompt, normalizeAnalysis, prepareNotes, synthesisPrompt } = require("./model");

test("curated free local catalog has distinct names and RTX 3060 tiers", () => {
  assert.equal(DOWNLOADS.length, 9);
  assert.equal(new Set(DOWNLOADS.map((entry) => entry.name)).size, DOWNLOADS.length);
  assert.ok(DOWNLOADS.every((entry) => [6, 12].includes(entry.vram)));
  assert.ok(DOWNLOADS.some((entry) => entry.name === "glm4:9b"));
  assert.ok(!DOWNLOADS.some((entry) => entry.name === "glm-4.7-flash"));
});

test("prepares a bounded set of notes and omits commenter identities", () => {
  const notes = prepareNotes([
    { id: "abcdefgh", title: "示例", heat: 123, comments: [
      { text: " 求教程 ", userId: "private-id", nickname: "someone" },
      { text: "" },
    ] },
  ], "abcdefgh");
  assert.equal(notes[0].comments[0].text, "求教程");
  assert.equal(notes[0].comments[0].id, "1-1");
  assert.equal(JSON.stringify(notes).includes("private-id"), false);
  assert.throws(() => prepareNotes([], "abcdefgh"), /当前视频/);
  assert.throws(() => prepareNotes(Array(52).fill({ id: "abcdefgh" }), "abcdefgh"), /最多分析/);
});

test("only counts citations to actual comments", () => {
  const notes = prepareNotes([
    { id: "abcdefgh", title: "A", comments: [{ text: "多少钱" }] },
    { id: "ijklmnop", title: "B", comments: [{ text: "价格呢" }] },
  ], "abcdefgh");
  const output = normalizeAnalysis({
    themes: [{ label: "价格", insight: "都想知道价位", commentIds: ["1-1", "2-1", "2-1", "unknown"] }],
    audiences: [
      { label: "预算关注", interest: "预算内选择", need: "知道价格", commentIds: ["1-1", "2-1", "unknown"] },
      { label: "无依据", interest: "未知", commentIds: ["unknown", "1-1"] },
    ],
    nextVideo: { title: "价格实测", outline: ["先给预算"] },
  }, notes);
  assert.equal(output.themes[0].count, 2);
  assert.equal(output.themes[0].videoCount, 2);
  assert.equal(output.themes[0].currentCount, 1);
  assert.equal(output.themes[0].repeated, true);
  assert.equal(output.audiences.length, 1);
  assert.equal(output.audiences[0].count, 2);
  assert.equal(output.audiences[0].videoCount, 2);
  assert.deepEqual(output.coverage, { totalVideos: 2, videos: 2, comments: 2, currentComments: 1 });
  assert.deepEqual(output.themes[0].evidenceIds, ["1-1", "2-1"]);
});

test("single-comment themes stay explicitly unconfirmed", () => {
  const notes = prepareNotes([{ id: "abcdefgh", comments: [{ text: "预算500以内" }] }], "abcdefgh");
  const output = normalizeAnalysis({
    themes: [{ label: "预算", commentIds: ["1-1"] }],
  }, notes);
  assert.equal(output.themes[0].repeated, false);
  assert.match(analysisPrompt("通勤", notes), /500元以内不能改写成百元以内/);
  assert.match(analysisPrompt("通勤", notes), /不是浏览者、全部粉丝/);
});

test("compact mode bounds comment volume for smaller GPUs", () => {
  const comments = Array.from({ length: 30 }, () => ({ text: "长".repeat(200) }));
  const prepared = prepareNotes([
    { id: "abcdefgh", comments },
    { id: "ijklmnop", comments },
  ], "abcdefgh", true);
  assert.equal(prepared[0].comments.length, 12);
  assert.equal(prepared[1].comments.length, 6);
  assert.equal(prepared[0].comments[0].text.length, 100);
});

test("fifty videos plus a selected extra preserve cross-batch evidence for synthesis", () => {
  const input = Array.from({ length: 51 }, (_, index) => ({
    id: `note${String(index).padStart(5, "0")}`,
    title: `视频 ${index + 1}`,
    comments: [{ text: `问题 ${index + 1}`, nickname: "should-not-leak" }],
  }));
  const notes = prepareNotes(input, input[50].id, true);
  assert.equal(notes.length, 51);
  assert.equal(notes[50].comments[0].id, "51-1");
  assert.equal(JSON.stringify(notes).includes("should-not-leak"), false);
  const early = normalizeAnalysis({ themes: [
    { label: "共同问题", commentIds: ["1-1"] },
  ] }, notes.slice(0, 8));
  const late = normalizeAnalysis({ themes: [
    { label: "共同问题", commentIds: ["51-1"] },
  ] }, notes.slice(48));
  const prompt = synthesisPrompt("穿搭", notes, [early, late], true);
  assert.match(prompt, /1-1/);
  assert.match(prompt, /51-1/);
  assert.doesNotMatch(prompt, /should-not-leak/);
});
