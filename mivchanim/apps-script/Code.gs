/**
 * מחולל בחינות – צד השרת (Google Apps Script)
 * ------------------------------------------------
 * הקוד הזה רץ בתוך גיליון Google ומשמש "שרת" לאתר שב-GitHub Pages.
 * התשובות הנכונות נשארות כאן בלבד ולא נשלחות לדפדפן של התלמיד.
 *
 * גיליונות (נוצרים אוטומטית בהרצת setup):
 *   Exams     – הגדרות המבחנים (כל מבחן משויך לשכבה: ט / י / יא / בגרות)
 *   Questions – מאגר השאלות
 *   Results   – תוצאות התלמידים
 *
 * סוגי שאלות:
 *   mc    – רב ברירה (2–6 תשובות, אחת נכונה)
 *   fill  – השלמה (___ במקום החסר, עד 5 חלונות בשורה, כמה תשובות נכונות לכל חלון)
 *   tf    – נכון / לא נכון
 *   match – העברת חיצים (2–8 זוגות; התלמיד מחבר בקו פריט מימין לפריט משמאל)
 */

var SHEETS = {
  exams: { name: 'Exams', headers: ['id', 'title', 'open', 'timeLimit', 'allowRetake', 'drawCount', 'classes', 'grade'] },
  questions: { name: 'Questions', headers: ['qid', 'examId', 'type', 'text', 'options', 'correct', 'points', 'image'] },
  results: { name: 'Results', headers: ['timestamp', 'examId', 'examTitle', 'name', 'class', 'studentId', 'score', 'earned', 'total', 'minutes', 'late', 'answers'] }
};
var DEFAULT_PASSWORD = '1234';
var SESSION_SECONDS = 21600;      // 6 שעות – המקסימום של CacheService
var IMAGE_FOLDER = 'מחולל בחינות – תמונות';
var MAX_INLINE_IMAGE = 45000;
var GRADES = ['ט', 'י', 'יא', 'בגרות'];     // תמונה קטנה שנשמרת ישירות בתא (מגבלת תא: 50,000 תווים)

/* ===================== התקנה ===================== */

/** מריצים מתוך עורך הסקריפט: יוצר/מעדכן את הגיליונות וסיסמת ברירת מחדל. בטוח להריץ שוב. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (k) {
    var def = SHEETS[k];
    var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(def.headers);
      sh.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      ensureHeaders_(k);
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TEACHER_PASSWORD')) props.setProperty('TEACHER_PASSWORD', DEFAULT_PASSWORD);
  if (readRows_('exams').length === 0) {
    var exId = 'demo';
    appendRow_('exams', { id: exId, title: 'מבחן לדוגמה – רשתות', open: true, timeLimit: 20, allowRetake: false, drawCount: 0, classes: 'י1,י2,י3', grade: 'י' });
    appendRow_('questions', { qid: newId_(), examId: exId, type: 'mc', text: 'איזה רכיב מחבר בין רשתות שונות?', options: JSON.stringify(['נתב (Router)', 'מתג (Switch)', 'רכזת (Hub)', 'כרטיס רשת']), correct: '0', points: 10 });
    appendRow_('questions', { qid: newId_(), examId: exId, type: 'tf', text: 'מתג (Switch) פועל בשכבה 3 של מודל OSI.', options: '', correct: 'false', points: 5 });
    appendRow_('questions', { qid: newId_(), examId: exId, type: 'fill', text: 'הפרוטוקול ___ מחלק כתובות IP, והפרוטוקול ___ מתרגם שמות לכתובות.', options: '', correct: JSON.stringify([['DHCP'], ['DNS']]), points: 10 });
    appendRow_('questions', { qid: newId_(), examId: exId, type: 'match', text: 'חברו כל רכיב לשכבה שבה הוא פועל.', options: JSON.stringify([['נתב', 'שכבה 3'], ['מתג', 'שכבה 2'], ['רכזת', 'שכבה 1']]), correct: '', points: 15 });
  }
}

/* ===================== נקודות כניסה ===================== */

function doGet() {
  return json_({ ok: true, service: 'exam-generator', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var handler = ACTIONS[req.action];
    if (!handler) throw new Error('פעולה לא מוכרת');
    if (req.action.charAt(0) === 't') checkPassword_(req.pw);
    return json_({ ok: true, data: handler(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var ACTIONS = {
  /* ---------- תלמיד ---------- */
  listExams: function (req) {
    var grade = String(req.grade || '');
    return readRows_('exams').filter(function (x) {
      return toBool_(x.open) && (!grade || String(x.grade || '') === grade);
    }).map(function (x) {
      return { id: String(x.id), title: x.title, timeLimit: Number(x.timeLimit) || 0, classes: splitList_(x.classes), grade: String(x.grade || '') };
    });
  },

  startExam: function (req) {
    var name = String(req.name || '').trim();
    var cls = String(req.cls || '').trim();
    var sid = String(req.sid || '').replace(/\D/g, '');
    if (name.length < 2) throw new Error('יש להזין שם מלא');
    if (!cls) throw new Error('יש לבחור כיתה');
    if (!isValidIsraeliId(sid)) throw new Error('מספר תעודת הזהות אינו תקין');
    sid = padId(sid);

    var exam = findExam_(req.examId);
    if (!exam || !toBool_(exam.open)) throw new Error('המבחן אינו פתוח כרגע');
    if (!toBool_(exam.allowRetake)) {
      var done = readRows_('results').some(function (r) {
        return String(r.examId) === String(exam.id) && padId(String(r.studentId)) === sid;
      });
      if (done) throw new Error('כבר הגשת את המבחן הזה');
    }

    var pool = examQuestions_(exam.id);
    if (!pool.length) throw new Error('אין עדיין שאלות במבחן');
    var built = buildStudentExam(pool, Number(exam.drawCount) || 0, Math.random);

    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(token, JSON.stringify({
      examId: String(exam.id), title: exam.title, name: name, cls: cls, sid: sid,
      start: Date.now(), timeLimit: Number(exam.timeLimit) || 0, qids: built.qids
    }), SESSION_SECONDS);

    return { token: token, title: exam.title, timeLimit: Number(exam.timeLimit) || 0, questions: built.questions };
  },

  submitExam: function (req) {
    var cache = CacheService.getScriptCache();
    var raw = cache.get(String(req.token || ''));
    if (!raw) throw new Error('פג תוקף המבחן. פנו למורה.');
    var s = JSON.parse(raw);
    var pool = readRows_('questions').filter(function (q) { return s.qids.indexOf(String(q.qid)) !== -1; }).map(parseQuestion);
    var g = gradeExam(pool, req.answers || {});
    var minutes = Math.round((Date.now() - s.start) / 600) / 100;
    var late = s.timeLimit > 0 && minutes > s.timeLimit + 2;

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      appendRow_('results', {
        timestamp: new Date(), examId: s.examId, examTitle: s.title, name: s.name, 'class': s.cls,
        studentId: "'" + s.sid, score: g.score, earned: g.earned, total: g.total,
        minutes: minutes, late: late ? 'כן' : '', answers: JSON.stringify(g.detail)
      });
    } finally { lock.releaseLock(); }
    cache.remove(String(req.token));
    return { score: g.score };
  },

  /* ---------- מורה (דורש סיסמה) ---------- */
  tLogin: function () { return { maxQuestions: MAX_QUESTIONS }; },

  tGetAll: function () {
    var exams = readRows_('exams').map(function (x) {
      return { id: String(x.id), title: x.title, open: toBool_(x.open), timeLimit: Number(x.timeLimit) || 0,
        allowRetake: toBool_(x.allowRetake), drawCount: Number(x.drawCount) || 0, classes: String(x.classes || ''), grade: String(x.grade || '') };
    });
    return { grades: GRADES, exams: exams, questions: readRows_('questions').map(parseQuestion), maxQuestions: MAX_QUESTIONS };
  },

  tSaveExam: function (req) {
    var x = req.exam || {};
    if (!String(x.title || '').trim()) throw new Error('חסרה כותרת למבחן');
    var draw = Number(x.drawCount) || 0;
    if (draw < 0 || draw > MAX_QUESTIONS) throw new Error('מספר השאלות לתלמיד: בין 0 ל-' + MAX_QUESTIONS);
    var row = { id: x.id || newId_(), title: String(x.title).trim(), open: !!x.open, timeLimit: Number(x.timeLimit) || 0,
      allowRetake: !!x.allowRetake, drawCount: draw, classes: String(x.classes || ''), grade: String(x.grade || '') };
    if (GRADES.indexOf(row.grade) === -1) throw new Error('יש לבחור שכבה');
    upsert_('exams', 'id', row);
    return row.id;
  },

  tDeleteExam: function (req) {
    deleteWhere_('questions', function (q) { return String(q.examId) === String(req.examId); });
    deleteWhere_('exams', function (x) { return String(x.id) === String(req.examId); });
    return true;
  },

  tSaveQuestion: function (req) {
    var q = req.question || {};
    if (!findExam_(q.examId)) throw new Error('המבחן לא נמצא');
    if (!q.qid) {
      var count = examQuestions_(q.examId).length;
      if (count >= MAX_QUESTIONS) throw new Error('הגעתם למקסימום של ' + MAX_QUESTIONS + ' שאלות במבחן');
    }
    var image = String(q.image || '').trim();
    if (image && !/^https:\/\//.test(image) && !/^data:image\//.test(image)) throw new Error('קישור התמונה צריך להתחיל ב-https://');
    if (image.length > MAX_INLINE_IMAGE) throw new Error('התמונה גדולה מדי לשמירה בגיליון');
    var row = validateQuestion(q);
    row.qid = q.qid || newId_();
    row.examId = String(q.examId);
    row.image = image;
    upsert_('questions', 'qid', row);
    return row.qid;
  },

  tDeleteQuestion: function (req) {
    deleteWhere_('questions', function (q) { return String(q.qid) === String(req.qid); });
    return true;
  },

  /** מקבל תמונה (data URL), שומר אותה בתיקייה ב-Drive ומחזיר קישור ציבורי לצפייה */
  tUploadImage: function (req) {
    var m = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/.exec(String(req.dataUrl || ''));
    if (!m) throw new Error('קובץ התמונה אינו נתמך');
    var blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], 'q-' + Date.now() + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]));
    var folders = DriveApp.getFoldersByName(IMAGE_FOLDER);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600';
  },

  tResults: function (req) {
    return readRows_('results').filter(function (r) { return !req.examId || String(r.examId) === String(req.examId); })
      .map(function (r) {
        return { timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
          examId: String(r.examId), examTitle: r.examTitle, name: r.name, cls: r['class'], studentId: padId(String(r.studentId)),
          score: Number(r.score), earned: Number(r.earned), total: Number(r.total), minutes: Number(r.minutes), late: r.late };
      });
  },

  tChangePw: function (req) {
    var p = String(req.newPw || '');
    if (p.length < 4) throw new Error('הסיסמה צריכה לפחות 4 תווים');
    PropertiesService.getScriptProperties().setProperty('TEACHER_PASSWORD', p);
    return true;
  }
};

/* ===================== לוגיקה טהורה (נבדקת גם מחוץ ל-Google) ===================== */
/* CORE-START */
var MAX_QUESTIONS = 40;
var MAX_BLANKS_PER_LINE = 5;
var BLANK_RE = /_{3,}/g;

/** בדיקת ספרת ביקורת של תעודת זהות ישראלית */
function isValidIsraeliId(id) {
  id = String(id || '').replace(/\D/g, '');
  if (id.length < 5 || id.length > 9) return false;
  id = padId(id);
  var sum = 0;
  for (var i = 0; i < 9; i++) {
    var d = Number(id.charAt(i)) * ((i % 2) + 1);
    sum += d > 9 ? d - 9 : d;
  }
  return sum % 10 === 0;
}

function padId(id) { id = String(id || '').replace(/\D/g, ''); while (id.length < 9) id = '0' + id; return id; }

/** ערבוב פישר-ייטס */
function shuffle(arr, rnd) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function parseJson(s, d) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return d; }
}

/** כמה חלונות השלמה יש בכל שורה של הטקסט */
function countBlanksPerLine(text) {
  return String(text || '').split('\n').map(function (line) { return (line.match(BLANK_RE) || []).length; });
}

/** ממיר שורה מהגיליון לשאלה אחידה */
function parseQuestion(row) {
  var type = ['mc', 'fill', 'tf', 'match'].indexOf(row.type) !== -1 ? row.type : 'mc';
  var q = { qid: String(row.qid), examId: String(row.examId), type: type, text: String(row.text || ''),
    image: String(row.image || ''), points: Number(row.points) || 1 };
  if (type === 'mc') {
    q.options = parseJson(row.options, []);
    q.correct = Number(row.correct);
  } else if (type === 'tf') {
    q.correct = String(row.correct).toLowerCase() === 'true';
  } else if (type === 'fill') {
    var c = parseJson(row.correct, null);
    if (!Array.isArray(c)) c = [String(row.correct || '').split('|')];      // תאימות לגרסה הקודמת
    q.correct = c.map(function (alts) { return (Array.isArray(alts) ? alts : [alts]).map(String); });
  } else {
    q.pairs = parseJson(row.options, []);
  }
  return q;
}

/** בודק שאלה שהמורה שלח ומחזיר שורה לשמירה (בלי qid/examId/image) */
function validateQuestion(q) {
  var type = ['mc', 'fill', 'tf', 'match'].indexOf(q.type) !== -1 ? q.type : null;
  if (!type) throw new Error('סוג שאלה לא מוכר');
  var text = String(q.text || '').trim();
  if (!text) throw new Error('חסר נוסח לשאלה');
  var points = Number(q.points);
  if (!(points > 0)) throw new Error('הניקוד צריך להיות גדול מ-0');
  var row = { type: type, text: text, points: points, options: '', correct: '' };

  if (type === 'mc') {
    var opts = (q.options || []).map(function (o) { return String(o).trim(); }).filter(String);
    if (opts.length < 2 || opts.length > 6) throw new Error('שאלת רב ברירה צריכה 2 עד 6 תשובות');
    var c = Number(q.correct);
    if (!(c >= 0 && c < opts.length)) throw new Error('יש לסמן תשובה נכונה');
    row.options = JSON.stringify(opts); row.correct = String(c);
  } else if (type === 'tf') {
    if (q.correct !== true && q.correct !== false) throw new Error('יש לבחור אם המשפט נכון או לא נכון');
    row.correct = q.correct ? 'true' : 'false';
  } else if (type === 'fill') {
    var perLine = countBlanksPerLine(text);
    var total = perLine.reduce(function (a, b) { return a + b; }, 0);
    if (!total) throw new Error('סמנו את המקום להשלמה בשלושה קווים תחתונים: ___');
    perLine.forEach(function (n, i) { if (n > MAX_BLANKS_PER_LINE) throw new Error('בשורה ' + (i + 1) + ' יש ' + n + ' חלונות. המקסימום הוא ' + MAX_BLANKS_PER_LINE + ' בשורה'); });
    var ans = (q.correct || []).map(function (alts) {
      return (Array.isArray(alts) ? alts : String(alts).split('/')).map(function (a) { return String(a).trim(); }).filter(String);
    });
    if (ans.length !== total) throw new Error('יש ' + total + ' חלונות השלמה, אבל ' + ans.length + ' תשובות');
    ans.forEach(function (alts, i) { if (!alts.length) throw new Error('חסרה תשובה נכונה לחלון ' + (i + 1)); });
    row.correct = JSON.stringify(ans);
  } else {
    var pairs = (q.pairs || []).map(function (p) { return [String(p[0] || '').trim(), String(p[1] || '').trim()]; })
      .filter(function (p) { return p[0] || p[1]; });
    if (pairs.length < 2 || pairs.length > 8) throw new Error('שאלת העברת חיצים צריכה 2 עד 8 זוגות');
    pairs.forEach(function (p, i) { if (!p[0] || !p[1]) throw new Error('זוג ' + (i + 1) + ' לא שלם'); });
    row.options = JSON.stringify(pairs);
  }
  return row;
}

/**
 * בונה מבחן לתלמיד (pool = שאלות אחרי parseQuestion): מערבב את סדר השאלות ואת סדר התשובות.
 * לא נשלח שום מידע על התשובה הנכונה. כל פריט נושא את מספרו המקורי (id) לצורך הבדיקה.
 */
function buildStudentExam(pool, drawCount, rnd) {
  var qs = shuffle(pool, rnd);
  if (drawCount > 0 && drawCount < qs.length) qs = qs.slice(0, drawCount);
  return {
    qids: qs.map(function (q) { return q.qid; }),
    questions: qs.map(function (q) {
      var out = { qid: q.qid, type: q.type, text: q.text, image: q.image || '', points: q.points };
      if (q.type === 'mc') out.options = shuffle(q.options.map(function (t, i) { return { id: i, text: t }; }), rnd);
      if (q.type === 'fill') out.blanks = q.correct.length;
      if (q.type === 'match') {
        out.right = shuffle(q.pairs.map(function (p, i) { return { id: i, text: p[0] }; }), rnd);
        out.left = shuffle(q.pairs.map(function (p, i) { return { id: i, text: p[1] }; }), rnd);
      }
      return out;
    })
  };
}

/** נרמול תשובת השלמה: רווחים, אותיות גדולות/קטנות, ניקוד, אותיות סופיות, פיסוק בקצוות */
function normalizeAnswer(s) {
  s = String(s == null ? '' : s).toLowerCase();
  s = s.replace(/[֑-ׇ]/g, '');
  s = s.replace(/[״"׳'`]/g, '');
  s = s.replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s.,;:!?()\-]+|[\s.,;:!?()\-]+$/g, '');
  return s;
}

function fillMatches(given, accepted) {
  var g = normalizeAnswer(given);
  if (!g) return false;
  for (var i = 0; i < accepted.length; i++) {
    var a = normalizeAnswer(accepted[i]);
    if (!a) continue;
    if (g === a) return true;
    var gn = Number(g.replace(',', '.')), an = Number(a.replace(',', '.'));
    if (!isNaN(gn) && !isNaN(an) && gn === an) return true;
  }
  return false;
}

/** חלק התשובה הנכון (0 עד 1) בשאלה אחת */
function scoreQuestion(q, a) {
  if (a === undefined || a === null || a === '') return 0;
  if (q.type === 'mc') return Number(a) === q.correct ? 1 : 0;
  if (q.type === 'tf') {
    var v = a === true || a === 'true' ? true : a === false || a === 'false' ? false : null;
    return v !== null && v === q.correct ? 1 : 0;
  }
  if (q.type === 'fill') {
    var given = Array.isArray(a) ? a : [a];
    var ok = 0;
    q.correct.forEach(function (alts, i) { if (fillMatches(given[i], alts)) ok++; });
    return q.correct.length ? ok / q.correct.length : 0;
  }
  if (q.type === 'match') {
    if (typeof a !== 'object') return 0;
    var hit = 0;
    q.pairs.forEach(function (p, i) { if (a[i] !== undefined && a[i] !== null && Number(a[i]) === i) hit++; });
    return q.pairs.length ? hit / q.pairs.length : 0;
  }
  return 0;
}

/** בודק מבחן שלם. pool = שאלות אחרי parseQuestion. ניקוד חלקי בהשלמה ובהעברת חיצים */
function gradeExam(pool, answers) {
  var earned = 0, total = 0, detail = {};
  pool.forEach(function (q) {
    var a = answers[q.qid];
    var frac = scoreQuestion(q, a);
    total += q.points;
    earned += q.points * frac;
    detail[q.qid] = { a: a === undefined ? null : a, part: Math.round(frac * 100) / 100 };
  });
  earned = Math.round(earned * 100) / 100;
  return { earned: earned, total: total, score: total ? Math.round(earned / total * 100) : 0, detail: detail };
}
/* CORE-END */

/* ===================== עזרי גיליון ===================== */

function sheet_(key) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS[key].name);
  if (!sh) throw new Error('חסר גיליון ' + SHEETS[key].name + '. הריצו setup.');
  return sh;
}

/** מוסיף לשורת הכותרות עמודות חדשות (למשל image) בגיליון שנוצר בגרסה קודמת */
function ensureHeaders_(key) {
  var sh = sheet_(key);
  var head = sh.getDataRange().getValues()[0] || [];
  var missing = SHEETS[key].headers.filter(function (h) { return head.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    sh.getRange(1, 1, 1, head.length + missing.length).setFontWeight('bold');
  }
}

function headers_(key) {
  var head = sheet_(key).getDataRange().getValues()[0] || [];
  if (SHEETS[key].headers.some(function (h) { return head.indexOf(h) === -1; })) { ensureHeaders_(key); head = sheet_(key).getDataRange().getValues()[0]; }
  return head;
}

function readRows_(key) {
  var values = sheet_(key).getDataRange().getValues();
  var headers = values.shift() || [];
  return values.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function toRow_(head, obj) { return head.map(function (k) { return obj[k] === undefined ? '' : obj[k]; }); }

function appendRow_(key, obj) {
  sheet_(key).appendRow(toRow_(headers_(key), obj));
}

function upsert_(key, idField, obj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var head = headers_(key);
    var sh = sheet_(key);
    var values = sh.getDataRange().getValues();
    var col = head.indexOf(idField);
    var rowVals = toRow_(head, obj);
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][col]) === String(obj[idField])) {
        sh.getRange(i + 1, 1, 1, head.length).setValues([rowVals]);
        return;
      }
    }
    sh.appendRow(rowVals);
  } finally { lock.releaseLock(); }
}

function deleteWhere_(key, pred) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(key);
    var values = sh.getDataRange().getValues();
    var headers = values[0];
    for (var i = values.length - 1; i >= 1; i--) {
      var o = {};
      headers.forEach(function (hh, j) { o[hh] = values[i][j]; });
      if (pred(o)) sh.deleteRow(i + 1);
    }
  } finally { lock.releaseLock(); }
}

function examQuestions_(examId) {
  return readRows_('questions').filter(function (q) { return String(q.examId) === String(examId); }).map(parseQuestion);
}

function findExam_(id) {
  var list = readRows_('exams').filter(function (x) { return String(x.id) === String(id); });
  return list[0] || null;
}

function checkPassword_(pw) {
  var real = PropertiesService.getScriptProperties().getProperty('TEACHER_PASSWORD') || DEFAULT_PASSWORD;
  if (String(pw || '') !== real) throw new Error('סיסמה שגויה');
}

function newId_() { return 'x' + Utilities.getUuid().replace(/-/g, '').slice(0, 9); }
function toBool_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || v === 1 || v === '1'; }
function splitList_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
