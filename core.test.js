"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createDraft,
  mapAccountCandidates,
  mapDetailResponse,
  mapProfileResponse,
  mapSearchResponse,
  parseCount,
  profileRequest,
  profileTarget,
  summarizeComments,
  titleLength,
  validateSearch,
} = require("./core");

test("parses compact interaction counts", () => {
  assert.equal(parseCount("1.7万"), 17000);
  assert.equal(parseCount("2,340"), 2340);
  assert.equal(parseCount("10万+"), 100000);
  assert.equal(parseCount("1.2亿"), 120000000);
  assert.equal(parseCount(""), 0);
});

test("maps only video notes and computes local heat", () => {
  const data = {
    feeds: [
      {
        id: "video-note-123",
        xsecToken: "token",
        noteCard: {
          type: "video",
          displayTitle: "测试视频",
          user: { nickname: "作者" },
          interactInfo: { likedCount: "1.2万", collectedCount: "300", commentCount: "20" },
          cover: { urlDefault: "http://example.com/image.jpg" },
        },
      },
      { id: "image-note-123", noteCard: { type: "normal", video: null } },
    ],
  };
  const feeds = mapSearchResponse(data);
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].stats.likes, 12000);
  assert.equal(feeds[0].heat, 12500);
  assert.equal(feeds[0].cover, "https://example.com/image.jpg");
});

test("maps public top-level and nested comments without private fields", () => {
  const detail = mapDetailResponse({
    feed_id: "note-12345",
    data: {
      note: { title: "示例", interactInfo: { commentCount: "2" } },
      comments: {
        hasMore: true,
        list: [{
          id: "c1",
          content: "多少钱",
          userInfo: { userId: "u1", nickname: "读者" },
          subComments: [{ id: "r1", content: "同问", userInfo: { userId: "u2" } }],
        }],
      },
    },
  });
  assert.equal(detail.comments.length, 2);
  assert.equal(detail.comments[1].parentId, "c1");
  assert.equal(detail.comments[0].nickname, "读者");
  assert.equal(detail.hasMoreComments, true);
});

test("groups questions and drafts original prompts without user identifiers", () => {
  const comments = [
    { text: "在哪里买，有链接吗", userId: "private-not-in-draft" },
    { text: "价格多少钱" },
    { text: "怎么操作，有教程吗" },
  ];
  const signals = summarizeComments(comments);
  assert.equal(signals[0].label, "购买与来源");
  const draft = createDraft("通勤穿搭", { comments });
  assert.match(draft.title, /通勤穿搭/);
  assert.doesNotMatch(draft.content, /private-not-in-draft/);
  assert.equal(draft.content.match(/在哪里买，有链接吗/g)?.length, 1);
  assert.ok(titleLength(createDraft("长".repeat(80), { comments }).title) <= 20);
  assert.equal(titleLength("中文AB"), 3);
});

test("search fixes video type and rejects empty keywords", () => {
  assert.equal(validateSearch({ keyword: "   穿搭 ", sort: "最多评论" }).filters.note_type, "视频");
  assert.equal(validateSearch({ keyword: "穿搭" }).limit, 50);
  assert.throws(() => validateSearch({ keyword: " " }), /关键词/);
});

test("accepts only complete Xiaohongshu profile links and maps visible videos", () => {
  assert.deepEqual(profileRequest("https://www.xiaohongshu.com/user/profile/64f1a2b3c4d5e6f7a8b9c0d1?xsec_token=abc%3D"), {
    user_id: "64f1a2b3c4d5e6f7a8b9c0d1",
    xsec_token: "abc=",
    tab: "note",
  });
  assert.throws(() => profileRequest("https://evil.example/user/profile/64f1a2b3c4d5e6f7a8b9c0d1?xsec_token=abc"), /小红书/);
  assert.throws(() => profileRequest("https://www.xiaohongshu.com/user/profile/64f1a2b3c4d5e6f7a8b9c0d1"), /xsec_token/);
  const result = mapProfileResponse({ data: {
    userBasicInfo: { nickname: "作者甲" },
    feeds: [
      { id: "abcdefgh", xsecToken: "note-token", noteCard: { type: "video", displayTitle: "视频" } },
      { id: "ijklmnop", noteCard: { type: "normal" } },
    ],
  } });
  assert.equal(result.author, "作者甲");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].xsecToken, "note-token");
});

test("deduplicates public authors and places exact name matches first", () => {
  const feed = (id, nickname, token) => ({
    xsecToken: token,
    noteCard: { user: { userId: id, nickname, avatar: "http://example.test/avatar.jpg" } },
  });
  const matches = mapAccountCandidates({ feeds: [
    feed("similar123", "大姚爱叨叨穿搭", "a"),
    feed("exact1234", "大姚爱叨叨", "b"),
    feed("exact1234", "大姚爱叨叨", "c"),
    feed("another12", "大姚爱叨叨", "d"),
    feed("bad", "大姚爱叨叨", "e"),
  ] }, "大姚爱叨叨");
  assert.deepEqual(matches.map(({ userId, exact }) => [userId, exact]), [
    ["exact1234", true], ["another12", true], ["similar123", false],
  ]);
  assert.equal(matches[0].avatar, "https://example.test/avatar.jpg");
  assert.deepEqual(profileTarget(matches[0]), { user_id: "exact1234", xsec_token: "b", tab: "note" });
  assert.throws(() => profileTarget({ userId: "bad", xsecToken: "b" }), /账号参数/);
});
