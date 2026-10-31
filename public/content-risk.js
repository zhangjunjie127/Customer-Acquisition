(function exposeContentRisk(root) {
  "use strict";

  const CHECKED_AT = "2026-10-31";

  const CATEGORIES = {
    absolute: { label: "绝对化宣传", className: "risk-absolute" },
    exaggerated: { label: "夸大与效果承诺", className: "risk-exaggerated" },
    qualification: { label: "行业资质表述", className: "risk-qualification" },
    sensitive: { label: "敏感内容类别", className: "risk-sensitive" },
    business: { label: "经营与交易风险", className: "risk-business" },
    engagement: { label: "诱导互动与刷量", className: "risk-engagement" },
  };

  const SOURCES = {
    adLaw: {
      title: "《中华人民共和国广告法》第九条",
      url: "https://sjfg.samr.gov.cn/law/file/pdf/3235243/1663323599406.pdf",
    },
    adGuide: {
      title: "市场监管总局《广告绝对化用语执法指南》",
      url: "https://www.samr.gov.cn/ggjgs/tzgg/art/2023/art_183b5cb48d9e4f0dba67f9f912a913ba.html",
    },
    adEvidence: {
      title: "市场监管总局《广告引证内容执法指南》（2026）",
      url: "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2026/art_8962fc1e4eb44a87b93d265af43b6940.html",
    },
    xhs: {
      title: "小红书蒲公英《内容审核规范》",
      url: "https://pgy.xiaohongshu.com/help/detail?id=6495c527d1eedeeb48fb18b1f875650e&userType=4",
    },
    douyin: {
      title: "抖音安全与信任中心《抖音社区自律公约》",
      url: "https://sf3-cdn-tos.douyinstatic.com/obj/ies-hotsoon-draft/douyin_agreement/b94d5a1e-c676-4e99-92b5-2d5e26d2568b.html?enter_from=user_agreement",
    },
    wechat: {
      title: "微信视频号《视频号运营规范》",
      url: "https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement&s=video",
    },
    wechatGuide: {
      title: "微信视频号《常见违规内容概览》",
      url: "https://weixin.qq.com/cgi-bin/readtemplate?lang=zh_CN&t=weixin_agreement&s=video_guide",
    },
    kuaishou: {
      title: "快手《社区管理规范》",
      url: "https://www2.kuaishou.com/norm?tab=community",
    },
    weibo: {
      title: "微博《微博社区公约》",
      url: "https://service.account.weibo.com/h5/roles/gongyue",
    },
    bilibili: {
      title: "哔哩哔哩《社区公约》",
      url: "https://member.bilibili.com/studio/convention/",
    },
    bilibiliCreator: {
      title: "哔哩哔哩《申请官方认证须知》",
      url: "https://www.bilibili.com/blackboard/era/6Zh6CzZtsy2TQDIg.html",
    },
    bilibiliAd: {
      title: "哔哩哔哩《花火稿件审核规范总则》",
      url: "https://www.bilibili.com/blackboard/activity-hp6i7WQHrx.html",
    },
  };

  const PLATFORMS = [
    {
      id: "xiaohongshu",
      label: "小红书",
      icon: "xiaohongshu",
      sources: ["xhs"],
      scopeNote: "平台词条来自蒲公英内容合作笔记审核规范，不等同于所有日常笔记的统一禁词表。",
    },
    {
      id: "douyin",
      label: "抖音",
      icon: "douyin",
      sources: ["douyin"],
      scopeNote: "仅匹配公约中明确写出的欺骗引流和骗取互动行为短语；普通词语不单独触发提示。",
    },
    {
      id: "wechat",
      label: "微信视频号",
      icon: "wechat",
      sources: ["wechat", "wechatGuide"],
      scopeNote: "仅匹配《视频号运营规范》明确列出的诱导分享话术和刷量刷粉用语；命中不代表违规结论。",
    },
    {
      id: "kuaishou",
      label: "快手",
      icon: "kuaishou",
      sources: ["kuaishou"],
      scopeNote: "平台规则按违规经营和内容场景判断；词条是规则中列举的示例，命中不代表违规结论。",
    },
    {
      id: "weibo",
      label: "微博",
      icon: "weibo",
      sources: ["weibo"],
      scopeNote: "词条取自社区公约中明确列举的刷量、粉丝作弊示例；是否涉及违规仍取决于上下文和实际行为。",
    },
    {
      id: "bilibili",
      label: "哔哩哔哩",
      icon: "bilibili",
      sources: ["bilibili", "bilibiliCreator", "bilibiliAd"],
      scopeNote: "平台词条来自《申请官方认证须知》列明的内容与行为示例；部分条目仅适用于认证审核场景。",
    },
  ];

  function rule(id, platformIds, category, terms, sourceIds, scope, explanation, level = "需核对") {
    return { id, platformIds, category, terms, sourceIds, scope, explanation, level };
  }

  const RULES = [
    rule(
      "law-absolute",
      "all",
      "absolute",
      ["国家级", "最高级", "最佳"],
      ["adLaw", "adGuide"],
      "商业广告",
      "《广告法》第九条第三项明确列出这些用语。市场监管总局指南要求结合广告内容、具体语境及事实综合判断，并非所有非广告语境一律违规。",
      "法律场景提示",
    ),
    rule(
      "law-content",
      "all",
      "sensitive",
      ["淫秽", "色情", "赌博", "迷信", "恐怖", "暴力", "民族歧视", "种族歧视", "宗教歧视", "性别歧视"],
      ["adLaw"],
      "商业广告内容",
      "这些是《广告法》第九条列出的广告内容类别词。仅提示文本中出现了该词，不判断内容本身是否属于该类别。",
      "内容复核提示",
    ),
    rule(
      "xhs-explicit-claims",
      ["xiaohongshu"],
      "exaggerated",
      ["完全有效", "无任何负面问题", "适用于所有人", "超越所有竞争产品", "所有情况适用"],
      ["xhs"],
      "蒲公英内容合作笔记中的宣传表述",
      "蒲公英规范将这些列为不应宣称的示例。命中仅提示核对商品适用条件、事实依据和文案语境。",
    ),
    rule(
      "xhs-first",
      ["xiaohongshu"],
      "absolute",
      ["NO.1", "TOP.1", "全国第一", "中国第一", "全网第一", "销量第一", "排名第一", "第一品牌"],
      ["xhs"],
      "蒲公英内容合作笔记",
      "小红书蒲公英内容审核规范将这些列为“与第一/1有关”的常见违规宣传词；该清单针对内容合作审核。",
    ),
    rule(
      "douyin-misleading-traffic",
      ["douyin"],
      "engagement",
      [
        "通过欺骗性手段骗取其他用户信任",
        "引导至其他站外平台进行诈骗",
        "通过各类欺骗性的行为或手段骗取互动和流量",
      ],
      ["douyin"],
      "抖音社区自律公约中的欺骗、诱导互动和站外引流场景",
      "这些是公约明确描述的完整行为短语。只对原文短语作字面匹配，不把“流量”“观看”等单词单独判为风险。",
    ),
    rule(
      "wechat-engagement",
      ["wechat"],
      "engagement",
      [
        "邀请好友拆礼盒", "集赞", "分享可增加一次抽奖机会",
        "不点赞全家死光光", "不点赞不是中国人",
        "利诱用户进行分享、关注、点赞和评论",
        "刷量刷粉", "刷粉",
      ],
      ["wechat"],
      "视频号运营规范第4.4节诱导用户、第4.5节刷量刷粉",
      "这些是运营规范直接列出的行为短语或示例话术。单独命中只提示核对上下文和实际行为。",
    ),
    rule(
      "bilibili-integrity",
      ["bilibili"],
      "engagement",
      [
        "刷量控评", "组织网络水军", "使用自动化系统刷评",
        "向第三方购买虚假数据", "以不正当手段诱导用户参与观看和互动",
        "诱导用户至第三方平台进行注册、关注、交易、消费",
      ],
      ["bilibiliCreator"],
      "哔哩哔哩官方认证申请与持证账号审核",
      "《申请官方认证须知》明确列举这些内容或行为。词条范围受认证审核规范限制，命中不是对普通稿件的违规判断。",
    ),
    rule(
      "xhs-exaggeration",
      ["xiaohongshu"],
      "exaggerated",
      [
        "至臻", "臻品", "臻致", "非此莫属", "无人能及", "翘楚之作", "不可复制", "绝无仅有",
        "前所未有", "不可再生", "无与伦比", "稀世珍宝", "千金难求", "世所罕见", "屈指可数",
        "前无古人后无来者", "史无前例", "万人疯抢", "全民疯抢", "全民抢购", "抢疯了",
        "亏本价", "抢爆", "再不抢就没了", "不会更便宜了", "错过就没机会了", "卖疯了",
        "随时涨价", "随时结束", "马上涨价", "神丹", "祖传秘方", "前无古人", "立竿见影",
        "起死回生", "返老还童", "无法超越", "业界公认", "行业公认", "全球公认",
      ],
      ["xhs"],
      "蒲公英内容合作笔记",
      "规范将这些列为夸张禁用语或典型宣传表述。命中词条不替代对商品、证明材料和具体文案的审核。",
    ),
    rule(
      "xhs-national-image",
      ["xiaohongshu"],
      "absolute",
      [
        "国家免检", "中国驰名", "驰名商标", "国家领导人推荐", "国家机关推荐",
        "国家机关专供", "质量免检", "无需国家质量检测", "免抽检", "中国驰名商标",
        "领导人推荐", "国宴", "国酒", "解放军", "部队", "武警",
      ],
      ["xhs"],
      "蒲公英内容合作笔记",
      "规范将这些列为国家形象相关用语示例。具体涉及的商品、事实及授权仍需核验。",
    ),
    rule(
      "xhs-interaction",
      ["xiaohongshu"],
      "engagement",
      ["新人互助", "新人互粉", "涨粉挑战", "集赞挑战"],
      ["xhs"],
      "蒲公英内容合作笔记",
      "规范将仅以此类诱导互动为内容、缺少其他有效信息的笔记列为审核风险；短语出现在其他语境时不代表违规。",
    ),
    rule(
      "xhs-health",
      ["xiaohongshu"],
      "qualification",
      [
        "药方", "药用", "药物", "中药", "医疗", "医治", "治疗", "消炎", "抗炎", "活血",
        "解毒", "抗敏", "防敏", "脱敏", "祛疤", "中医", "西医", "诊治", "就诊", "康复",
        "体检", "化验", "B超", "CT", "验血", "开方", "抗病毒", "手术", "注射", "化疗",
        "理疗", "退烧", "退热", "止痛", "止咳", "西药", "复方", "处方", "防癌", "抗癌",
        "降血压", "防治高血压", "补肾", "祛风",
      ],
      ["xhs"],
      "蒲公英内容合作笔记中的医疗健康行业",
      "规范要求相关医疗健康表述须具备相应行业资质。普通知识讨论也可能出现这些词，命中只提示核对资质和内容场景。",
    ),
    rule(
      "kuaishou-illegal-business",
      ["kuaishou"],
      "business",
      [
        "枪支弹药", "管制刀具", "易燃易爆物", "管制药品", "迷幻药物", "赌博相关物品或服务",
        "代孕", "试药", "人体器官买卖", "人皮面具", "胎儿性别鉴定", "假币", "假证",
        "高仿商品", "倒卖发票", "伪造文件印章", "传销组织", "网络兼职", "代理加盟",
        "非法募捐", "一元夺宝", "境外婚介服务", "外站联系方式", "情趣用品", "情趣制服",
        "酒驾", "醉驾",
      ],
      ["kuaishou"],
      "快手社区管理规范列举的违法经营及内容示例",
      "快手规则在特定违法经营、交易、内容场景中列举这些词语或行为示例。文本单独命中不代表在宣传相关服务。",
    ),
    rule(
      "kuaishou-traffic",
      ["kuaishou"],
      "engagement",
      ["粉丝量造假", "播放量造假", "点赞量造假", "评论量造假", "刷量"],
      ["kuaishou"],
      "快手社区管理规范中的平台秩序规则",
      "规则针对通过非正常手段实施数据作弊的行为；仅命中词语不判断用户是否实施该行为。",
    ),
    rule(
      "weibo-traffic",
      ["weibo"],
      "engagement",
      ["刷转评赞", "购买粉丝", "刷虚假阅读数", "网络水军", "专业粉丝服务", "数据维护", "刷量控评", "养号"],
      ["weibo"],
      "微博社区公约中的作弊行为和垃圾信息规则",
      "微博公约将这些列为恶意刷量或低质互动的例子。讨论、新闻或反诈提示中的引用也会被精确命中。",
    ),
  ];

  const RULE_GROUPS = [
    {
      id: "general",
      label: "通用词库",
      note: "含通用法律条目，以及尚未单独设类的抖音、视频号、快手和微博规则。",
      ruleIds: [
        "law-absolute", "law-content", "douyin-misleading-traffic",
        "wechat-engagement", "kuaishou-illegal-business", "kuaishou-traffic", "weibo-traffic",
      ],
    },
    {
      id: "sensitive",
      label: "敏感词",
      note: "只提示广告法明确列举的内容类别词，是否适用仍需结合上下文。",
      ruleIds: ["law-content"],
    },
    {
      id: "xiaohongshu",
      label: "小红书词",
      note: "复用当前已收录的小红书平台规则条目。",
      ruleIds: [
        "xhs-explicit-claims", "xhs-first", "xhs-exaggeration",
        "xhs-national-image", "xhs-interaction", "xhs-health",
      ],
    },
    {
      id: "advertising",
      label: "广告词",
      note: "复用广告法宣传用语和小红书合作笔记中的宣传表述条目。",
      ruleIds: [
        "law-absolute", "xhs-explicit-claims", "xhs-first",
        "xhs-exaggeration", "xhs-national-image", "xhs-health",
      ],
    },
    {
      id: "medical",
      label: "医疗词",
      note: "当前已收录的小红书医疗健康行业条目；命中仅提示核对资质和场景。",
      ruleIds: ["xhs-health"],
    },
    {
      id: "bilibili",
      label: "B站词",
      note: "复用当前已收录的哔哩哔哩官方规则示例。",
      ruleIds: ["bilibili-integrity"],
    },
  ];

  function scan(text, selectedPlatformIds, selectedGroupIds) {
    const sourceText = typeof text === "string" ? text : "";
    const selected = new Set(
      (Array.isArray(selectedPlatformIds) ? selectedPlatformIds : [])
        .filter((id) => PLATFORMS.some((platform) => platform.id === id)),
    );
    const selectedGroups = new Set(
      Array.isArray(selectedGroupIds)
        ? selectedGroupIds.filter((id) => RULE_GROUPS.some((group) => group.id === id))
        : RULE_GROUPS.map((group) => group.id),
    );
    const allowedRuleIds = new Set(
      RULE_GROUPS
        .filter((group) => selectedGroups.has(group.id))
        .flatMap((group) => group.ruleIds),
    );

    return PLATFORMS
      .filter((platform) => selected.has(platform.id))
      .map((platform) => {
        const hits = new Map();
        for (const entry of RULES) {
          if (!allowedRuleIds.has(entry.id)) continue;
          if (entry.platformIds !== "all" && !entry.platformIds.includes(platform.id)) continue;
          for (const term of entry.terms) {
            let index = sourceText.indexOf(term);
            while (index !== -1) {
              const key = `${entry.category}\u0000${entry.scope}\u0000${term}`;
              let hit = hits.get(key);
              if (!hit) {
                hit = {
                  term,
                  category: entry.category,
                  level: entry.level,
                  scope: entry.scope,
                  explanation: entry.explanation,
                  occurrences: [],
                  sources: [],
                };
                hits.set(key, hit);
              }
              if (!hit.occurrences.some((occurrence) => occurrence.start === index)) {
                hit.occurrences.push({ start: index, end: index + term.length });
              }
              for (const sourceId of entry.sourceIds) {
                if (!hit.sources.includes(sourceId)) hit.sources.push(sourceId);
              }
              index = sourceText.indexOf(term, index + 1);
            }
          }
        }
        const platformHits = [...hits.values()]
          .map((hit) => ({ ...hit, occurrences: hit.occurrences.sort((a, b) => a.start - b.start), count: hit.occurrences.length }))
          .sort((a, b) => a.occurrences[0].start - b.occurrences[0].start || b.term.length - a.term.length);
        return { platform, hits: platformHits };
      });
  }

  function highlights(results) {
    const candidates = [];
    for (const result of results) {
      for (const hit of result.hits) {
        for (const occurrence of hit.occurrences) {
          candidates.push({
            ...occurrence,
            term: hit.term,
            category: hit.category,
            level: hit.level,
          });
        }
      }
    }

    candidates.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const candidate of candidates) {
      const previous = merged.at(-1);
      if (previous && candidate.start < previous.end) {
        if (candidate.start === previous.start && candidate.end === previous.end && previous.category !== candidate.category) {
          previous.categories ||= [previous.category];
          if (!previous.categories.includes(candidate.category)) previous.categories.push(candidate.category);
        }
        continue;
      }
      merged.push({ ...candidate });
    }
    return merged;
  }

  function replaceAllLiteral(text, term, replacement) {
    const sourceText = typeof text === "string" ? text : "";
    if (typeof term !== "string" || !term) return { text: sourceText, count: 0 };
    const parts = sourceText.split(term);
    const count = parts.length - 1;
    return {
      text: count ? parts.join(typeof replacement === "string" ? replacement : "") : sourceText,
      count,
    };
  }

  const api = { CHECKED_AT, CATEGORIES, SOURCES, PLATFORMS, RULES, RULE_GROUPS, scan, highlights, replaceAllLiteral };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ContentRisk = api;
})(globalThis);
