/* נוצר אוטומטית מ-apps-script/Code.gs – לא לערוך ידנית (tools/build-core.py) */
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
