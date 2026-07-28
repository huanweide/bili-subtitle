// ==UserScript==
// @name         B站字幕一键提取 · 极速版
// @namespace    https://github.com/huanweide/bili-subtitle
// @version      6.1
// @description  打开B站视频 → 点一下 → 秒级提取字幕（自动选中文）→ 复制 / 下载 TXT·SRT。没有字幕也能一键复制视频标题与简介。无需登录，纯本地运行。
// @author       阿梓
// @icon         https://www.bilibili.com/favicon.ico
// @include      /^https?:\/\/(www\.)?bilibili\.com\/video\/BV\w+/
// @include      /^https?:\/\/(www\.)?bilibili\.com\/bangumi\/play\//
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      api.bilibili.com
// @connect      hdslb.com
// @connect      aisubtitle.hdslb.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 状态 =====================
  var state = {
    bvid: '',
    aid: '',
    cid: null,
    title: '',
    subs: [],        // [{lan, lan_doc, url}]
    body: null,      // 当前字幕 body 数组（带 from/to/content）
    lan: '',         // 当前选中语言
    loading: false,
    err: '',
    noSub: false     // 该视频确认无字幕
  };
  var cache = {};    // key: `${bvid||aid}_${cid}_${lan}` -> body 数组

  var LAN_PRIORITY = ['ai-zh', 'zh-CN', 'zh', 'ai-en', 'en', 'ai-ja', 'ja', 'ai-es', 'ai-pt', 'ai-ar'];

  // ===================== 工具 =====================
  function log() { console.log.apply(console, ['%c[B站字幕]', 'color:#FB7299;font-weight:bold'].concat([].slice.call(arguments))); }
  function pickLanguage(subs) {
    for (var i = 0; i < LAN_PRIORITY.length; i++) {
      for (var j = 0; j < subs.length; j++) {
        if (subs[j].lan === LAN_PRIORITY[i]) return subs[j].lan;
      }
    }
    return subs.length ? subs[0].lan : '';
  }
  function srtTime(t) {
    var s = Math.floor(t);
    var ms = Math.round((t - s) * 1000);
    if (ms === 1000) { s += 1; ms = 0; }
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(sec, 2) + ',' + p(ms, 3);
  }
  function bodyToTxt(body) { return body.map(function (x) { return x.content; }).join('\n'); }
  function bodyToSrt(body) {
    var out = [];
    for (var i = 0; i < body.length; i++) {
      var x = body[i];
      out.push(String(i + 1));
      out.push(srtTime(x.from) + ' --> ' + srtTime(x.to));
      out.push(x.content);
      out.push('');
    }
    return out.join('\n') + '\n';
  }
  function safeName(s) { return (s || 'bilibili').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }

  // ===================== 网络（GM_xmlhttpRequest 包 Promise） =====================
  function gx(url, timeout) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET', url: url,
        headers: { 'Referer': 'https://www.bilibili.com/' },
        onload: function (r) {
          if (r.status >= 200 && r.status < 300) resolve(r.responseText);
          else reject(new Error('HTTP ' + r.status));
        },
        onerror: function () { reject(new Error('network error')); },
        timeout: timeout || 10000
      });
    });
  }
  function getPageState() {
    try { return window.__INITIAL_STATE__ || {}; } catch (e) { return {}; }
  }
  // 无字幕时的可复制纯文本：标题 + UP主 + 简介（取自页面初始状态）
  function getVideoInfoText() {
    var st = getPageState();
    var title = state.title || (st.videoData && st.videoData.title) || document.title || '';
    var up = ''; var desc = '';
    try { up = (st.videoData && st.videoData.owner && st.videoData.owner.name) || ''; } catch (e) {}
    try { desc = (st.videoData && st.videoData.desc) || ''; } catch (e) {}
    var lines = ['【标题】' + (title || '未知')];
    if (up) lines.push('【UP主】' + up);
    if (desc) lines.push('【简介】' + desc);
    return lines.join('\n');
  }

  // ===================== 字幕管线 =====================
  async function resolveVideo() {
    var st = getPageState();
    // 标题
    try {
      state.title = (st.videoData && st.videoData.title) ||
        (st.epInfo && st.epInfo.title) || document.title.replace(/_哔哩哔哩.*/, '').trim();
    } catch (e) { state.title = document.title; }
    // bvid / aid / cid
    try {
      if (st.videoData) {
        state.bvid = st.videoData.bvid || '';
        state.aid = st.videoData.aid || '';
        state.cid = st.videoData.cid || null;
      }
      if ((!state.cid) && st.epInfo && st.epInfo.cid) state.cid = st.epInfo.cid;
      if (!state.aid && st.epInfo && st.epInfo.aid) state.aid = st.epInfo.aid;
    } catch (e) {}

    // URL 兜底 bvid
    if (!state.bvid) {
      var m = location.pathname.match(/BV\w+/);
      if (m) state.bvid = m[0];
    }
    // cid API 兜底
    if (!state.cid && state.bvid) {
      try {
        var d = JSON.parse(await gx('https://api.bilibili.com/x/player/pagelist?bvid=' + state.bvid, 8000));
        if (d.code === 0 && d.data && d.data[0]) { state.cid = d.data[0].cid; if (!state.aid) state.aid = d.data[0].aid; }
      } catch (e) { log('pagelist 失败', e); }
    }
    return !!state.cid;
  }

  async function fetchSubList() {
    var qs = (state.bvid ? 'bvid=' + state.bvid : 'aid=' + state.aid) + '&cid=' + state.cid;
    var d = JSON.parse(await gx('https://api.bilibili.com/x/player/v2?' + qs, 10000));
    if (d.code === 0 && d.data && d.data.subtitle && d.data.subtitle.subtitles) {
      // 按语言分组：长视频的 AI 字幕可能被拆成同一 lan 的多个 subtitle_url 片段
      var byLan = {};
      d.data.subtitle.subtitles.forEach(function (s) {
        var url = s.subtitle_url.indexOf('http') === 0 ? s.subtitle_url : 'https:' + s.subtitle_url;
        if (!byLan[s.lan]) byLan[s.lan] = { lan: s.lan, lan_doc: s.lan_doc, urls: [] };
        byLan[s.lan].urls.push(url);
      });
      state.subs = Object.keys(byLan).map(function (k) { return byLan[k]; });
      return state.subs;
    }
    return [];
  }

  // 合并多个字幕片段：展开 -> 按 from 排序 -> 去重（相同 from+content 视为重复）
  function mergeBodies(parts) {
    var all = [];
    parts.forEach(function (b) { if (b && b.body && b.body.length) all = all.concat(b.body); });
    all.sort(function (a, b) { return (a.from || 0) - (b.from || 0); });
    var seen = {}, out = [];
    all.forEach(function (x) {
      var k = (x.from || 0) + '|' + (x.content || '');
      if (!seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  }
  // 从页面初始状态取视频总时长（秒），用于完整性自检
  function getVideoDuration() {
    var st = getPageState();
    try {
      if (st.videoData && st.videoData.duration) return Number(st.videoData.duration) || 0;
      if (st.epInfo && st.epInfo.duration) return Number(st.epInfo.duration) || 0;
    } catch (e) {}
    return 0;
  }
  // 完整性自检：若末句结束时间远小于视频时长，疑似截断
  function checkIntegrity(body, duration) {
    if (!body || !body.length || !duration) return false;
    var lastTo = body[body.length - 1].to || 0;
    return lastTo < duration * 0.9; // 覆盖不到视频 90% -> 提示可能不完整
  }

  async function fetchBody(lan) {
    var key = (state.bvid || state.aid) + '_' + state.cid + '_' + lan;
    if (cache[key]) { state.body = cache[key]; state.lan = lan; return state.body; }
    var sub = state.subs.filter(function (s) { return s.lan === lan; })[0];
    if (!sub) throw new Error('未找到该语言字幕');
    // 下载该语言下的全部片段（长视频可能有多段），单段超时放宽到 30s
    var parts = [];
    for (var i = 0; i < sub.urls.length; i++) {
      var d = JSON.parse(await gx(sub.urls[i], 30000));
      parts.push(d);
    }
    if (!parts.length) throw new Error('字幕内容为空');
    var merged = mergeBodies(parts);
    if (!merged.length) throw new Error('字幕内容为空');
    // 完整性自检：末句远早于视频总长，则打标记供 UI 提示
    merged.incomplete = checkIntegrity(merged, getVideoDuration());
    state.body = merged; state.lan = lan;
    cache[key] = merged;
    return merged;
  }

  async function getSubtitles() {
    state.loading = true; state.err = ''; render();
    try {
      if (!state.cid) { if (!await resolveVideo()) throw new Error('无法获取视频 cid'); }
      if (!state.subs.length) { var list = await fetchSubList(); if (!list.length) { state.err = ''; state.noSub = true; state.loading = false; render(); return; } }
      var lan = pickLanguage(state.subs);
      await fetchBody(lan);
      state.loading = false; render();
    } catch (e) {
      log(e); state.err = '提取失败：' + e.message; state.loading = false; render();
    }
  }

  async function switchLan(lan) {
    state.loading = true; render();
    try { await fetchBody(lan); state.loading = false; render(); }
    catch (e) { log(e); state.err = '切换语言失败：' + e.message; state.loading = false; render(); }
  }

  // ===================== 复制 / 下载 =====================
  function copyText(txt) {
    if (!txt) return;
    var done = function () { toast('已复制 ' + txt.replace(/\s/g, '').length + ' 字'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }
  function download(name, content, mime) {
    try {
      var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
      toast('已下载 ' + name);
    } catch (e) { toast('下载失败'); }
  }

  // ===================== UI =====================
  var root = null;
  function buildUI() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'bsr-root';
    root.innerHTML =
      '<style>' +
      '#bsr-root{position:fixed;right:16px;bottom:120px;z-index:999999;font-family:-apple-system,"PingFang SC",sans-serif}' +
      '#bsr-fab{width:52px;height:52px;border:none;border-radius:50%;background:linear-gradient(135deg,#FB7299,#FF6B9D);color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 16px rgba(251,114,153,.5);transition:.15s}' +
      '#bsr-fab:hover{transform:scale(1.08)}' +
      '#bsr-panel{display:none;position:fixed;right:16px;bottom:180px;width:340px;max-height:70vh;background:#fff;color:#222;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.25);overflow:hidden;flex-direction:column}' +
      '#bsr-panel.show{display:flex}' +
      '.bsr-h{display:flex;align-items:center;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#FB7299,#FF6B9D);color:#fff;font-weight:700;font-size:14px}' +
      '.bsr-h .x{margin-left:auto;cursor:pointer;font-weight:400;opacity:.9}' +
      '.bsr-b{padding:12px 14px;overflow:auto}' +
      '.bsr-title{font-size:12px;color:#888;margin-bottom:8px;line-height:1.4;max-height:34px;overflow:hidden}' +
      '.bsr-row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}' +
      '.bsr-sel{flex:1;min-width:120px;padding:6px 8px;border:1px solid #eee;border-radius:8px;font-size:12px}' +
      '.bsr-btn{padding:8px 12px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;color:#fff}' +
      '.bsr-get{background:#FB7299;width:100%;margin-bottom:8px}' +
      '.bsr-get:disabled{opacity:.6;cursor:default}' +
      '.bsr-c{background:#7C5CBF}.bsr-t{background:#4ecca3}.bsr-s{background:#3a8ee6}' +
      '.bsr-ta{width:100%;height:180px;box-sizing:border-box;border:1px solid #eee;border-radius:8px;padding:8px;font-size:12px;line-height:1.6;resize:vertical;font-family:inherit}' +
      '.bsr-st{font-size:11px;color:#999;margin:6px 0;min-height:14px}' +
      '.bsr-ops{display:flex;gap:8px;margin-top:8px}' +
      '.bsr-ops .bsr-btn{flex:1}' +
      '#bsr-toast{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#4ecca3;color:#111;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:700;z-index:1000000;opacity:0;transition:.25s;pointer-events:none}' +
      '#bsr-toast.show{opacity:1}' +
      '</style>' +
      '<button id="bsr-fab" title="字幕提取">🎬</button>' +
      '<div id="bsr-panel">' +
      '  <div class="bsr-h">📝 字幕提取 <span class="x" id="bsrClose">✕</span></div>' +
      '  <div class="bsr-b">' +
      '    <div class="bsr-title" id="bsrTitle">—</div>' +
      '    <button class="bsr-btn bsr-get" id="bsrGet">⚡ 获取字幕</button>' +
      '    <div class="bsr-row" id="bsrLanRow" style="display:none">' +
      '      <select class="bsr-sel" id="bsrLan"></select>' +
      '    </div>' +
      '    <div class="bsr-st" id="bsrStatus"></div>' +
      '    <textarea class="bsr-ta" id="bsrOut" readonly placeholder="点击「获取字幕」后，字幕文字将显示在这里"></textarea>' +
      '    <div class="bsr-ops" id="bsrOps" style="display:none">' +
      '      <button class="bsr-btn bsr-c" id="bsrCopy">📋 复制</button>' +
      '      <button class="bsr-btn bsr-t" id="bsrTxt">⬇ TXT</button>' +
      '      <button class="bsr-btn bsr-s" id="bsrSrt">⬇ SRT</button>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div id="bsr-toast"></div>';
    document.body.appendChild(root);

    root.querySelector('#bsr-fab').onclick = function () { var show = root.querySelector('#bsr-panel').classList.toggle('show'); if (show && !state.body && !state.loading && !state.noSub && !state.err) getSubtitles(); };
    root.querySelector('#bsrClose').onclick = function () { root.querySelector('#bsr-panel').classList.remove('show'); };
    root.querySelector('#bsrGet').onclick = getSubtitles;
    // 复制按钮始终可用：有字幕复制字幕，无字幕复制视频信息纯文本
    root.querySelector('#bsrCopy').onclick = function () { copyText(state.body ? bodyToTxt(state.body) : getVideoInfoText()); };
    root.querySelector('#bsrTxt').onclick = function () { if (state.body) download(safeName(state.title) + '_' + state.lan + '.txt', bodyToTxt(state.body)); };
    root.querySelector('#bsrSrt').onclick = function () { if (state.body) download(safeName(state.title) + '_' + state.lan + '.srt', bodyToSrt(state.body), 'text/plain;charset=utf-8'); };
    root.querySelector('#bsrLan').onchange = function (e) { switchLan(e.target.value); };
  }

  function render() {
    if (!root) return;
    var $ = function (id) { return root.querySelector(id); };
    $('#bsrTitle').textContent = state.title || '—';
    var btn = $('#bsrGet');
    if (state.loading) { btn.disabled = true; btn.textContent = '⏳ 获取中...'; }
    else { btn.disabled = false; btn.textContent = '⚡ 获取字幕'; }
    var st = $('#bsrStatus');
    if (state.err) st.textContent = '⚠️ ' + state.err;
    else if (state.loading) st.textContent = '正在拉取字幕...';
    else if (state.noSub) st.textContent = 'ℹ️ 本视频无字幕（已为你准备视频信息，点击复制即可）';
    else if (state.body) {
      var warn = state.body.incomplete ? ' ⚠️ 字幕可能不完整' : '';
      st.textContent = '✅ ' + state.body.length + ' 句 · ' + (state.lan || '') + ' · ' + bodyToTxt(state.body).replace(/\s/g, '').length + ' 字' + warn;
    } else st.textContent = '';
    // 文本框：有字幕显字幕，无字幕显视频信息（可直接复制）
    $('#bsrOut').value = state.body ? bodyToTxt(state.body) : (state.noSub ? getVideoInfoText() : '');
    // 语言下拉
    var lanRow = $('#bsrLanRow'), sel = $('#bsrLan');
    if (state.subs.length) {
      lanRow.style.display = 'flex';
      sel.innerHTML = state.subs.map(function (s) { return '<option value="' + s.lan + '"' + (s.lan === state.lan ? ' selected' : '') + '>' + (s.lan_doc || s.lan) + ' (' + s.lan + ')' + (s.urls.length > 1 ? ' ×' + s.urls.length + '段' : '') + '</option>'; }).join('');
    } else lanRow.style.display = 'none';
    // 复制按钮始终可用；TXT/SRT 仅在有字幕时有效（点击时已做保护）
    $('#bsrOps').style.display = 'flex';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = root && root.querySelector('#bsr-toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ===================== 启动 / 视频切换检测 =====================
  function resetForNewVideo() {
    state.cid = null; state.subs = []; state.body = null; state.lan = ''; state.err = ''; state.noSub = false; state.loading = false;
    var st = getPageState();
    state.bvid = ''; state.aid = ''; state.title = '';
    try {
      if (st.videoData) { state.bvid = st.videoData.bvid || ''; state.aid = st.videoData.aid || ''; }
      if (!state.bvid) { var m = location.pathname.match(/BV\w+/); if (m) state.bvid = m[0]; }
    } catch (e) {}
    render();
  }

  function boot() {
    buildUI();
    resolveVideo().then(render);
    var last = location.href;
    setInterval(function () {
      if (location.href !== last) { last = location.href; setTimeout(resetForNewVideo, 800); }
    }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
