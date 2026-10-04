/*
 * שכבת התקשורת עם השרת.
 * אם הוגדר API_URL – שולח לגיליון Google. אחרת – מריץ את Code.gs מקומית (מצב הדגמה).
 */
(function (global) {
  var cfg = global.EXAM_CONFIG || {};
  var demoServer = null;

  function isDemo() { return !cfg.API_URL; }

  function loadDemoServer() {
    if (demoServer) return Promise.resolve(demoServer);
    return fetch('apps-script/Code.gs').then(function (r) {
      if (!r.ok) throw new Error('לא נמצא קובץ השרת להדגמה');
      return r.text();
    }).then(function (code) {
      var G = global.GoogleShim;
      var factory = new Function('SpreadsheetApp', 'CacheService', 'PropertiesService', 'LockService', 'Utilities', 'ContentService', 'DriveApp',
        code + '\nreturn { doPost: doPost, setup: setup };');
      demoServer = factory(G.SpreadsheetApp, G.CacheService, G.PropertiesService, G.LockService, G.Utilities, G.ContentService, null);
      demoServer.setup();
      return demoServer;
    });
  }

  function call(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    if (isDemo()) {
      return loadDemoServer().then(function (srv) {
        var out = JSON.parse(srv.doPost({ postData: { contents: JSON.stringify(body) } }).content);
        return unwrap(out);
      });
    }
    // text/plain בכוונה: כך הדפדפן לא שולח בקשת preflight ש-Apps Script לא תומך בה
    return fetch(cfg.API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('השרת לא זמין (' + r.status + ')'); return r.json(); })
      .then(unwrap, function (e) { throw new Error(e.message && e.message.indexOf('השרת') === 0 ? e.message : 'אין חיבור לשרת. בדקו את החיבור לאינטרנט.'); });
  }

  function unwrap(out) {
    if (!out || !out.ok) throw new Error((out && out.error) || 'שגיאה לא צפויה');
    return out.data;
  }

  function resetDemo() { if (global.GoogleShim) global.GoogleShim.reset(); demoServer = null; }

  global.ExamAPI = { call: call, isDemo: isDemo, resetDemo: resetDemo };
})(window);
