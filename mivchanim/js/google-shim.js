/*
 * מצב הדגמה: מחקה את שירותי Google (גיליון, מטמון, מאפיינים) בתוך הדפדפן,
 * כך שאותו קוד שרת בדיוק (apps-script/Code.gs) רץ מקומית בלי חשבון Google.
 * הנתונים נשמרים ב-localStorage של הדפדפן בלבד.
 */
(function (global) {
  var KEY = 'examgen-demo-v1';

  function memStore() {
    var mem = {};
    return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); } };
  }
  function store() {
    try { var t = '__t'; global.localStorage.setItem(t, '1'); global.localStorage.removeItem(t); return global.localStorage; }
    catch (e) { return global.__examgenMem || (global.__examgenMem = memStore()); }
  }
  function load() { try { return JSON.parse(store().getItem(KEY)) || { sheets: {}, cache: {}, props: {} }; } catch (e) { return { sheets: {}, cache: {}, props: {} }; } }
  function save(db) { store().setItem(KEY, JSON.stringify(db)); }

  function cell(v) {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && v.charAt(0) === "'") return v.slice(1);
    return v;
  }

  function makeSheet(name) {
    function rows() { return load().sheets[name] || []; }
    function setRows(r) { var db = load(); db.sheets[name] = r; save(db); }
    var api = {
      getLastRow: function () { return rows().length; },
      appendRow: function (vals) { var r = rows(); r.push(vals.map(cell)); setRows(r); },
      setFrozenRows: function () {},
      deleteRow: function (i) { var r = rows(); r.splice(i - 1, 1); setRows(r); },
      getDataRange: function () { return { getValues: function () { return JSON.parse(JSON.stringify(rows())); } }; },
      getRange: function (row, col, nr, nc) {
        return {
          setFontWeight: function () { return this; },
          setValues: function (vals) {
            var r = rows();
            for (var i = 0; i < vals.length; i++) {
              r[row - 1 + i] = r[row - 1 + i] || [];
              for (var j = 0; j < vals[i].length; j++) r[row - 1 + i][col - 1 + j] = cell(vals[i][j]);
            }
            setRows(r);
          }
        };
      }
    };
    return api;
  }

  var ss = {
    getSheetByName: function (n) { return load().sheets[n] ? makeSheet(n) : null; },
    insertSheet: function (n) { var db = load(); db.sheets[n] = db.sheets[n] || []; save(db); return makeSheet(n); }
  };

  global.GoogleShim = {
    SpreadsheetApp: { getActiveSpreadsheet: function () { return ss; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { var c = load().cache[k]; return c && c.exp > Date.now() ? c.v : null; },
      put: function (k, v, sec) { var db = load(); db.cache[k] = { v: v, exp: Date.now() + sec * 1000 }; save(db); },
      remove: function (k) { var db = load(); delete db.cache[k]; save(db); }
    }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { var p = load().props; return k in p ? p[k] : null; },
      setProperty: function (k, v) { var db = load(); db.props[k] = String(v); save(db); }
    }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    Utilities: { getUuid: function () {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
    } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { content: s, setMimeType: function () { return this; } }; } },
    reset: function () { store().setItem(KEY, JSON.stringify({ sheets: {}, cache: {}, props: {} })); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
