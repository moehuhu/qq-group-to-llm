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

/**
 * ── 样式表 ────────────────────────────────────────────────
 *
 * 与页面模板一一对应，三个出口各一份，分别维护：给群分析换个配色，
 * 不会顺手把画像那张图也改了。
 *
 * 三份都是完整的样式表，共用的段落（重置、配色变量、分节、消息正文等）
 * 在下面各自拼进去——配置里拿到的是一整份能直接改的 CSS，
 * 而不是几个要自己拼的碎片。
 */

/** 重置、字体栈与配色变量。改配色只要动 `#card` 上这组变量 */
const RESET = `
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
`

/** 顶部渐变条，三张图都有 */
const BANNER = `
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
`

/** 正文容器与分节标题 */
const SECTION = `
.body { padding: 8px 34px 30px; }

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
`

/** 板块内部的分栏网格。群分析与高光对话用，画像走的是页面级多列 */
const GROUP = `
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
`

/** 标签云。群分析的话题贡献者、画像的特质与领域都用它 */
const CHIPS = `
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.chip {
  padding: 2px 10px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--accent);
  background: #eef1ff;
  border-radius: 999px;
}
`

/**
 * 消息正文：引用、合并转发、图片、视频、提及，外加头像图层。
 * 三张图都会渲染群消息（金句、气泡、代表发言），所以三份里都有。
 */
const MESSAGE = `
/* 消息里的引用：被回复的那条压成一条窄带，浮在正文上方 */
.msg-quote {
  display: block;
  margin-bottom: 6px;
  padding: 5px 10px;
  font-size: 16px;
  line-height: 1.6;
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

/*
 * 消息里的提及：@某人 排成一枚淡靛标签，跟正文分开。
 * 不写死字号——引用条、转发卡片、气泡三处正文的字号各不相同，
 * 提及要跟着它落在的那一处走，写死了就会在小字里鼓出一块。
 */
.msg-at {
  display: inline-block;
  max-width: 100%;
  padding: 0 5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
  /* 群名片可以很长，标签自己回绕，不去把气泡撑破 */
  overflow-wrap: anywhere;
}

/* 消息里的合并转发：一张小卡片，一行一句，名字与正文分两列对齐 */
/* 两列网格：名字一列、正文一列，整张卡片共用一套列宽，各行才对得齐 */
.msg-fwd {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  column-gap: 8px;
  row-gap: 3px;
  margin: 5px 0;
  padding: 9px 12px 8px;
  font-size: 14px;
  line-height: 1.65;
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
  font-size: 12.5px;
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
.msg-fwd-more { padding-top: 2px; font-size: 12.5px; color: var(--muted); }
/* 套娃转发折叠成的标题：排成一枚标签，一眼看出这行不是话，是又一份记录 */
.msg-fwd-nested {
  display: inline-block;
  padding: 2px 9px;
  font-size: 12.5px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 6px;
}

/* 卡片里的图只当缩略图：一条转发裹着七八张图，按气泡里的尺寸排下来能顶半页 */
.msg-fwd .msg-media { margin: 2px 0; }
.msg-fwd .msg-img { max-width: 180px; max-height: 84px; }

/* 消息里的卡片（Ark / 分享链接） */
/* 卡片自带两栏布局，不吃气泡的 pre-wrap——那会在行与行之间多顶出一个空行 */
.msg-card {
  margin: 5px 0;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  white-space: normal;
}
.msg-card:first-child { margin-top: 0; }
.msg-card:last-child { margin-bottom: 0; }
/* 有封面图时左图右文两栏 */
.card-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}
.card-cover {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--line);
}
.card-cover img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;
}
/* 封面图没加载出来时露出的兜底文字，盖在底色上 */
.card-cover-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  overflow: hidden;
}
.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.card-kind {
  flex: 0 0 auto;
  padding: 1px 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 5px;
}
.card-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.card-source {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--muted);
}
.card-desc {
  margin-top: 4px;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}
.card-link {
  display: inline-block;
  margin-top: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
  text-decoration: none;
}

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
  padding: 2px 9px;
  font-size: 12.5px;
  color: var(--muted);
  background: #eef1f7;
  border-radius: 6px;
}

/* 消息里的视频：一块带播放标记的占位块。截图放不了 <video>，见 html.ts */
.msg-video {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px 8px 12px;
  font-size: 13.5px;
  color: var(--ink-soft);
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  vertical-align: top;
  line-height: 1.4;
}
/* 播放三角用边框画，不写字符：没装 emoji 字体的机器上 ▶ 会变成方框 */
.msg-video-play {
  flex: 0 0 auto;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--accent);
  position: relative;
}
.msg-video-play::before {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-45%, -50%);
  border-left: 6px solid #fff;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}

/* 头像图层：盖在首字色块之上，加载失败时被移除，底下的字自然露出 */
.avatar-img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
`

/** 空状态与页脚，三张图都有 */
const FOOTER = `
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

/** 群分析独有：数字条、话题卡片、金句、活跃榜、活跃时段柱状图 */
const REPORT_PARTS = `
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
/* 柱顶的「本时段发言最多」头像。columns 两列布局下柱宽不到 30px，
   尺寸收得很小，只求一眼认出是谁，不必比活跃榜更讲究 */
.chart-top {
  display: flex;
  justify-content: center;
  margin-bottom: 4px;
  height: 18px;
}
.chart-avatar {
  position: relative;
  width: 18px; height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 1.5px rgba(255,255,255,.85);
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
`

/** 高光对话独有：对话块、气泡、头像与脚注 */
const DIALOGUES_PARTS = `
/*
 * 高光对话。这张图只有一件事要做——把对话读顺，所以字号整体比其余版面大一档：
 * 气泡正文 21px 是主角，标题 23px 压住它，发言人名与脚注退到 16/17px 当配角，
 * 头像也从 64px 收到 54px。原先气泡 24px、周围仍是十几 px，主次差得太狠，
 * 名字和脚注都像被踩扁了。
 */
.dialogue {
  padding: 20px 20px 18px;
  margin-bottom: 16px;
  background: var(--surface-2);
  border-radius: 16px;
  border: 1px solid var(--line);
}
.dialogue-title {
  font-size: 23px;
  font-weight: 650;
  line-height: 1.45;
  color: var(--ink);
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px dashed #dfe4f0;
}
/*
 * 头像顶对齐。原先是底对齐，一条带图或带转发卡片的发言能有两三百像素高，
 * 头像被推到最底下，和顶上的名字隔了大半个气泡，谁说的就对不上号了。
 */
.turn { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.avatar {
  position: relative;
  flex: 0 0 auto;
  width: 54px; height: 54px;
  border-radius: 50%;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  line-height: 54px;
  text-align: center;
  overflow: hidden;
}
/* 留一成的余地给对侧的头像与呼吸空间，其余尽量让给正文 */
.bubble-wrap { max-width: 88%; }
.speaker { font-size: 16px; line-height: 1.5; color: var(--muted); padding: 0 4px 5px; }
.bubble {
  display: inline-block;
  position: relative;
  padding: 13px 20px;
  font-size: 21px;
  line-height: 1.75;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  /* 缺口开在左上角，对着头像——头像已经挪到顶上了 */
  border-radius: 5px 18px 18px 18px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 对话脚注：学术要素与笑点说明 */
.note { display: flex; align-items: baseline; gap: 10px; margin-top: 16px; font-size: 17px; line-height: 1.7; color: var(--ink-soft); }
.note-tag {
  flex: 0 0 auto;
  padding: 3px 11px;
  font-size: 14px;
  line-height: 1.55;
  font-weight: 600;
  border-radius: 7px;
}
.note-tag.edu  { color: #b06a12; background: #fdf1de; }
.note-tag.cold { color: #17867a; background: #ddf5f2; }

/*
 * 气泡里的消息元素跟着气泡一起放大。这些 msg-* 类同时用在群分析的金句和画像的
 * 证据里——那两处正文只有十四五 px，全局改会把它们顶破，所以一律限定在 .bubble 内。
 * 引用条、转发卡片、图注都按气泡正文的八成上下取值，主次不乱。
 */
.bubble .msg-quote { margin-bottom: 8px; padding: 6px 12px; font-size: 17px; border-radius: 0 9px 9px 0; }
.bubble .msg-fwd {
  margin: 7px 0;
  padding: 11px 15px 10px;
  column-gap: 10px;
  row-gap: 4px;
  font-size: 17px;
  border-radius: 12px;
}
.bubble .msg-fwd-head { padding-bottom: 7px; margin-bottom: 4px; font-size: 15px; }
.bubble .msg-fwd-more,
.bubble .msg-fwd-nested { font-size: 15px; }
.bubble .msg-fwd-name { max-width: 128px; }
.bubble .msg-img { max-height: 220px; border-radius: 10px; }
/* 转发卡片里的图仍只当缩略图，只是跟着放大一档；三个类名压过上面那条 .bubble .msg-img */
.bubble .msg-fwd .msg-img { max-width: 220px; max-height: 108px; }
.bubble .msg-img-chip,
.bubble .msg-video { font-size: 16px; }
.bubble .msg-video { padding: 9px 16px 9px 13px; gap: 8px; }
.bubble .msg-video-play { width: 21px; height: 21px; }
`

/**
 * 用户画像独有：页面级分栏、头部资料、整体印象、要点与代表发言。
 * 分栏（`.columns` 与那几条 break-inside）只有这张图用得上——
 * 另外两张的多列发生在板块内部，走的是 `.group` 那张网格。
 */
const PERSONA_PARTS = `
/*
 * 两列排版走多列流：浏览器自己平衡两列高度。
 * 按分节硬分左右会失衡——高光对话的篇幅经常顶得上其余两节之和，
 * 那样左列会空掉一大半。
 */
.columns {
  column-count: 2;
  column-gap: 26px;
}

/* 卡片是最小不可分单位，标题不能和它后面的内容被拆到两列 */
.summary, .field, .evidence { break-inside: avoid; }
.section-title { break-after: avoid; }
/* 分节默认允许跨列续排，否则又退化成按节分栏；标了 keep 的整块搬走 */
.section { break-inside: auto; }
.section.keep { break-inside: avoid; }

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
`

/** 「群分析」样式表 */
export const REPORT_STYLE = [RESET, BANNER, SECTION, GROUP, CHIPS, REPORT_PARTS, MESSAGE, FOOTER].join('')

/** 「高光对话」样式表 */
export const DIALOGUES_STYLE = [RESET, BANNER, SECTION, GROUP, DIALOGUES_PARTS, MESSAGE, FOOTER].join('')

/** 「用户画像」样式表 */
export const PERSONA_STYLE = [RESET, BANNER, SECTION, CHIPS, PERSONA_PARTS, MESSAGE, FOOTER].join('')

/**
 * ── 页面模板 ──────────────────────────────────────────────
 *
 * 三个出口各一份，分别维护：改群分析的版面不会牵动画像那张图。
 * 每份都是一整篇文档，`{...}` 是占位符，由 html.ts 把渲染好的板块灌进去；
 * 三份共用同一张样式表（STYLE），也共用下面这几个占位符：
 *
 * - `{title}` 文档标题（已转义）
 * - `{width}` 画布宽度（CSS 像素），来自「图片宽度」配置
 * - `{style}` 生效的样式表
 *
 * 改模板时 `#card` 必须留着：截图按这个元素的实际高度裁切，
 * 找不到它就会退化成整页视口截图，底下拖一大块空白。
 *
 * 认不出的占位符原样留在页面上——写错名字时看得见，
 * 而不是悄悄渲染成一块空白让人以为是数据缺了。
 */

/** 三份模板共用的文档头。抽出来只为少抄三遍，模板本身仍是各自完整的一篇 */
const HEAD = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{style}
html { width: {width}px; }
</style>
</head>`

/**
 * 群聊分析报告。
 *
 * 独有占位符：
 * - `{groupName}` `{timeRange}` 群名与时间范围（已转义）
 * - `{stats}`     顶部数字条的内容（若干个 `.stat`）
 * - `{topics}`    热门话题分节
 * - `{quotes}`    金句分节，没有金句时是空串
 * - `{ranks}`     活跃榜分节，没有数据时是空串
 * - `{hourly}`    活跃时段分节
 * - `{totalMessages}` `{totalParticipants}` `{totalChars}` `{mostActivePeriod}` 原始数值
 *
 * 四个分节都在 `.body` 里，调换顺序即可改版面；不想要哪节，删掉对应占位符就行。
 */
export const REPORT_TEMPLATE = `${HEAD}
<body><div id="card">
<div class="banner">
<div class="banner-title">群聊分析报告</div>
<div class="banner-sub">{groupName}</div>
<div class="banner-sub">{timeRange}</div>
</div>
<div class="stats">{stats}</div>
<div class="body">{topics}{quotes}{ranks}{hourly}</div>
<div class="footer"><span>{groupName}</span><span>共 {totalMessages} 条消息</span></div>
</div></body>
</html>`

/**
 * 高光对话。
 *
 * 独有占位符：
 * - `{groupName}` `{timeRange}` 群名与时间范围（已转义）
 * - `{dialogues}` 全部对话段，一段没有时是一句提示文案
 * - `{count}`     对话段数
 * - `{totalMessages}` 取样的消息条数
 *
 * 这张图单列通栏，不排两列——聊天气泡要靠宽度才排得开。
 */
export const DIALOGUES_TEMPLATE = `${HEAD}
<body><div id="card">
<div class="banner">
<div class="banner-title">高光对话</div>
<div class="banner-sub">{groupName}</div>
<div class="banner-sub">{timeRange}</div>
</div>
<div class="body"><div class="section">{dialogues}</div></div>
<div class="footer"><span>{groupName}</span><span>{count} 段 · 取自 {totalMessages} 条消息</span></div>
</div></body>
</html>`

/**
 * 用户画像。
 *
 * 独有占位符：
 * - `{name}` `{userId}` 昵称与用户 ID（已转义）
 * - `{avatar}`  头像元素（首字色块打底，有地址时图片盖在上面）
 * - `{summary}` 整体印象分节
 * - `{points}`  画像要点分节，三项都空时是空串
 * - `{evidence}` 代表发言分节，没有引用时是空串
 * - `{columns}` 分栏开关：画布够宽且分节多于一个时是 `columns`，否则是空串
 *
 * `{columns}` 拼在 `.body` 的 class 上，删掉它就是恒定单列。
 */
export const PERSONA_TEMPLATE = `${HEAD}
<body><div id="card">
<div class="banner"><div class="profile">
{avatar}
<div class="profile-meta">
<div class="banner-title">{name}</div>
<div class="banner-sub">用户画像 · {userId}</div>
</div></div></div>
<div class="body {columns}">{summary}{points}{evidence}</div>
<div class="footer"><span>{name}</span><span>用户画像</span></div>
</div></body>
</html>`

/**
 * 渲染取用的配置切片。
 * 只声明用得上的这几项，html.ts 因此不必认识整份 Config——
 * 结构上兼容即可，改配置不牵动模板层。
 */
export interface RenderStyleConfig {
  /** 画布宽度（CSS 像素） */
  imageWidth: number
  /** 自定义群分析模板与样式表，留空用内置的 */
  reportHtmlTemplate?: string
  reportCssTemplate?: string
  /** 自定义高光对话模板与样式表，留空用内置的 */
  dialoguesHtmlTemplate?: string
  dialoguesCssTemplate?: string
  /** 自定义用户画像模板与样式表，留空用内置的 */
  personaHtmlTemplate?: string
  personaCssTemplate?: string
  /** 追加样式，三张图共用，接在各自的样式表之后 */
  extraCss?: string
}

/** 一个出口的版面：内置的那份模板与样式表，加上配置里对应的自定义值 */
export interface OutputTheme {
  /** 内置页面模板 */
  template: string
  /** 内置样式表 */
  style: string
  /** 配置里的自定义页面模板，留空回退到内置 */
  customTemplate?: string
  /** 配置里的自定义样式表，留空回退到内置 */
  customStyle?: string
}

/** 三个出口各自的内置版面，配 config 里对应的两项 */
export const REPORT_THEME = (config: RenderStyleConfig): OutputTheme => ({
  template: REPORT_TEMPLATE,
  style: REPORT_STYLE,
  customTemplate: config.reportHtmlTemplate,
  customStyle: config.reportCssTemplate,
})

export const DIALOGUES_THEME = (config: RenderStyleConfig): OutputTheme => ({
  template: DIALOGUES_TEMPLATE,
  style: DIALOGUES_STYLE,
  customTemplate: config.dialoguesHtmlTemplate,
  customStyle: config.dialoguesCssTemplate,
})

export const PERSONA_THEME = (config: RenderStyleConfig): OutputTheme => ({
  template: PERSONA_TEMPLATE,
  style: PERSONA_STYLE,
  customTemplate: config.personaHtmlTemplate,
  customStyle: config.personaCssTemplate,
})

/** 配置项留空（或只有空白）时回退到内置的那份 */
const fallback = (value: string | undefined, builtin: string) =>
  value?.trim() ? value : builtin

/**
 * 填占位符。
 *
 * 只扫一遍模板，填进去的内容不再参与后续匹配——正文和样式表都是不可控的文本，
 * 群消息里出现一句 `{ranks}` 不该把活跃榜复制到那个位置上去。
 * 替换值走回调而不是字符串，用户 CSS 里的 `$&` `$1` 才不会被当成反向引用吃掉。
 * 名字对不上的占位符原样留着，见上面模板区的说明。
 */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    key in values ? values[key] : placeholder)
}

/** 某个出口最终生效的样式表：自定义（或内置）那份，后面接上共用的追加样式 */
export function resolveStyle(config: RenderStyleConfig, theme: OutputTheme): string {
  const base = fallback(theme.customStyle, theme.style)
  const extra = config.extraCss?.trim()
  return extra ? `${base}\n${extra}\n` : base
}

/**
 * 套模板拼出完整文档。`{width}` `{style}` 由这里统一灌，其余板块由调用方给，
 * 文本类的值调用方负责转义。
 */
export function resolveDocument(
  config: RenderStyleConfig,
  theme: OutputTheme,
  values: Record<string, string>,
): string {
  return fill(fallback(theme.customTemplate, theme.template), {
    ...values,
    width: String(config.imageWidth),
    style: resolveStyle(config, theme),
  })
}
