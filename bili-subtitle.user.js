// ==UserScript==
// @name         B站字幕提取
// @namespace    https://github.com/huanweide/bili-subtitle
// @version      5.0
// @description  提取B站官方字幕→一键复制
// @author       阿梓
// @include      /^https?:\/\/(www\.)?bilibili\.com\/video\/BV\w+/
// @include      /^https?:\/\/(www\.)?bilibili\.com\/bangumi\/play\//
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// @connect      hdslb.com
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  var _currentBvid = '';
  var _subtitleText = '';
  var _status = 'idle'; // idle|loading|done|no_sub

  console.log('%c[B站字幕] v5.0', 'color:#FB7299;font-weight:bold');

  // ===== 注入UI =====
  function inject() {
    // 检测视频切换
    var bvid = getBvid();
    if (bvid !== _currentBvid) {
      _currentBvid = bvid;
      _subtitleText = '';
      _status = 'idle';
      console.log('[B站字幕] 视频切换:', bvid);
    }

    // 移除旧UI
    var old = document.getElementById('bili-sub-root');
    if (old) old.remove();

    var r = document.createElement('div');
    r.id = 'bili-sub-root';
    r.innerHTML =
      '<style>' +
      '#bili-sub-root{position:fixed;right:16px;bottom:140px;z-index:99999;display:flex;flex-direction:column;gap:6px;align-items:flex-end}' +
      '#bili-sub-root .btn{padding:10px 18px;border:none;border-radius:18px;font-size:13px;font-weight:600;cursor:pointer;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.15);transition:.15s}' +
      '#bili-sub-root .btn-get{background:linear-gradient(135deg,#FB7299,#FF6B9D)}' +
      '#bili-sub-root .btn-copy{background:linear-gradient(135deg,#7C5CBF,#9C7CE5);display:none}' +
      '#bili-sub-root .st{font-size:11px;color:#aaa;text-align:right;margin-top:-2px;max-width:200px;word-break:break-all;line-height:1.3}' +
      '</style>' +
      '<button class="btn btn-get" id="bsGet">🎬 提取字幕</button>' +
      '<span class="st" id="bsStatus"></span>' +
      '<button class="btn btn-copy" id="bsCopy">📋 一键复制</button>';
    document.body.appendChild(r);

    document.getElementById('bsGet').onclick = run;
    document.getElementById('bsCopy').onclick = copy;

    // 恢复状态
    if (_subtitleText) showDone();
    updateStatus();
  }

  function updateStatus() {
    var el = document.getElementById('bsStatus');
    if (!el) return;
    if (_status === 'loading') el.textContent = '⏳ 查询中...';
    else if (_status === 'done') el.textContent = '✅ 成功 · ' + _subtitleText.replace(/\s/g,'').length + '字';
    else if (_status === 'no_sub') el.textContent = '⚠️ 该视频无字幕';
    else if (_status === 'error') el.textContent = '❌ 提取失败';
    else el.textContent = '';
  }

  function showDone() {
    document.getElementById('bsCopy').style.display = 'block';
  }

  function hideCopy() {
    document.getElementById('bsCopy').style.display = 'none';
  }

  function getBvid() {
    var m = location.pathname.match(/BV\w+/);
    return m ? m[0] : '';
  }

  // ===== 主流程 =====
  async function run() {
    _subtitleText = '';
    hideCopy();

    var bvid = getBvid();
    if (!bvid) {
      _status = 'error'; updateStatus(); return;
    }
    _currentBvid = bvid;

    _status = 'loading'; updateStatus();

    try {
      // 1. 获取cid
      var cid = await getCid(bvid);
      if (!cid) { _status = 'error'; updateStatus(); return; }

      // 2. 查字幕
      var subUrl = await checkSub(bvid, cid);
      if (!subUrl) {
        _status = 'no_sub'; updateStatus();
        return;
      }

      // 3. 下载字幕文本
      var text = await fetchSubText(subUrl);
      if (!text) { _status = 'error'; updateStatus(); return; }

      _subtitleText = text;
      _status = 'done'; updateStatus();
      showDone();

    } catch(e) {
      console.error('[B站字幕]', e);
      _status = 'error'; updateStatus();
    }
  }

  // ===== 复制 =====
  function copy() {
    if (!_subtitleText) return;
    navigator.clipboard.writeText(_subtitleText).then(function() {
      var el = document.getElementById('bsStatus');
      el.textContent = '📋 已复制！' + _subtitleText.replace(/\s/g,'').length + '字';
      setTimeout(function() { _status = 'done'; updateStatus(); }, 2000);
    }).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = _subtitleText; ta.style.position='fixed'; ta.style.left='-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      var el = document.getElementById('bsStatus');
      el.textContent = '📋 已复制！';
      setTimeout(function() { _status = 'done'; updateStatus(); }, 2000);
    });
  }

  // ===== API =====
  function getCid(bvid) {
    // 先查页面
    try {
      var s = window.__INITIAL_STATE__;
      if (s && s.videoData && s.videoData.cid) return s.videoData.cid;
    } catch(e) {}
    var ss = document.querySelectorAll('script');
    for (var i = 0; i < ss.length; i++) {
      var m = (ss[i].textContent || '').match(/"cid"\s*:\s*(\d+)/);
      if (m) return parseInt(m[1]);
    }

    // API兜底
    return new Promise(function(rs) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.bilibili.com/x/player/pagelist?bvid=' + bvid,
        headers: { 'Referer': 'https://www.bilibili.com/' },
        onload: function(r) {
          try {
            var d = JSON.parse(r.responseText);
            rs(d.code === 0 && d.data && d.data[0] ? d.data[0].cid : null);
          } catch(e) { rs(null); }
        },
        onerror: function() { rs(null); },
        timeout: 8000
      });
    });
  }

  function checkSub(bvid, cid) {
    return new Promise(function(rs) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.bilibili.com/x/player/v2?bvid=' + bvid + '&cid=' + cid,
        headers: { 'Referer': 'https://www.bilibili.com/' },
        onload: function(r) {
          try {
            var d = JSON.parse(r.responseText);
            if (d.code === 0 && d.data.subtitle && d.data.subtitle.subtitles && d.data.subtitle.subtitles.length > 0) {
              var u = d.data.subtitle.subtitles[0].subtitle_url;
              rs(u.indexOf('http') === 0 ? u : 'https:' + u);
            } else rs(null);
          } catch(e) { rs(null); }
        },
        onerror: function() { rs(null); },
        timeout: 10000
      });
    });
  }

  function fetchSubText(url) {
    return new Promise(function(rs) {
      GM_xmlhttpRequest({
        method: 'GET', url: url,
        headers: { 'Referer': 'https://www.bilibili.com/' },
        onload: function(r) {
          try {
            var d = JSON.parse(r.responseText);
            var lines = d.body.map(function(x) { return x.content; });
            rs(lines.join('\n'));
          } catch(e) { rs(null); }
        },
        onerror: function() { rs(null); },
        timeout: 15000
      });
    });
  }

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else { inject(); }

  var lastUrl = location.href;
  setInterval(function() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(inject, 1000);
    }
  }, 800);

})();