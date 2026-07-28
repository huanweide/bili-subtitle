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

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
