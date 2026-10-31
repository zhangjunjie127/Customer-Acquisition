"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CATEGORIES, PLATFORMS, RULES, RULE_GROUPS, SOURCES, scan, highlights, replaceAllLiteral } = require("./public/content-risk");

test("matches only literal terms included for the selected platforms", () => {
  const text = "这条文案提到国家级、最高级，也提到新人互助和购买粉丝。";
  const selected = scan(text, ["xiaohongshu", "weibo"]);

  assert.deepEqual(selected.map((result) => result.platform.id), ["xiaohongshu", "weibo"]);
  assert.ok(selected[0].hits.some((hit) => hit.term === "国家级" && hit.sources.includes("adLaw")));
  assert.ok(selected[0].hits.some((hit) => hit.term === "新人互助"));
  assert.ok(selected[1].hits.some((hit) => hit.term === "购买粉丝"));
  assert.ok(!selected[1].hits.some((hit) => hit.term === "新人互助"));
  assert.ok(!selected[0].hits.some((hit) => hit.term === "购买粉丝"));
});

test("counts repeated occurrences and keeps rule scope and source with each hit", () => {
  const [result] = scan("最佳、最佳", ["douyin"]);
  const hit = result.hits.find((entry) => entry.term === "最佳");

  assert.equal(hit.count, 2);
  assert.equal(hit.scope, "商业广告");
  assert.ok(hit.sources.includes("adLaw"));
  assert.match(hit.explanation, /语境/);
});

test("non-selected platforms do not contribute highlights", () => {
  const results = scan("国家级，新人互助，刷转评赞", ["kuaishou"]);
  const foundTerms = results.flatMap((result) => result.hits.map((hit) => hit.term));

  assert.ok(foundTerms.includes("国家级"));
  assert.ok(!foundTerms.includes("新人互助"));
  assert.ok(!foundTerms.includes("刷转评赞"));
  assert.deepEqual(highlights(results).map((range) => range.term), ["国家级"]);
});

test("overlapping explicit phrases render as one longest highlight", () => {
  const results = scan("全国第一", ["xiaohongshu"]);
  const ranges = highlights(results);

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].term, "全国第一");
  assert.ok(CATEGORIES[ranges[0].category]);
});

test("literal replacement changes every exact occurrence without treating the term as a pattern", () => {
  assert.deepEqual(replaceAllLiteral("最佳穿搭，最佳单品", "最佳", "很棒"), {
    text: "很棒穿搭，很棒单品",
    count: 2,
  });
  assert.deepEqual(replaceAllLiteral("a.b a.b", "a.b", "*"), {
    text: "* *",
    count: 2,
  });
  assert.deepEqual(replaceAllLiteral("原文", "", "替换"), { text: "原文", count: 0 });
});

test("platform and source metadata cover all requested platforms", () => {
  assert.deepEqual(PLATFORMS.map((platform) => platform.label), [
    "小红书", "抖音", "微信视频号", "快手", "微博", "哔哩哔哩",
  ]);
  assert.ok(PLATFORMS.every((platform) => platform.sources.length > 0));
  assert.ok(PLATFORMS.every((platform) => platform.sources.every((source) => SOURCES[source])));
});

test("WeChat and Bilibili only flag explicit rule phrases", () => {
  const [wechat, bilibili] = scan(
    "不点赞全家死光光；普通点赞文案；邀请好友拆礼盒；刷量刷粉。使用自动化系统刷评，向第三方购买虚假数据。",
    ["wechat", "bilibili"],
  );

  assert.ok(wechat.hits.some((hit) => hit.term === "不点赞全家死光光"));
  assert.ok(wechat.hits.some((hit) => hit.term === "邀请好友拆礼盒"));
  assert.ok(wechat.hits.some((hit) => hit.term === "刷量刷粉"));
  assert.ok(!wechat.hits.some((hit) => hit.term === "点赞"));
  assert.ok(bilibili.hits.some((hit) => hit.term === "使用自动化系统刷评"));
  assert.ok(bilibili.hits.some((hit) => hit.term === "向第三方购买虚假数据"));
  assert.ok(bilibili.hits.every((hit) => hit.sources.includes("bilibiliCreator")));
});

test("Douyin no longer flags generic words absent from the cited rule phrase", () => {
  const [result] = scan(
    "观看次数、快速赚钱；通过各类欺骗性的行为或手段骗取互动和流量。",
    ["douyin"],
  );

  assert.ok(result.hits.some((hit) => hit.term === "通过各类欺骗性的行为或手段骗取互动和流量"));
  assert.ok(!result.hits.some((hit) => hit.term === "观看次数" || hit.term === "快速赚钱"));
});

test("every rule points to a declared source", () => {
  assert.ok(RULES.every((entry) => entry.sourceIds.every((source) => SOURCES[source])));
});

test("filters existing rules through the requested word-library groups", () => {
  assert.deepEqual(RULE_GROUPS.map((group) => group.label), [
    "通用词库", "敏感词", "小红书词", "广告词", "医疗词", "B站词",
  ]);

  const text = "国家级、治疗、刷量控评、最佳";
  const filtered = scan(text, ["xiaohongshu", "bilibili"], ["medical", "bilibili"]);
  const xhs = filtered.find((result) => result.platform.id === "xiaohongshu");
  const bilibili = filtered.find((result) => result.platform.id === "bilibili");

  assert.deepEqual(xhs.hits.map((hit) => hit.term), ["治疗"]);
  assert.deepEqual(bilibili.hits.map((hit) => hit.term), ["刷量控评"]);
});

test("overlapping word-library groups do not duplicate existing hits", () => {
  const [result] = scan("国家级", ["xiaohongshu"], ["general", "advertising"]);

  assert.equal(result.hits.filter((hit) => hit.term === "国家级").length, 1);
});

test("every existing rule remains available through at least one word-library group", () => {
  const groupedRuleIds = new Set(RULE_GROUPS.flatMap((group) => group.ruleIds));

  assert.ok(RULES.every((entry) => groupedRuleIds.has(entry.id)));
});

test("omitting the group filter keeps the existing all-rules scan behavior", () => {
  const text = "国家级、治疗、刷量控评、通过各类欺骗性的行为或手段骗取互动和流量";
  const platforms = ["xiaohongshu", "douyin", "bilibili"];

  assert.deepEqual(
    scan(text, platforms),
    scan(text, platforms, RULE_GROUPS.map((group) => group.id)),
  );
});
