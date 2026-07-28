// ==UserScript==
// @name         B站字幕一键提取 · 极速版
// @namespace    https://github.com/huanweide/bili-subtitle
// @version      6.0
// @description  打开B站视频 → 点一下 → 秒级获取字幕（智能选中文源）→ 复制 / 下载 TXT·SRT。API 直取，无需 Cookie，纯本地运行。
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
    err: ''
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
      state.subs = d.data.subtitle.subtitles.map(function (s) {
        return { lan: s.lan, lan_doc: s.lan_doc, url: s.subtitle_url.indexOf('http') === 0 ? s.subtitle_url : 'https:' + s.subtitle_url };
      });
      return state.subs;
    }
    return [];
  }

  async function fetchBody(lan) {
    var key = (state.bvid || state.aid) + '_' + state.cid + '_' + lan;
    if (cache[key]) { state.body = cache[key]; state.lan = lan; return state.body; }
    var sub = state.subs.filter(function (s) { return s.lan === lan; })[0];
    if (!sub) throw new Error('未找到该语言字幕');
    var d = JSON.parse(await gx(sub.url, 15000));
    if (!d.body) throw new Error('字幕内容为空');
    state.body = d.body; state.lan = lan;
    cache[key] = d.body;
    return state.body;
  }

  async function getSubtitles() {
    state.loading = true; state.err = ''; render();
    try {
      if (!state.cid) { if (!await resolveVideo()) throw new Error('无法获取视频 cid'); }
      if (!state.subs.length) { var list = await fetchSubList(); if (!list.length) { state.err = '该视频暂无字幕（AI 或 CC 均无）'; state.loading = false; render(); return; } }
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

    root.querySelector('#bsr-fab').onclick = function () { root.querySelector('#bsr-panel').classList.toggle('show'); if (root.querySelector('#bsr-panel').classList.contains('show') && !state.body && !state.loading && !state.err) getSubtitles(); };
    root.querySelector('#bsrClose').onclick = function () { root.querySelector('#bsr-panel').classList.remove('show'); };
    root.querySelector('#bsrGet').onclick = getSubtitles;
    root.querySelector('#bsrCopy').onclick = function () { copyText(state.body ? bodyToTxt(state.body) : ''); };
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
    else if (state.body) st.textContent = '✅ ' + state.body.length + ' 句 · ' + (state.lan || '') + ' · ' + bodyToTxt(state.body).replace(/\s/g, '').length + ' 字';
    else st.textContent = '';
    $('#bsrOut').value = state.body ? bodyToTxt(state.body) : '';
    // 语言下拉
    var lanRow = $('#bsrLanRow'), sel = $('#bsrLan');
    if (state.subs.length) {
      lanRow.style.display = 'flex';
      sel.innerHTML = state.subs.map(function (s) { return '<option value="' + s.lan + '"' + (s.lan === state.lan ? ' selected' : '') + '>' + (s.lan_doc || s.lan) + ' (' + s.lan + ')</option>'; }).join('');
    } else lanRow.style.display = 'none';
    $('#bsrOps').style.display = state.body ? 'flex' : 'none';
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
    state.cid = null; state.subs = []; state.body = null; state.lan = ''; state.err = ''; state.loading = false;
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
