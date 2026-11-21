/* 851 · AI 错题助手（共用模块，构建时原样发布）
 *
 * 设计（2026-11-21 定稿）：
 *  - 默认「快问」两段（≤80 字/段）；不满意点「深析」出四段（≤160 字/段）
 *  - 追问只发「上一轮摘要 + 新问题」，不重发题干
 *  - 默认不落盘：输出是草稿，点「保留这段」才进 g851-ai-keep（同时写缓存）
 *  - 每日 30 次预算，只记次数与 token，不记内容
 *  - AI 判「站内可能有错/缺漏」→ 进 g851-ai-sus 存疑清单，不写回站内
 *  - Key 只存本机 localStorage；请求由浏览器直发 API
 *
 * 用法：
 *   <script src="ai-common.js"></script>
 *   <button class="g851-ai-btn" data-ai-tag="2010-1" data-ai-title="…" data-ai-lost="10">AI</button>
 * 也可手动： G851AI.open({ tag, title, lost, sub })
 */
(function () {
  'use strict';

  var CFG = 'g851-ai', USE = 'g851-ai-usage', CACHE = 'g851-ai-cache',
      KEEP = 'g851-ai-keep', SUS = 'g851-ai-sus';
  var DEFAULT_BASE = 'https://api.deepseek.com';
  var DEFAULT_MODEL = 'deepseek-chat';
  var CACHE_MAX = 50;
  var BUDGET = 30;

  function jget(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }
  function normKey(v) { return String(v == null ? '' : v).replace(/\s+/g, ''); }
  function normBase(v) {
    var b = String(v == null ? '' : v).trim().replace(/\s+/g, '');
    if (!b) b = DEFAULT_BASE;
    if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
    b = b.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    return b;
  }
  function normModel(v) { var m = String(v == null ? '' : v).trim(); return m || DEFAULT_MODEL; }
  function cfg() {
    var c = jget(CFG) || {};
    return { key: normKey(c.key), base: normBase(c.base), model: normModel(c.model),
             budget: c.budget || BUDGET };
  }
  function saveInputs() {
    var k = document.getElementById('gaiKey'), b = document.getElementById('gaiBase'),
        m = document.getElementById('gaiModel'), bg = document.getElementById('gaiBudget');
    if (!k) return null;
    var c = { key: normKey(k.value), base: normBase(b.value), model: normModel(m.value),
              budget: Math.max(1, parseInt(bg.value, 10) || BUDGET) };
    jset(CFG, c);
    k.value = c.key; b.value = c.base; m.value = c.model;
    paintMeter(); paintDiagnose();
    return c;
  }
  function paintDiagnose() {
    var el = document.getElementById('gaiDiag');
    if (!el) return;
    var c = cfg(), src = location.protocol === 'file:' ? 'file://（本地文件）' : location.origin;
    el.textContent = '页面 ' + src + ' · Key 长度 ' + c.key.length
      + (c.key ? '（' + c.key.slice(0, 6) + '…）' : '（空）')
      + ' · base ' + c.base + ' · model ' + c.model
      + ' · 上下文 ' + (window.G851_CTX ? '已预载' : '按需加载');
  }
  function usage() {
    var u = jget(USE) || {};
    if (u.d !== today()) u = { d: today(), calls: 0, tokens: 0 };
    return u;
  }
  function bump(n, tk) {
    var u = usage();
    u.calls += 1; u.tokens += (tk || 0);
    jset(USE, u);
    paintMeter();
  }

  /* ── 题面/答案获取（同源 fetch，按标签缓存一页） ─────────────── */
  var QMAP = {}, PAGECACHE = {};
  function loadQIndex(cb) {
    if (window.G851_Q) { indexIt(); cb && cb(); return; }
    var s = document.createElement('script');
    s.src = 'qindex.js';
    s.onload = function () { indexIt(); cb && cb(); };
    s.onerror = function () { cb && cb(); };
    document.head.appendChild(s);
  }
  function indexIt() {
    var Q = window.G851_Q || [];
    for (var i = 0; i < Q.length; i++) QMAP[Q[i][0]] = { f: Q[i][1], id: Q[i][2], t: Q[i][3] };
  }
  function pageText(file) {
    if (PAGECACHE[file]) return Promise.resolve(PAGECACHE[file]);
    return fetch(file).then(function (r) { return r.text(); }).then(function (h) {
      PAGECACHE[file] = h;
      return h;
    });
  }
  var CTXLOAD = {};
  function ctxFromScript(tag, cb) {
    if (window.G851_CTX && G851_CTX[tag]) { cb(G851_CTX[tag]); return; }
    var q = QMAP[tag];
    if (!q) { cb(null); return; }
    var file = 'ai-ctx/' + q.f.replace(/\.html$/i, '.js');
    if (CTXLOAD[file]) { CTXLOAD[file].push(cb); return; }
    CTXLOAD[file] = [cb];
    var s = document.createElement('script');
    s.src = file;
    var flush = function () {
      (CTXLOAD[file] || []).forEach(function (f2) {
        var v = (window.G851_CTX && G851_CTX[tag]) || null;
        try { f2(v); } catch (e) {}
      });
      CTXLOAD[file] = [];
    };
    s.onload = flush;
    s.onerror = function () { CTXLOAD[file] = []; cb(null); };
    document.head.appendChild(s);
  }
  function grab(tag) {
    var q = QMAP[tag];
    if (!q) return Promise.resolve({ stem: '', ans: '', title: '', src: 'none' });
    return new Promise(function (resolve) {
      ctxFromScript(tag, function (v) {
        if (v) {
          resolve({ stem: (v[0] || '').slice(0, 600), ans: (v[1] || '').slice(0, 700),
                    title: q.t || '', src: 'ctx' });
          return;
        }
        /* 兜底：现场 fetch（http 下有效；file:// 会被浏览器拦） */
        pageText(q.f).then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var el = doc.getElementById(q.id);
          var txt = function (sel) {
            var e = el && el.querySelector(sel);
            return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
          };
          resolve({ stem: txt('.stem').slice(0, 600), ans: txt('.ans').slice(0, 700),
                    title: q.t || '', src: 'fetch' });
        }).catch(function () {
          resolve({ stem: '', ans: '', title: q.t || '', src: 'fail' });
        });
      });
    });
  }

  /* ── prompt ─────────────────────────────────────────────── */
  var SYS = '你是考研「851 物理光学与应用光学」助教。只答与本题有关的内容：'
    + '不聊规划/心态/其他科目，不复述题干，不编造页码与出处，超纲内容不写。'
    + '任何数值结果必须带一行算式。不确定就直说“这一步我不能确定”。';

  function promptQuick(ctx, doubt) {
    return '【题目】' + (ctx.stem || ctx.tag) + '\n'
      + '【站内答案（可能不完整，仅对照）】' + (ctx.ans || '（无）') + '\n'
      + '【我的疑问】' + (doubt || '这题的解题思路不会，按最可能的卡点讲') + '\n'
      + '严格两段、每段不超过 80 字：\n'
      + '【要点】这题该怎么做（关键一步与结果）。\n'
      + '【站内对照】站内答案缺什么或哪里可能不对；没问题写“与站内一致”。';
  }
  function promptDeep(ctx, doubt) {
    return '【题目】' + (ctx.stem || ctx.tag) + '\n'
      + '【站内答案（可能不完整或有错，仅对照）】' + (ctx.ans || '（无）') + '\n'
      + '【我的疑问】' + (doubt || '按最可能的卡点讲') + '\n'
      + '严格四段，每段不超过 160 字：\n'
      + '【独立解法】从题干出发，关键步骤+中间量+最终结果（带单位/方向）。\n'
      + '【与站内答案对照】站内是否算错（错在哪一步、正确值）、是否跳步漏条件；无问题写“与站内一致”。\n'
      + '【补充解析】把没讲透的推导/易错点/判据补出来。\n'
      + '【可背诵】3 条以内短句。';
  }
  function promptFollow(summary, doubt) {
    return '【上一轮结论摘要】' + summary + '\n【追问】' + doubt + '\n'
      + '只回答追问本身，不超过 120 字；需要算式就给关键那一步。';
  }

  /* ── 调用（流式） ────────────────────────────────────────── */
  function callApi(messages, maxTokens, onDelta) {
    var c = cfg();
    if (!c.key) return Promise.reject(new Error('NO_KEY'));
    if (navigator.onLine === false) return Promise.reject(new Error('OFFLINE'));
    var body = {
      model: c.model, temperature: 0.2, max_tokens: maxTokens, stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: SYS }].concat(messages)
    };
    return fetch(c.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var e = new Error('HTTP ' + r.status + ' ' + t.slice(0, 160));
          e.status = r.status; throw e;
        });
      }
      var acc = '', tokens = 0;
      if (!r.body || !r.body.getReader) {
        return r.json().then(function (j) {
          acc = j.choices[0].message.content;
          tokens = (j.usage && j.usage.total_tokens) || 0;
          onDelta(acc, true); return { text: acc, tokens: tokens };
        });
      }
      var rd = r.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return rd.read().then(function (x) {
          if (x.done) return { text: acc, tokens: tokens };
          buf += dec.decode(x.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (line.indexOf('data:') !== 0) return;
            var d = line.slice(5).trim();
            if (!d || d === '[DONE]') return;
            try {
              var j = JSON.parse(d);
              if (j.usage && j.usage.total_tokens) tokens = j.usage.total_tokens;
              var c2 = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (c2) { acc += c2; onDelta(acc, false); }
            } catch (e) {}
          });
          return pump();
        });
      }
      return pump();
    });
  }

  /* ── 判定 / 保留 / 存疑 ─────────────────────────────────── */
  function verdictOf(text) {
    if (/站内[^。\n]{0,12}(一致|没问题|无误)/.test(text)) return '一致';
    if (/站内[^。\n]{0,16}(可能|疑似)?[^。\n]{0,6}(错|误)/.test(text)) return '站内可能有错';
    if (/站内[^。\n]{0,16}(缺|漏|跳步|不全|不完整)/.test(text)) return '站内缺/漏';
    return '未判定';
  }
  function keepOne(ctx, text, mode) {
    var k = jget(KEEP) || {};
    var arr = k[ctx.tag] || (k[ctx.tag] = []);
    arr.push({
      at: today(), model: cfg().model, mode: mode,
      verdict: verdictOf(text), text: text
    });
    while (arr.length > 8) arr.shift();
    jset(KEEP, k);
    /* 只缓存被保留的结果 → 下次同题同问 0 token */
    var ck = hash(ctx.tag + '|' + mode + '|' + (ctx.doubt || ''));
    var c = jget(CACHE) || {};
    c[ck] = { tag: ctx.tag, mode: mode, text: text, at: today(), verdict: verdictOf(text) };
    var keys = Object.keys(c);
    if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach(function (x) { delete c[x]; });
    jset(CACHE, c);
    /* 站内可能有错 → 存疑清单（不写回站内） */
    if (verdictOf(text) === '站内可能有错') {
      var s = jget(SUS) || {};
      s[ctx.tag] = { at: today(), model: cfg().model, reason: text.slice(0, 240) };
      jset(SUS, s);
    }
  }
  function cacheGet(ctx, mode) {
    var c = jget(CACHE) || {};
    var ck = hash(ctx.tag + '|' + mode + '|' + (ctx.doubt || ''));
    return c[ck] || null;
  }

  /* ── UI ─────────────────────────────────────────────────── */
  var CSS = ''
    + '#gai{position:fixed;inset:0;z-index:85;background:rgba(20,18,16,.5);display:none;'
    + 'align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)}'
    + '#gai.on{display:flex}'
    + '#gai .box{position:relative;background:#fff;width:100%;max-width:720px;border-radius:14px 14px 0 0;'
    + 'box-shadow:0 -10px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:88vh;overflow:hidden}'
    + '@media(min-width:760px){#gai{align-items:center;padding:4vh 14px}#gai .box{border-radius:14px;max-height:86vh}}'
    + '#gai .hd{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid #efe9e0;flex-wrap:wrap}'
    + '#gai .hd b{color:#6d3a24;font-size:15px}'
    + '#gai .hd .m{margin-left:auto;font-size:12px;color:#8a7a6a}'
    + '#gai .hd button.ai-x{border:1px solid #d8cfc2;background:#fff;color:#6d3a24;border-radius:12px;'
    + 'padding:3px 10px;font:12px inherit;cursor:pointer;font-family:inherit}'
    + '#gai .bd{padding:12px 14px;overflow:auto;flex:1 1 auto}'
    + '#gai .q{font-size:13px;color:#6b6259;margin:0 0 8px}'
    + '#gai textarea{width:100%;min-height:56px;border:1px solid #e3dfd7;border-radius:9px;'
    + 'padding:8px 10px;font:13.5px/1.6 inherit;resize:vertical;box-sizing:border-box}'
    + '#gai .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}'
    + '#gai .row button{flex:1 1 110px;padding:8px 12px;border-radius:9px;border:1px solid #d8cfc2;'
    + 'background:#fff;color:#6d3a24;font:13px inherit;cursor:pointer;font-family:inherit}'
    + '#gai .row button.main{background:#8c4a2f;border-color:#8c4a2f;color:#fff;font-weight:600}'
    + '#gai .row button:disabled{opacity:.5;cursor:default}'
    + '#gai .out{margin-top:12px;padding:12px 14px;background:#fbf8f3;border:1px solid #efe7da;'
    + 'border-radius:10px;font-size:14px;line-height:1.75;white-space:pre-wrap;word-break:break-word;min-height:60px}'
    + '#gai .out.err{background:#fdf4f3;border-color:#e8c6c1;color:#8a2f24}'
    + '#gai .meta{margin-top:8px;font-size:12px;color:#8a7a6a;display:flex;gap:10px;flex-wrap:wrap}'
    + '#gai .vt{font-weight:700}'
    + '#gai .vt.bad{color:#a8332a}#gai .vt.warn{color:#9a6a12}#gai .vt.ok{color:#2f6b34}'
    + '#gai .set{display:none}#gai.setting .set{display:block}#gai.setting .run{display:none}'
    + '#gai .set label{display:block;font-size:12.5px;color:#6b6259;margin:8px 0 4px}'
    + '#gai .set textarea{min-height:36px}'
    + '#gai .ft{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #efe9e0;flex-wrap:wrap}'
    + '#gai .ft button{flex:1 1 120px;padding:8px 12px;border-radius:9px;border:1px solid #d8cfc2;'
    + 'background:#fff;color:#6d3a24;font:13px inherit;cursor:pointer;font-family:inherit}'
    + '#gai .ft button.main{background:#8c4a2f;border-color:#8c4a2f;color:#fff;font-weight:600}'
    + '#gai .ft button.keep.on{background:#eef7ee;border-color:#bcd9bc;color:#2f6b34;font-weight:600}'
    + '#gai .ft #gaiSave{display:none}'
    + '#gai.setting .ft #gaiSave{display:block}'
    + '#gai.setting .ft #gaiKeep,#gai.setting .ft #gaiFollow,#gai.setting .ft #gaiCopy{display:none}'
    + '#gai .probe{margin-top:10px;font-size:12.5px;color:#6b6259;min-height:18px;word-break:break-word}'
    + '#gai .probe.ok{color:#2f6b34}#gai .probe.bad{color:#a8332a}'
    + '#gai .diag{margin-top:6px;font-size:11.5px;color:#9a9086;word-break:break-all}'
    + '#gai .ctxwarn{margin:6px 0 0;font-size:12.5px;color:#a8332a;line-height:1.6}'
    + '#gai .savedtip{position:absolute;left:50%;bottom:56px;transform:translate(-50%,8px);background:#2b241d;color:#f4ede2;border-radius:9px;padding:7px 13px;font-size:12.5px;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;white-space:nowrap;z-index:2}'
    + '#gai .savedtip.on{opacity:1;transform:translate(-50%,0)}'
    + '@media print{#gai{display:none!important}}';

  var S = null;   /* 当前会话：{ tag, title, lost, sub, doubt, mode, ctx, text, summary, kept } */

  function mount() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    var d = document.createElement('div');
    d.id = 'gai';
    d.innerHTML = ''
      + '<div class="box">'
      + '  <div class="hd"><b id="gaiT">AI 错题助手</b><span class="m" id="gaiM">快问 · 约 400 token</span>'
      + '    <button class="ai-x" id="gaiSet" type="button">设置</button>'
      + '    <button class="ai-x" id="gaiX" type="button">关闭</button></div>'
      + '  <div class="bd">'
      + '    <div class="run">'
      + '      <p class="q" id="gaiQ">点「保留」才会保存；否则关闭即丢弃。</p>'
      + '      <p class="ctxwarn" id="gaiCtxWarn"></p>'
      + '      <textarea id="gaiDoubt" placeholder="我卡在哪儿 / 具体想问什么（可留空）"></textarea>'
      + '      <div class="row"><button class="main" id="gaiGo" type="button">快问</button>'
      + '        <button id="gaiDeep" type="button">深析</button></div>'
      + '      <div class="out" id="gaiOut">选好模式开始；快问便宜，深析更全。</div>'
      + '      <div class="meta"><span id="gaiMeta"></span><span id="gaiVerdict"></span></div>'
      + '    </div>'
      + '    <div class="set">'
      + '      <label>API Key（DeepSeek 或其它 OpenAI 兼容服务；platform.deepseek.com 申请）</label>'
      + '      <textarea id="gaiKey"></textarea>'
      + '      <label>接口地址</label><textarea id="gaiBase"></textarea>'
      + '      <label>模型</label><textarea id="gaiModel"></textarea>'
      + '      <label>每日预算（次）</label><textarea id="gaiBudget"></textarea>'
+ '      <div class="row"><button class="main" id="gaiProbe" type="button">测试连接</button></div>'
+ '      <div class="probe" id="gaiProbe"></div>'
+ '      <div class="diag" id="gaiDiag"></div>'
      + '    </div>'
      + '  </div>'
      + '  <div class="ft">'
      + '    <button class="keep" id="gaiKeep" type="button">保留这段</button>'
      + '    <button id="gaiFollow" type="button">追问</button>'
      + '    <button id="gaiCopy" type="button">复制</button>'
      + '    <button id="gaiSave" type="button" style="display:none">保存设置</button>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(d);

    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    document.getElementById('gaiX').onclick = close;
    document.getElementById('gaiSet').onclick = function () { d.classList.toggle('setting'); };
    document.getElementById('gaiSave').onclick = function () {
      saveInputs();
      d.classList.remove('setting');
    };
    var pb = document.getElementById('gaiProbe');
    if (pb) pb.onclick = probe;
    document.getElementById('gaiGo').onclick = function () { run('quick'); };
    document.getElementById('gaiDeep').onclick = function () { run('deep'); };
    document.getElementById('gaiKeep').onclick = keep;
    document.getElementById('gaiFollow').onclick = follow;
    document.getElementById('gaiCopy').onclick = function () {
      var tx = document.getElementById('gaiOut').textContent || '';
      var b = document.getElementById('gaiCopy');
      if (navigator.clipboard) navigator.clipboard.writeText(tx).then(function () {
        b.textContent = '已复制'; setTimeout(function () { b.textContent = '复制'; }, 1400);
      }, function () { alert(tx); });
      else alert(tx);
    };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  function probe() {
    var out = document.getElementById('gaiProbe');
    var c = saveInputs();
    if (!out) return;
    if (!c || !c.key) { out.className = 'probe bad'; out.textContent = '先填 Key 再测。'; return; }
    out.className = 'probe'; out.textContent = '测试中…';
    var t0 = Date.now();
    function done(ok, msg) {
      out.className = 'probe ' + (ok ? 'ok' : 'bad');
      out.textContent = msg + '（' + (Date.now() - t0) + 'ms）';
    }
    fetch(c.base + '/models', { headers: { 'Authorization': 'Bearer ' + c.key } })
      .then(function (r) {
        if (r.status === 200) return r.json().then(function (j) {
          var n = (j && j.data && j.data.length) || 0;
          done(true, '连接正常，返回 ' + n + ' 个模型，可以直接点「快问」。');
        });
        if (r.status === 401 || r.status === 403) return r.text().then(function (x) {
          done(false, 'Key 被拒（' + r.status + '）：' + x.slice(0, 130));
        });
        if (r.status === 402) return done(false, '余额不足（402）。');
        return probeChat(c, out, t0);
      })
      .catch(function (err) {
        done(false, '网络/CORS 失败：' + String(err && err.message || err)
          + ' → 检查网络；若页面是 file:// 打开，建议用 http 方式访问。');
      });
  }
  function probeChat(c, out, t0) {
    out.textContent = '该服务没有 /models，改用最小对话测试…';
    return fetch(c.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.key },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
    }).then(function (r) {
      return r.text().then(function (x) {
        var ms = Date.now() - t0;
        if (r.status === 200) { out.className = 'probe ok'; out.textContent = '连接正常（最小对话通过）。（' + ms + 'ms）'; return; }
        if (r.status === 401 || r.status === 403) { out.className = 'probe bad'; out.textContent = 'Key 被拒（' + r.status + '）：' + x.slice(0, 140); return; }
        if (r.status === 402) { out.className = 'probe bad'; out.textContent = '余额不足（402）：' + x.slice(0, 120); return; }
        out.className = 'probe bad';
        out.textContent = 'HTTP ' + r.status + '：' + x.slice(0, 150)
          + ' → 常见：model 名写错 / base 少了 /v1（OpenAI 兼容服务）/ 模型无权访问。';
      });
    }).catch(function (err) {
      out.className = 'probe bad';
      out.textContent = '网络/CORS 失败：' + String(err && err.message || err);
    });
  }

  function paintMeter() {
    var u = usage(), c = cfg(), m = document.getElementById('gaiMeta');
    var mode = S && S.mode === 'deep' ? '深析' : '快问';
    var tk = Math.round(u.tokens / 100) / 10;
    if (m) m.textContent = '';
    var hm = document.getElementById('gaiM');
    if (hm) hm.textContent = mode + ' · 今日 ' + u.calls + '/' + c.budget + ' 次 · 约 ' + tk + 'k token';
  }
  function open(opts) {
    if (!S) mount();
    S = { tag: opts.tag || '', title: opts.title || '', lost: opts.lost || '', sub: opts.sub || '',
          mode: 'quick', ctx: null, text: '', summary: '', kept: false };
    document.getElementById('gaiT').textContent = 'AI · ' + (opts.tag || '');
    document.getElementById('gaiQ').textContent = (opts.title ? opts.title + '　' : '')
      + (opts.lost ? '失 ' + opts.lost + ' 分' : '') + '　·　点「保留」才会保存，否则关闭即丢弃';
    document.getElementById('gaiOut').className = 'out';
    document.getElementById('gaiOut').textContent = '选好模式开始；快问便宜（两段 ≤80 字），深析更全（四段）。';
    document.getElementById('gaiCtxWarn').textContent = '';
    document.getElementById('gaiVerdict').textContent = '';
    document.getElementById('gaiKeep').classList.remove('on');
    document.getElementById('gaiKeep').textContent = '保留这段';
    document.getElementById('gaiFollow').disabled = true;
    document.getElementById('gaiSave').style.display = 'none';
    document.getElementById('gai').classList.add('on');
    var c = cfg();
    document.getElementById('gaiKey').value = c.key || '';
    document.getElementById('gaiBase').value = c.base || DEFAULT_BASE;
    document.getElementById('gaiModel').value = c.model || DEFAULT_MODEL;
    document.getElementById('gaiBudget').value = c.budget || BUDGET;
    paintMeter();
    paintDiagnose();
    if (!S.ctx) {
      S.ctx = { tag: S.tag, stem: '', ans: '' };
      grab(S.tag).then(function (r) { S.ctx.stem = r.stem; S.ctx.ans = r.ans; });
    }
    if (!cfg().key) document.getElementById('gai').classList.add('setting');
  }
  function close() {
    var d = document.getElementById('gai');
    if (d) d.classList.remove('on');
    S = null;   /* 草稿随会话丢弃：没点保留就是不落盘 */
  }

  function run(mode) {
    if (!S) return;
    var kEl = document.getElementById('gaiKey'), bEl = document.getElementById('gaiBase');
    var saved = jget(CFG) || {};
    if (kEl && (normKey(kEl.value) !== normKey(saved.key) || normBase(bEl ? bEl.value : '') !== normBase(saved.base))) {
      saveInputs();
    }
    var c = cfg();
    if (!c.key) { alert('先填 API Key（点右上「设置」）'); return; }
    var u = usage();
    if (u.calls >= (c.budget || BUDGET)) {
      if (!confirm('今天已用 ' + u.calls + ' 次（预算 ' + (c.budget || BUDGET) + '）。继续会超预算，确定？')) return;
    }
    var doubt = document.getElementById('gaiDoubt').value.trim();
    S.doubt = doubt; S.mode = mode;
    var out = document.getElementById('gaiOut');
    var go = document.getElementById('gaiGo'), deep = document.getElementById('gaiDeep');
    go.disabled = true; deep.disabled = true;
    document.getElementById('gaiVerdict').textContent = '';
    document.getElementById('gaiSave').style.display = '';
    document.getElementById('gaiFollow').disabled = true;

    var start = function () {
      var cache = cacheGet({ tag: S.tag, doubt: doubt }, mode);
      if (cache) {
        out.textContent = cache.text + '\n\n（命中缓存，本次 0 token）';
        S.text = cache.text;
        paintVerdict(cache.verdict);
        go.disabled = false; deep.disabled = false;
        document.getElementById('gaiFollow').disabled = false;
        return;
      }
      out.textContent = '正在' + (mode === 'deep' ? '深析' : '快问') + '…';
      var prompt = mode === 'deep' ? promptDeep(S.ctx, doubt) : promptQuick(S.ctx, doubt);
      var maxT = mode === 'deep' ? 800 : 320;
      callApi([{ role: 'user', content: prompt }], maxT, function (txt, done) {
        out.textContent = txt;
      }).then(function (r) {
        S.text = r.text;
        S.summary = r.text.slice(0, 80);
        bump(1, r.tokens);
        paintVerdict(verdictOf(r.text));
        document.getElementById('gaiFollow').disabled = false;
      }).catch(function (err) {
        out.className = 'out err';
        out.textContent = explain(err);
      }).then(function () {
        go.disabled = false; deep.disabled = false;
      });
    };
    if (!S.ctx.stem && !S.ctx.ans) {
      out.textContent = '正在取题干与答案…';
      grab(S.tag).then(function (r) {
        S.ctx.stem = r.stem; S.ctx.ans = r.ans; S.ctx.src = r.src;
        if (!r.stem && !r.ans) {
          document.getElementById('gaiCtxWarn').textContent =
            '⚠ 没取到题干/答案：多半是浏览器拦了本地文件读取。用 http 方式打开（或在手机上用线上地址）就正常。';
          document.getElementById('gaiOut').textContent =
            '没取到题干与答案，先只按你的问题回答；想要“站内对照”，请换 http 方式打开页面。';
        }
        start();
      });
    } else start();
  }

  function explain(err) {
    var m = String(err && err.message || err);
    if (m === 'NO_KEY') return '还没填 API Key：点右上「设置」。';
    if (m === 'OFFLINE') return '当前离线：AI 需要联网，其余功能照常。';
    if (/HTTP 401|HTTP 403/.test(m)) return 'Key 无效或无权限（401/403）。检查 Key 是否填对、是否欠费。';
    if (/HTTP 402/.test(m)) return '账户余额不足（402）。';
    if (/HTTP 429/.test(m)) return '请求太频繁（429），等几秒再试。';
    if (/Failed to fetch|NetworkError/i.test(m)) return '网络请求失败：检查网络，或接口地址/跨域设置。\n' + m;
    return '分析失败：' + m;
  }
  function paintVerdict(v) {
    var el = document.getElementById('gaiVerdict');
    if (!el) return;
    if (v === '一致') { el.textContent = '站内答案：与 AI 独立解一致'; el.className = 'vt ok'; }
    else if (v === '站内缺/漏') { el.textContent = '站内答案：缺/漏，可保留给小牛补'; el.className = 'vt warn'; }
    else if (v === '站内可能有错') { el.textContent = '站内答案：可能有错（进存疑清单，不采信）'; el.className = 'vt bad'; }
    else { el.textContent = ''; el.className = 'vt'; }
  }

  /* 保留：这是唯一落盘动作 */
  function keep() {
    if (!S || !S.text) { alert('先跑一次分析再保留。'); return; }
    keepOne(S.ctx, S.text, S.mode);
    S.kept = true;
    var b = document.getElementById('gaiKeep');
    b.classList.add('on'); b.textContent = '✓ 已保留（可去 AI 笔记导出）';
    var n = 0;
    try { var k = jget(KEEP) || {}; n = (k[S.tag] || []).length; } catch (e) {}
    var tip = document.createElement('div');
    tip.className = 'savedtip';
    tip.textContent = '已保存第 ' + n + ' 段 · 去「AI 笔记」可核对/导出';
    document.getElementById('gai').appendChild(tip);
    setTimeout(function () { tip.classList.add('on'); }, 20);
    setTimeout(function () {
      tip.classList.remove('on');
      setTimeout(function () { tip.parentNode && tip.parentNode.removeChild(tip); }, 300);
    }, 2200);
  }

  /* 追问：只发摘要 + 新问题 */
  function follow() {
    if (!S || !S.text) return;
    var q = prompt('追问什么？（只发上一轮摘要，不重发题干）', '');
    if (!q || !q.trim()) return;
    var out = document.getElementById('gaiOut');
    out.className = 'out';
    out.textContent = '追问中…';
    var u = usage(), c = cfg();
    if (u.calls >= (c.budget || BUDGET)) {
      if (!confirm('今天已用 ' + u.calls + ' 次，继续超预算？')) return;
    }
    callApi([{ role: 'user', content: promptFollow(S.summary, q.trim()) }], 320,
      function (txt) { out.textContent = txt; }).then(function (r) {
      bump(1, r.tokens);
      S.text = r.text; S.summary = r.text.slice(0, 80);
      document.getElementById('gaiKeep').classList.remove('on');
      document.getElementById('gaiKeep').textContent = '保留这段';
      S.kept = false;
    }).catch(function (err) {
      out.className = 'out err';
      out.textContent = explain(err);
    });
  }

  /* ── 自动绑定 [data-ai-tag] ─────────────────────────────── */
  function bind(root) {
    var btns = (root || document).querySelectorAll('.g851-ai-btn[data-ai-tag]:not([data-ai-bound])');
    Array.prototype.forEach.call(btns, function (b) {
      b.setAttribute('data-ai-bound', '1');
      b.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        loadQIndex(function () {
          open({
            tag: b.getAttribute('data-ai-tag'),
            title: b.getAttribute('data-ai-title') || '',
            lost: b.getAttribute('data-ai-lost') || '',
            sub: b.getAttribute('data-ai-sub') || ''
          });
        });
      });
    });
  }

  window.G851AI = {
    open: function (o) { loadQIndex(function () { open(o); }); },
    bind: bind,
    cfg: cfg, usage: usage,
    keep: function (tag, text, mode) { keepOne({ tag: tag }, text, mode || 'quick'); },
    cache: { get: cacheGet, key: hash },
    verdict: verdictOf,
    notes: {
      keep: function () { return jget(KEEP) || {}; },
      sus: function () { return jget(SUS) || {}; },
      clear: function (which) {
        if (which === 'cache') localStorage.removeItem(CACHE);
        else if (which === 'usage') localStorage.removeItem(USE);
        else if (which === 'sus') localStorage.removeItem(SUS);
        else localStorage.removeItem(KEEP);
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bind(); });
  } else bind();
})();
