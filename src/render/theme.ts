/**
 * 图片渲染用的样式表。
 *
 * 与 HTML 结构分开存放，改版面时不用翻模板字符串。
 * 只用系统字体与纯 CSS，不引任何外部资源——截图前不需要等网络，
 * 离线环境下渲染结果也完全一致。
 */

/** 中英文都能覆盖的系统字体栈，按 macOS / Windows / Linux 依次回退 */
const FONT_STACK = [
  '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"',
  '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"',
  '"Noto Sans CJK SC"', '"Source Han Sans SC"', '"WenQuanYi Micro Hei"',
  'sans-serif',
].join(', ')

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

/* 高光对话：还原一来一回的聊天节奏 */
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
.turn.right { flex-direction: row-reverse; }
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
.turn.right .bubble-wrap { text-align: right; }
.speaker { font-size: 11.5px; color: var(--muted); padding: 0 4px 3px; }
.bubble {
  display: inline-block;
  position: relative;
  padding: 9px 13px;
  font-size: 14px;
  line-height: 1.65;
  text-align: left;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px 14px 14px 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
.turn.right .bubble {
  color: #fff;
  background: linear-gradient(135deg, #6478f7, #8b5cf6);
  border-color: transparent;
  border-radius: 14px 14px 4px 14px;
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

/* 头像图层：盖在首字色块之上，加载失败时被移除，底下的字自然露出 */
.avatar-img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border-radius: 50%;
  object-fit: cover;
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
