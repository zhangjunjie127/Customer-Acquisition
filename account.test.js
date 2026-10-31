"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { accountMetrics, accountPrompt, accountSynthesisPrompt, normalizeAccountAnalysis, prepareAccountNotes } = require("./account");

test("account sample is bounded, strips identities, and counts only observed interactions", () => {
  const notes = prepareAccountNotes([
    { id: "abcdefgh", title: "尺码", description: "实测", stats: { likes: 100, saves: 20, comments: 5 },
      comments: [{ text: "尺码怎么选", userId: "private-id" }] },
    { id: "ijklmnop", title: "搭配", stats: { likes: 20, saves: 2, comments: 1 }, comments: [] },
  ]);
  assert.deepEqual(accountMetrics(notes), {
    videos: 2, withComments: 1, sampledComments: 1,
    medianLikes: 60, medianSaves: 11, medianComments: 3,
  });
  assert.doesNotMatch(accountPrompt("账号", notes), /private-id/);
  assert.match(accountPrompt("账号", notes), /不是播放量、流量或粉丝数/);
  assert.throws(() => prepareAccountNotes([]), /有公开视频/);
  assert.throws(() => prepareAccountNotes(Array(51).fill({ id: "abcdefgh" })), /最多分析/);
});

test("account findings require two real videos, and cover observations require a real image source", () => {
  const notes = prepareAccountNotes([
    { id: "abcdefgh", title: "尺码实测比较", stats: { likes: 100 } },
    { id: "ijklmnop", title: "版型实测比较", stats: { likes: 20 } },
  ]);
  const sources = [
    { noteId: "abcdefgh", quote: "尺码实测" },
    { noteId: "ijklmnop", quote: "版型实测" },
  ];
  const result = normalizeAccountAnalysis({
    strengths: [
      { observation: "可见标题规律", sources: [...sources, { noteId: "fake", quote: "不存在" }] },
      { observation: "单条不能当规律", sources: [sources[0], { noteId: "fake", quote: "不存在" }] },
      { observation: "算法推荐所以涨粉", sources },
      { observation: "没有原文支持", sources: [sources[0], { noteId: "ijklmnop", quote: "虚构摘录" }] },
    ],
    gaps: [{ observation: "无证据", sources: [{ noteId: "fake", quote: "不存在" }] }],
    takeaways: [{ action: "原创对照", sources }],
  }, notes, [
    { noteId: "abcdefgh", observation: "正面主体" },
    { noteId: "fake", observation: "虚构封面" },
    { noteId: "ijklmnop", observation: "这张封面导致涨粉" },
  ]);
  assert.equal(result.strengths.length, 1);
  assert.equal(result.strengths[0].evidence.length, 2);
  assert.equal(result.strengths[0].evidence[0].quote, "尺码实测");
  assert.equal(result.gaps.length, 0);
  assert.equal(result.takeaways.length, 1);
  assert.equal(result.covers.length, 1);
});

test("synthesis only receives validated observations from separate batches", () => {
  const notes = prepareAccountNotes([
    { id: "abcdefgh", title: "尺码实测 A", stats: { likes: 100 } },
    { id: "ijklmnop", title: "尺码实测 B", stats: { likes: 90 } },
    { id: "qrstuvwx", title: "尺码实测 C", stats: { likes: 80 } },
    { id: "yzabcdef", title: "尺码实测 D", stats: { likes: 70 } },
  ]);
  const batches = [
    normalizeAccountAnalysis({ strengths: [{ observation: "主题相同", sources: [
      { noteId: "abcdefgh", quote: "尺码实测" }, { noteId: "ijklmnop", quote: "尺码实测" },
    ] }] }, notes.slice(0, 2)),
    normalizeAccountAnalysis({ strengths: [{ observation: "主题相同", sources: [
      { noteId: "qrstuvwx", quote: "尺码实测" }, { noteId: "yzabcdef", quote: "尺码实测" },
    ] }] }, notes.slice(2)),
  ];
  const prompt = accountSynthesisPrompt("账号", notes, batches);
  assert.match(prompt, /abcdefgh/);
  assert.match(prompt, /yzabcdef/);
  assert.match(prompt, /尺码实测/);
  assert.doesNotMatch(prompt, /fake-video/);
});
