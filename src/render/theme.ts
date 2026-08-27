/**
 * 图片渲染用的样式表。
 *
 * 与 HTML 结构分开存放，改版面时不用翻模板字符串。
 * 只用系统字体与纯 CSS，不引任何外部资源——截图前不需要等网络，
 * 离线环境下渲染结果也完全一致。emoji 同理，走系统装的字体，不内嵌字体文件。
 */

/** 中英文都能覆盖的系统字体栈，按 macOS / Windows / Linux 依次回退 */
const TEXT_FONTS = [
  '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"',
  '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"',
  '"Noto Sans CJK SC"', '"Source Han Sans SC"', '"WenQuanYi Micro Hei"',
]

/**
 * 彩色 emoji 字体，同样按 macOS / Windows / Linux 依次回退。
 *
 * 版面自己不写 emoji，但群消息里有的是——正文字体一个都不含 emoji 码位，
 * 不点名这几个族，Linux 上就是一排方框。
 *
 * 位置有讲究：
 * - 排在正文字体**之后**——中英文先由正文字体挑走，emoji 字体只兜住它们
 *   没有的码位，`©` `®` `▶` 这类符号不会被顺手换成彩图。
 * - 排在 `sans-serif` **之前**——泛型族一定匹配得上，虽然 Chrome 对缺字仍会
 *   继续往后找，但放在它前面结果更确定，不依赖这个行为。
 *
 * 光点名不够，机器上得真装着这个字体：官方镜像见 docker/Dockerfile 里的
 * `font-noto-emoji`；自建环境装 fonts-noto-color-emoji（Debian/Ubuntu）
 * 或 font-noto-emoji（Alpine）即可。装不上也只是 emoji 变方框，
 * 其余版面照常，不会让渲染失败。
 */
const EMOJI_FONTS = [
  '"Apple Color Emoji"', '"Segoe UI Emoji"',
  '"Noto Color Emoji"', '"Twemoji Mozilla"', '"EmojiOne Color"', '"Android Emoji"',
]

const FONT_STACK = [...TEXT_FONTS, ...EMOJI_FONTS, 'sans-serif'].join(', ')

export const STYLE = `
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: ${FONT_STACK};
  background: transparent;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

#card {
  --ink:        #1b2130;
  --ink-soft:   #4a5468;
  --muted:      #8b93a7;
  --line:       #e9ecf4;
  --surface:    #ffffff;
  --surface-2:  #f7f9fd;
  --accent:     #5b6ef5;
  --accent-2:   #8b5cf6;
  --accent-soft: #eef1ff;
  --warm:       #f0913a;
  --cool:       #2ec5b6;

  position: relative;
  width: 100%;
  background: var(--surface);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.7;
  overflow: hidden;
  /* 群昵称和消息里常有超长不可断的串，统一允许断行，否则会顶破卡片右边界 */
  word-break: break-word;
}

/* 顶部渐变条：整张图的视觉锚点 */
.banner {
  position: relative;
  padding: 30px 34px 26px;
  background: linear-gradient(135deg, #5b6ef5 0%, #7c5ce0 52%, #b4529e 100%);
  color: #fff;
  overflow: hidden;
}
/* 两团柔光，避免大色块显得死板 */
.banner::before,
.banner::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, .14);
}
.banner::before { width: 260px; height: 260px; top: -150px; right: -60px; }
.banner::after  { width: 170px; height: 170px; bottom: -110px; right: 120px; background: rgba(255,255,255,.09); }

.banner-title {
  position: relative;
  font-size: 25px;
  font-weight: 700;
  letter-spacing: .5px;
  line-height: 1.35;
}
.banner-sub {
  position: relative;
  margin-top: 8px;
  font-size: 13.5px;
  color: rgba(255, 255, 255, .88);
  word-break: break-all;
}

/* 统计磁贴 */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  background: var(--line);
  border-bottom: 1px solid var(--line);
}
.stat {
  flex: 1 1 0;
  min-width: 96px;
  padding: 16px 10px 15px;
  background: var(--surface-2);
  text-align: center;
}
.stat-value {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.stat-label { margin-top: 3px; font-size: 11.5px; color: var(--muted); letter-spacing: .3px; }

.body { padding: 8px 34px 30px; }

/*
 * 两列排版走多列流：浏览器自己平衡两列高度。
 * 按分节硬分左右会失衡——高光记录的篇幅经常顶得上其余两节之和，
 * 那样左列会空掉一大半。
 */
.columns {
  column-count: 2;
  column-gap: 26px;
}
/*
 * 板块内部的分栏。板块本身始终通栏，列数由各板块自己决定：
 * 话题与活跃榜两列，金句多列（短，排得下），高光对话单列（气泡需要宽度）。
 *
 * 用 grid 而不是 column-count：多列流是按列灌的，4 张卡片分 3 列会被
 * 平衡成 2+2+0，白白空出一列；grid 按行铺，永远不会留空列。
 * 纵向间距仍由卡片自己的 margin 负责，这里只管列间距。
 */
.group {
  display: grid;
  grid-template-columns: 1fr;
  column-gap: 22px;
  align-items: start;
}
.group.cols-2 { grid-template-columns: repeat(2, 1fr); }
.group.cols-3 { grid-template-columns: repeat(3, 1fr); }

/* 卡片是最小不可分单位，标题不能和它后面的内容被拆到两列 */
.topic, .dialogue, .quote, .rank, .evidence, .field, .summary { break-inside: avoid; }
.section-title, .subsection-title { break-after: avoid; }
/* 分节默认允许跨列续排，否则又退化成按节分栏；标了 keep 的整块搬走 */
.section { break-inside: auto; }
.section.keep { break-inside: avoid; }

.section { padding-top: 24px; }
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16.5px;
  font-weight: 700;
  color: var(--ink);
  padding-bottom: 12px;
}
.section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--line), transparent);
}
.subsection-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 12px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: .4px;
}

/* 话题卡片 */
.topic {
  position: relative;
  padding: 14px 16px 14px 18px;
  margin-bottom: 10px;
  background: var(--surface-2);
  border-radius: 12px;
  border-left: 3px solid var(--accent);
}
.topic-name { font-size: 15.5px; font-weight: 650; color: var(--ink); }
.topic-detail { margin-top: 6px; font-size: 14px; color: var(--ink-soft); white-space: pre-wrap; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.chip {
  padding: 2px 10px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--accent);
  background: #eef1ff;
  border-radius: 999px;
}

/* 高光对话：逐轮自上而下，气泡一律靠左 */
.dialogue {
  padding: 16px 16px 14px;
  margin-bottom: 12px;
  background: var(--surface-2);
  border-radius: 14px;
  border: 1px solid var(--line);
}
.dialogue-title {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--ink);
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px dashed #dfe4f0;
}
.turn { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 10px; }
.avatar {
  position: relative;
  flex: 0 0 auto;
  width: 30px; height: 30px;
  border-radius: 50%;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 30px;
  text-align: center;
  overflow: hidden;
}
.bubble-wrap { max-width: 78%; }
.speaker { font-size: 11.5px; color: var(--muted); padding: 0 4px 3px; }
.bubble {
  display: inline-block;
  position: relative;
  padding: 9px 13px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px 14px 14px 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 对话脚注：学术要素与笑点说明 */
.note { display: flex; gap: 7px; margin-top: 8px; font-size: 12.5px; line-height: 1.6; color: var(--ink-soft); }
.note-tag {
  flex: 0 0 auto;
  padding: 1px 8px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 6px;
}
.note-tag.edu  { color: #b06a12; background: #fdf1de; }
.note-tag.cold { color: #17867a; background: #ddf5f2; }

/* 金句 */
.quote {
  position: relative;
  padding: 15px 18px 14px 44px;
  margin-bottom: 10px;
  background: var(--surface-2);
  border-radius: 12px;
}
.quote::before {
  content: '\\201C';
  position: absolute;
  left: 12px; top: 2px;
  font-size: 44px;
  line-height: 1;
  font-family: Georgia, 'Times New Roman', serif;
  color: #c9d0ea;
}
.quote-text { font-size: 14.5px; line-height: 1.7; color: var(--ink); white-space: pre-wrap; word-break: break-word; }
.quote-meta { margin-top: 7px; font-size: 12.5px; color: var(--muted); }
.quote-reason { margin-top: 4px; font-size: 12.5px; color: var(--ink-soft); }

/* 活跃榜 */
.rank { display: flex; align-items: center; gap: 11px; padding: 7px 0; }
.rank-no {
  flex: 0 0 auto;
  width: 23px; height: 23px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 700;
  line-height: 23px;
  text-align: center;
  color: var(--muted);
  background: var(--surface-2);
  font-variant-numeric: tabular-nums;
}
.rank-no.top1 { color: #fff; background: linear-gradient(135deg, #f6b73c, #ee8a2b); }
.rank-no.top2 { color: #fff; background: linear-gradient(135deg, #c2ccdb, #9aa7bb); }
.rank-no.top3 { color: #fff; background: linear-gradient(135deg, #e0a170, #c9824d); }
.rank-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 26px; height: 26px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 26px;
  text-align: center;
  object-fit: cover;
  overflow: hidden;
}
.rank-main { flex: 1 1 auto; min-width: 0; }
.rank-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.rank-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-num { flex: 0 0 auto; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.rank-bar { height: 5px; margin-top: 5px; background: #edf0f7; border-radius: 999px; overflow: hidden; }
.rank-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #6478f7, #a06ae0); }

/* 用户画像 */
.profile { display: flex; align-items: center; gap: 16px; position: relative; }
.profile-avatar {
  position: relative;
  flex: 0 0 auto;
  width: 62px; height: 62px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .55);
  object-fit: cover;
  color: #fff;
  font-size: 25px;
  font-weight: 600;
  line-height: 58px;
  text-align: center;
  overflow: hidden;
}
.profile-meta { min-width: 0; }

.summary {
  padding: 15px 17px;
  font-size: 14.5px;
  line-height: 1.75;
  color: var(--ink-soft);
  background: var(--surface-2);
  border-radius: 12px;
  white-space: pre-wrap;
}
.field { display: flex; gap: 10px; padding: 9px 0; align-items: baseline; }
.field-label { flex: 0 0 auto; font-size: 13px; font-weight: 600; color: var(--muted); }
.field-value { flex: 1 1 auto; font-size: 14px; color: var(--ink); white-space: pre-wrap; }

.evidence {
  padding: 10px 14px;
  margin-bottom: 8px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--ink-soft);
  background: var(--surface-2);
  border-left: 3px solid #d6dcee;
  border-radius: 0 10px 10px 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 消息里的引用：被回复的那条压成一条窄带，浮在正文上方 */
.msg-quote {
  display: block;
  margin-bottom: 5px;
  padding: 4px 9px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--muted);
  /* 淡靛而非 --surface-2：代表发言那块的底色就是 surface-2，同色会糊成一片 */
  background: var(--accent-soft);
  border-left: 2px solid #c2cbf5;
  border-radius: 0 7px 7px 0;
  /* 预览入库时已压成一行，不必继承气泡的 pre-wrap；太长要在这里回绕 */
  white-space: normal;
  word-break: break-word;
}
.msg-quote-name { font-weight: 600; color: var(--ink-soft); }
.msg-quote-name::after { content: '\\ff1a'; font-weight: 400; }
/* 引用条里的图片占位符跟着文字走：预览就一行，不该被撑成上下两截 */
.msg-quote .msg-media { display: inline; margin: 0; line-height: inherit; }

/* 消息里的合并转发：一张小卡片，一行一句，名字与正文分两列对齐 */
/* 两列网格：名字一列、正文一列，整张卡片共用一套列宽，各行才对得齐 */
.msg-fwd {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 3px;
  margin: 4px 0;
  padding: 8px 11px 7px;
  font-size: 13px;
  line-height: 1.6;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  /* 卡片自己按行排版，不吃气泡的 pre-wrap——那会在行与行之间多顶出一个空行 */
  white-space: normal;
}
.msg-fwd:first-child { margin-top: 0; }
.msg-fwd:last-child { margin-bottom: 0; }
.msg-fwd-head, .msg-fwd-more { grid-column: 1 / -1; }
.msg-fwd-head {
  padding-bottom: 6px;
  margin-bottom: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
/* 名字右对齐贴着正文：转发里同一个人常连着说好几句，对齐了才一眼看出换人没有 */
.msg-fwd-name {
  max-width: 96px;
  text-align: right;
  font-weight: 600;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-fwd-text {
  color: var(--ink);
  /* 转发的正文可能是多行的，换行要留着 */
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-fwd-more { padding-top: 2px; font-size: 12px; color: var(--muted); }
/* 卡片里的图只当缩略图：一条转发裹着七八张图，按气泡里的尺寸排下来能顶半页 */
.msg-fwd .msg-media { margin: 2px 0; }
.msg-fwd .msg-img { max-width: 180px; max-height: 84px; }

/* 消息里的图片 */
/* 图片自成一行；line-height:0 去掉 inline-block 底部那道基线缝隙 */
.msg-media {
  display: block;
  margin: 5px 0;
  line-height: 0;
}
.msg-media:first-child { margin-top: 0; }
.msg-media:last-child { margin-bottom: 0; }
.msg-img-wrap {
  display: inline-block;
  vertical-align: top;
  max-width: 100%;
  margin-right: 5px;
  line-height: 1.6;
}
.msg-img-wrap:last-child { margin-right: 0; }
.msg-img {
  display: block;
  max-width: 100%;
  max-height: 160px;
  border-radius: 8px;
  border: 1px solid var(--line);
}
/* 图片加载成功就把占位标签藏起来；img 被 onerror 移除后标签自动回来 */
.msg-img-wrap:has(img) .msg-img-chip { display: none; }
.msg-img-chip {
  display: inline-block;
  padding: 1px 8px;
  font-size: 12px;
  color: var(--muted);
  background: #eef1f7;
  border-radius: 6px;
}

/* 头像图层：盖在首字色块之上，加载失败时被移除，底下的字自然露出 */
.avatar-img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

/* 24 小时活跃柱状图 */
.chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  padding-top: 4px;
}
.chart-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}
.chart-value {
  font-size: 9.5px;
  line-height: 1.4;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin-bottom: 3px;
}
.chart-bar {
  width: 100%;
  border-radius: 4px 4px 2px 2px;
  background: linear-gradient(180deg, #8b9cf9, #6478f7);
}
/* 峰值用暖色挑出来，一眼能找到最闹的那个钟头 */
.chart-col.peak .chart-bar { background: linear-gradient(180deg, #f6b73c, #ee8a2b); }
.chart-col.peak .chart-value { color: var(--warm); font-weight: 600; }
/* 深夜时段压暗，作息一眼可辨 */
.chart-col.night .chart-bar { opacity: .45; }
.chart-hour {
  margin-top: 6px;
  font-size: 10px;
  line-height: 1.3;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.chart-foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
}

.empty { font-size: 14px; color: var(--muted); padding: 2px 0 4px; }

.footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 34px;
  font-size: 11.5px;
  color: var(--muted);
  background: var(--surface-2);
  border-top: 1px solid var(--line);
}
.footer span { word-break: break-all; }
`
