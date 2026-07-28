// 纯逻辑单测：复刻 user.js 内纯函数，验证行为正确（反自欺：真验证而非装饰）
const LAN_PRIORITY = ['ai-zh', 'zh-CN', 'zh', 'ai-en', 'en', 'ai-ja', 'ja', 'ai-es', 'ai-pt', 'ai-ar'];
function pickLanguage(subs) {
  for (let i = 0; i < LAN_PRIORITY.length; i++)
    for (let j = 0; j < subs.length; j++)
      if (subs[j].lan === LAN_PRIORITY[i]) return subs[j].lan;
  return subs.length ? subs[0].lan : '';
}
function srtTime(t) {
  let s = Math.floor(t); let ms = Math.round((t - s) * 1000);
  if (ms === 1000) { s += 1; ms = 0; }
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n, w) => { n = String(n); while (n.length < w) n = '0' + n; return n; };
  return p(h, 2) + ':' + p(m, 2) + ':' + p(sec, 2) + ',' + p(ms, 3);
}
function bodyToTxt(body) { return body.map(x => x.content).join('\n'); }
function bodyToSrt(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const x = body[i];
    out.push(String(i + 1));
    out.push(srtTime(x.from) + ' --> ' + srtTime(x.to));
    out.push(x.content); out.push('');
  }
  return out.join('\n') + '\n';
}
function safeName(s) { return (s || 'bilibili').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }

// ===================== 新增：长视频分段合并 / 完整性 / 无字幕复制 =====================
// 合并多片段：展开 -> 按 from 排序 -> 去重（from+content 相同视为重复）
function mergeBodies(parts) {
  const all = [];
  parts.forEach(b => { if (b && b.body && b.body.length) all.push(...b.body); });
  all.sort((a, b) => (a.from || 0) - (b.from || 0));
  const seen = {}, out = [];
  all.forEach(x => { const k = (x.from || 0) + '|' + (x.content || ''); if (!seen[k]) { seen[k] = 1; out.push(x); } });
  return out;
}
// 完整性自检：末句结束时间远小于视频时长 -> 疑似截断
function checkIntegrity(body, duration) {
  if (!body || !body.length || !duration) return false;
  const lastTo = body[body.length - 1].to || 0;
  return lastTo < duration * 0.9;
}
// 无字幕时的可复制纯文本（纯函数版，参数注入便于测试）
function getVideoInfoText(title, up, desc) {
  const lines = ['【标题】' + (title || '未知')];
  if (up) lines.push('【UP主】' + up);
  if (desc) lines.push('【简介】' + desc);
  return lines.join('\n');
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      got : ' + g + '\n      want: ' + w); }
}

console.log('pickLanguage:');
eq('中文AI优先于英文', pickLanguage([{lan:'ai-en'},{lan:'ai-zh'}]), 'ai-zh');
eq('无中文回落首个', pickLanguage([{lan:'ai-ja'},{lan:'ai-es'}]), 'ai-ja');
eq('空列表返回空', pickLanguage([]), '');
eq('zh-CN 优先于 ai-en', pickLanguage([{lan:'ai-en'},{lan:'zh-CN'}]), 'zh-CN');

console.log('srtTime:');
eq('0秒', srtTime(0), '00:00:00,000');
eq('65.5秒', srtTime(65.5), '00:01:05,500');
eq('3661.123秒', srtTime(3661.123), '01:01:01,123');
eq('进位保护', srtTime(1.9999), '00:00:02,000');

console.log('bodyToTxt:');
eq('两行join', bodyToTxt([{content:'你好'},{content:'世界'}]), '你好\n世界');

console.log('bodyToSrt:');
eq('标准SRT', bodyToSrt([{from:0,to:1,content:'hi'},{from:1,to:2,content:'bye'}]),
  '1\n00:00:00,000 --> 00:00:01,000\nhi\n\n2\n00:00:01,000 --> 00:00:02,000\nbye\n\n');

console.log('safeName:');
eq('去非法字符', safeName('a/b:c*?'), 'a_b_c__');
eq('超长截断', safeName('x'.repeat(80)).length, 60);

// ① 超长字幕不截断：单片段大文件应完整保留
console.log('超长字幕不截断:');
(function () {
  const big = [];
  for (let i = 0; i < 5000; i++) big.push({ from: i, to: i + 1, content: '句' + i });
  const merged = mergeBodies([{ body: big }]);
  eq('5000 句完整保留', merged.length, 5000);
  eq('首句正确', merged[0].content, '句0');
  eq('末句正确', merged[4999].content, '句4999');
})();

// ② 多片段合并正确：同 lan 多个 subtitle_url 片段按时间排序且去重
console.log('多片段合并:');
(function () {
  const p0 = { body: [{ from: 0, to: 1, content: 'A' }, { from: 1, to: 2, content: 'B' }] };
  const p1 = { body: [{ from: 0, to: 1, content: 'A' }, { from: 2, to: 3, content: 'C' }] }; // 含与 p0 重复句
  const m = mergeBodies([p0, p1]);
  eq('去重后 3 句', m.length, 3);
  eq('按时间排序 0/1/2', m.map(x => x.content).join(','), 'A,B,C');
  // 乱序输入也应排好
  const pA = { body: [{ from: 5, to: 6, content: '后' }] };
  const pB = { body: [{ from: 0, to: 1, content: '前' }] };
  eq('乱序片段排序', mergeBodies([pA, pB]).map(x => x.content).join(','), '前,后');
})();

// ③ 无字幕时返回可复制纯文本（标题 + UP主 + 简介）
console.log('无字幕可复制纯文本:');
eq('完整视频信息', getVideoInfoText('我的视频', 'UP主小明', '这是简介'),
  '【标题】我的视频\n【UP主】UP主小明\n【简介】这是简介');
eq('缺 UP主/简介仍可用', getVideoInfoText('标题2', '', ''), '【标题】标题2');
eq('复制内容非空', getVideoInfoText('标题3', 'up', 'd').length > 0, true);

// ④ 完整性自检逻辑
console.log('完整性自检:');
eq('末句远早于时长 -> 疑似截断', checkIntegrity([{ from: 0, to: 10, content: 'x' }], 100), true);
eq('末句覆盖 95% -> 完整', checkIntegrity([{ from: 0, to: 95, content: 'x' }], 100), false);
eq('无时长信息 -> 不误报', checkIntegrity([{ from: 0, to: 10, content: 'x' }], 0), false);
eq('空字幕 -> 不误报', checkIntegrity([], 100), false);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
