"use strict";

const SORTS = new Set(["综合", "最新", "最多点赞", "最多评论", "最多收藏"]);
const TIMES = new Set(["不限", "一天内", "一周内", "半年内"]);

function parseCount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").replace(/,/g, "").trim().toLowerCase();
  const match = text.match(/([\d.]+)\s*(亿|万|w|k)?/);
  if (!match) return 0;
  const multiplier = { "亿": 1e8, "万": 1e4, w: 1e4, k: 1e3 }[match[2]] ?? 1;
  return Math.round(Number(match[1]) * multiplier) || 0;
}

function heat(stats) {
  return Math.round(stats.likes + stats.saves * 1.5 + stats.comments * 2.5);
}

function titleLength(title) {
  let units = 0;
  for (let index = 0; index < title.length; index++) {
    units += title.charCodeAt(index) > 127 ? 2 : 1;
  }
  return Math.ceil(units / 2);
}

function coverUrl(cover = {}) {
  const raw = String(cover.urlDefault || cover.url || cover.urlPre || cover.infoList?.[0]?.url || "").trim();
  if (/^http:\/\//i.test(raw)) return `https://${raw.slice(7)}`;
  return /^https:\/\//i.test(raw) ? raw : "";
}

function mapFeed(feed) {
  const card = feed.noteCard ?? {};
  const info = card.interactInfo ?? {};
  const stats = {
    likes: parseCount(info.likedCount),
    saves: parseCount(info.collectedCount),
    comments: parseCount(info.commentCount),
  };
  return {
    id: String(feed.id ?? ""),
    xsecToken: String(feed.xsecToken ?? ""),
    title: String(card.displayTitle || "未命名笔记"),
    author: String(card.user?.nickname || card.user?.nickName || "未知作者"),
    authorId: String(card.user?.userId ?? ""),
    cover: coverUrl(card.cover),
    duration: card.video?.capa?.duration ?? null,
    isVideo: card.type === "video" || Boolean(card.video),
    stats,
    heat: heat(stats),
  };
}

function mapSearchResponse(data) {
  const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
  return feeds.map(mapFeed).filter((feed) => feed.id && feed.isVideo);
}

function profileRequest(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { throw new Error("请粘贴完整的小红书用户主页链接"); }
  if (!["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)
      || url.protocol !== "https:") throw new Error("请使用小红书 HTTPS 用户主页链接");
  const match = url.pathname.match(/^\/user\/profile\/([\w-]{8,100})\/?$/);
  const token = url.searchParams.get("xsec_token") || "";
  if (!match || !token || token.length > 1024) {
    throw new Error("主页链接需包含用户 ID 和 xsec_token，请从小红书网页版复制完整链接");
  }
  return { user_id: match[1], xsec_token: token, tab: "note" };
}

function profileTarget(input) {
  const userId = String(input?.userId ?? "");
  const xsecToken = String(input?.xsecToken ?? "");
  if (!/^[\w-]{8,100}$/.test(userId) || !xsecToken || xsecToken.length > 1024) {
    throw new Error("账号参数无效，请重新按名称搜索");
  }
  return { user_id: userId, xsec_token: xsecToken, tab: "note" };
}

function mapAccountCandidates(data, name) {
  const exactName = String(name).normalize("NFKC").trim().toLocaleLowerCase();
  const seen = new Set();
  const candidates = [];
  for (const feed of data?.feeds ?? []) {
    const user = feed.noteCard?.user ?? {};
    const userId = String(user.userId ?? "");
    const nickname = String(user.nickname || user.nickName || "").trim();
    const xsecToken = String(feed.xsecToken ?? "");
    if (!/^[\w-]{8,100}$/.test(userId) || !nickname || !xsecToken || seen.has(userId)) continue;
    seen.add(userId);
    const rawAvatar = typeof user.avatar === "string" ? user.avatar : user.avatar?.urlDefault || user.avatar?.url || "";
    candidates.push({
      userId,
      nickname,
      xsecToken,
      avatar: coverUrl({ url: rawAvatar }),
      exact: nickname.normalize("NFKC").toLocaleLowerCase() === exactName,
    });
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact));
  return candidates;
}

function mapProfileResponse(data) {
  const profile = data?.data ?? data ?? {};
  return {
    author: String(profile.userBasicInfo?.nickname || "对标账号"),
    items: mapSearchResponse(profile),
  };
}

function mapComment(comment, parentId = null) {
  return {
    id: String(comment.id ?? ""),
    parentId,
    text: String(comment.content ?? ""),
    nickname: String(comment.userInfo?.nickname || comment.userInfo?.nickName || "未知用户"),
    userId: String(comment.userInfo?.userId ?? ""),
    avatar: String(comment.userInfo?.avatar ?? ""),
    likes: parseCount(comment.likeCount),
    createdAt: Number(comment.createTime) || null,
  };
}

function mapDetailResponse(data) {
  const note = data?.data?.note ?? {};
  const commentData = data?.data?.comments ?? {};
  const comments = [];
  for (const comment of commentData.list ?? []) {
    comments.push(mapComment(comment));
    for (const reply of comment.subComments ?? []) {
      comments.push(mapComment(reply, String(comment.id ?? "")));
    }
  }
  return {
    id: String(note.noteId || data?.feed_id || ""),
    title: String(note.title || "未命名笔记"),
    description: String(note.desc ?? ""),
    author: String(note.user?.nickname || note.user?.nickName || "未知作者"),
    publishedAt: Number(note.time) || null,
    stats: {
      likes: parseCount(note.interactInfo?.likedCount),
      saves: parseCount(note.interactInfo?.collectedCount),
      comments: parseCount(note.interactInfo?.commentCount),
    },
    comments,
    hasMoreComments: Boolean(commentData.hasMore),
  };
}

const SIGNALS = [
  { label: "购买与来源", pattern: /链接|哪[里儿]买|店铺|怎么买|购买|出处|求地址/i },
  { label: "价格与预算", pattern: /价格|价位|多少钱|贵不贵|预算|优惠/i },
  { label: "规格与细节", pattern: /尺码|尺寸|型号|材质|参数|质量|适合|身高|体重/i },
  { label: "方法与教程", pattern: /怎么|如何|教程|步骤|方法|求教|新手/i },
  { label: "体验与比较", pattern: /好用|效果|实测|对比|区别|值得|踩雷/i },
];

function summarizeComments(comments) {
  const groups = SIGNALS.map(({ label, pattern }) => ({
    label,
    count: 0,
    examples: [],
    pattern,
  }));
  for (const comment of comments) {
    for (const group of groups) {
      if (!group.pattern.test(comment.text)) continue;
      group.count++;
      if (group.examples.length < 3) group.examples.push(comment.text.slice(0, 100));
    }
  }
  return groups
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(({ label, count, examples }) => ({ label, count, examples }));
}

function createDraft(keyword, detail) {
  const signals = summarizeComments(detail.comments);
  const focus = signals[0]?.label || "常见疑问";
  const questions = [...new Set(signals.flatMap((group) => group.examples))].slice(0, 4);
  const suffix = "｜3个关键问题";
  let prefix = "";
  for (const character of keyword) {
    if (titleLength(prefix + character + suffix) > 20) break;
    prefix += character;
  }
  return {
    title: `${prefix}${suffix}`,
    content: [
      `围绕「${keyword}」做一条原创视频，重点回应：${focus}。`,
      "",
      "开头：直接给出一个具体场景或问题。",
      "中段：展示自己的素材、过程与真实判断。",
      "结尾：邀请观众说出下一条想看的问题。",
      "",
      ...(questions.length ? ["评论里反复出现的问题：", ...questions.map((q) => `- ${q}`)] : []),
    ].join("\n"),
  };
}

function validateSearch(input) {
  const keyword = String(input?.keyword ?? "").trim();
  if (!keyword || keyword.length > 80) throw new Error("关键词需为 1–80 个字符");
  const sort = SORTS.has(input?.sort) ? input.sort : "最多点赞";
  const time = TIMES.has(input?.time) ? input.time : "一周内";
  return {
    keyword,
    limit: 50,
    filters: {
      sort_by: sort,
      note_type: "视频",
      publish_time: time,
      search_scope: "不限",
      location: "不限",
    },
  };
}

module.exports = {
  createDraft,
  mapDetailResponse,
  mapAccountCandidates,
  mapProfileResponse,
  mapSearchResponse,
  parseCount,
  profileRequest,
  profileTarget,
  summarizeComments,
  titleLength,
  validateSearch,
};
