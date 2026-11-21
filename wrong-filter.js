/* 851 · 错题「订正/移除」覆盖层（共用，构建时发布到站点根）
 *
 * 设计（2026-11-21）：
 *  - 判分记录 g851-mock2-* 是**分数历史**，任何操作都不动它；
 *  - 错题本里「移除」只是在这个覆盖层里记一笔 → 列表少一条，分数不变；
 *  - 可随时恢复；可一键恢复全部。
 *
 * 存储：g851-wrong-remove = { "模拟-2016.html#m201611": {at:'2026-11-21'} }
 */
(function () {
  'use strict';
  var K = 'g851-wrong-remove';
  function all() { try { return JSON.parse(localStorage.getItem(K) || 'null') || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(K, JSON.stringify(o)); } catch (e) {} }
  function key(file, wid) { return String(file || '') + '#' + String(wid || ''); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function has(file, wid) { return !!all()[key(file, wid)]; }
  function add(file, wid, meta) {
    var o = all(); o[key(file, wid)] = Object.assign({ at: today() }, meta || {}); save(o);
  }
  function del(file, wid) { var o = all(); delete o[key(file, wid)]; save(o); }
  function list() {
    var o = all(), out = [];
    Object.keys(o).forEach(function (k) {
      var p = k.split('#');
      out.push({ file: p[0], wid: p[1] || '', at: (o[k] && o[k].at) || '' });
    });
    return out;
  }
  function count() { return Object.keys(all()).length; }
  function clear() { save({}); }
  window.G851WR = {
    key: key, has: has, add: add, del: del, list: list, count: count,
    clear: clear, all: all,
    /* 兼容：调用方可能没有该模块（旧页面） */
    safeHas: function (file, wid) { try { return has(file, wid); } catch (e) { return false; } }
  };
})();
