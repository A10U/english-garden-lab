(function (root, factory) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.EGLCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EGLStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  function createStore(options = {}) {
    const key = options.key || 'egl-progress-v1';
    const now = options.now === undefined ? () => Date.now() : typeof options.now === 'function' ? options.now : () => options.now;
    let storage = null, progress = Core.createProgress(now()), persistent = true, status = 'ready', warning = '', recovery = null;
    const copy = value => JSON.parse(JSON.stringify(value));
    try { storage = Object.hasOwn(options, 'storage') ? options.storage : globalThis.localStorage; if (!storage) throw new Error('unavailable'); }
    catch { persistent = false; status = 'memory'; warning = 'บันทึกถาวรไม่ได้ ผลอยู่ในหน้านี้เท่านั้น กรุณาส่งออกก่อนปิด'; }
    if (storage) {
      try {
        const raw = storage.getItem(key);
        if (raw !== null) {
          try { if (raw.length > 1048576) throw new Error('large'); progress = Core.validateProgress(JSON.parse(raw), options.lessonIds); }
          catch { recovery = raw; persistent = false; status = 'corrupt'; warning = 'อ่านข้อมูลเดิมไม่ได้ จึงเก็บต้นฉบับไว้และฝึกชั่วคราวได้ ส่งออกต้นฉบับได้ในหน้าผลการเรียน'; }
        }
      } catch { persistent = false; status = 'memory'; warning = 'อ่านพื้นที่บันทึกไม่ได้ ผลอยู่ในหน้านี้ กรุณาส่งออกก่อนปิด'; }
    }
    const result = () => ({progress: copy(progress), persistent, status, warning});
    function save(next) {
      const validated = Core.validateProgress(next, options.lessonIds);
      progress = validated;
      if (persistent && storage) {
        try { storage.setItem(key, JSON.stringify(progress)); status = 'saved'; warning = ''; }
        catch { persistent = false; status = 'memory'; warning = 'พื้นที่บันทึกไม่พร้อมหรือเต็ม ผลอยู่ในหน้านี้ กรุณาส่งออกก่อนปิด'; }
      }
      return result();
    }
    function importData(text) {
      if (typeof text !== 'string' || text.length > 1048576) throw new Error('รองรับไฟล์ JSON ไม่เกิน 1 MB');
      let next;
      try { next = Core.validateProgress(JSON.parse(text), options.lessonIds); }
      catch (error) { throw new Error('นำเข้าไม่ได้: ' + error.message); }
      // A validated explicit import may replace corrupt data. Invalid imports never reach this point.
      progress = next;
      if (storage) {
        try { storage.setItem(key, JSON.stringify(progress)); persistent = true; status = 'saved'; warning = ''; recovery = null; }
        catch { persistent = false; status = 'memory'; warning = 'นำเข้าแล้วในหน้านี้ แต่บันทึกถาวรไม่ได้ กรุณาส่งออกก่อนปิด'; }
      }
      return result();
    }
    return {load: result, save, importData, exportData: () => JSON.stringify(progress, null, 2), getRecovery: () => recovery};
  }
  return {createStore};
});
