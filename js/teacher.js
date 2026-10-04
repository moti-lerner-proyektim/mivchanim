/* ממשק המורה: ניהול מבחנים, מאגר שאלות ותוצאות */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var PW_KEY = 'examgen-teacher-pw';
  var pw = '';
  var data = { exams: [], questions: [] };
  var results = [];
  var editingExam = null, editingQ = null;
  var lastType = 'mc';
  var MAX_Q = 40, MAX_PER_LINE = 5;
  var GRADE_NAMES = { 'ט': 'כיתה ט׳', 'י': 'כיתה י׳', 'יא': 'כיתה יא׳', 'בגרות': 'בגרות' };
  function examLabel(x) { return (x.grade ? '[' + (GRADE_NAMES[x.grade] || x.grade) + '] ' : '') + x.title; }
  var TYPE_NAMES = { mc: 'רב ברירה', fill: 'השלמה', tf: 'נכון / לא נכון', match: 'העברת חיצים' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(action, payload) { return ExamAPI.call(action, Object.assign({ pw: pw }, payload || {})); }
  function toast(msg) {
    document.querySelectorAll('.toast').forEach(function (x) { x.remove(); });
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function fail(e) { toast(e.message || String(e)); }
  function showErr(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
  function examById(id) { return data.exams.filter(function (x) { return x.id === id; })[0]; }
  function qCount(id) { return data.questions.filter(function (q) { return q.examId === id; }).length; }

  /* ---------- כניסה ---------- */
  function init() {
    if (ExamAPI.isDemo()) {
      $('demoBanner').classList.remove('hidden');
      $('resetDemo').onclick = function () {
        if (!confirm('למחוק את כל נתוני ההדגמה בדפדפן הזה?')) return;
        ExamAPI.resetDemo(); location.reload();
      };
    }
    $('loginForm').onsubmit = function (e) { e.preventDefault(); login($('pw').value); };
    $('logoutBtn').onclick = function () { try { sessionStorage.removeItem(PW_KEY); } catch (e) {} location.reload(); };
    var saved = null; try { saved = sessionStorage.getItem(PW_KEY); } catch (e) {}
    if (saved) login(saved, true);

    document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { switchTab(b.dataset.tab); }; });
    document.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('.modal-bg').classList.add('hidden'); }; });
    $('newExamBtn').onclick = function () { openExam(null); };
    $('gradeFilter').onchange = renderExams;
    $('examForm').onsubmit = saveExam;
    $('newQBtn').onclick = function () { openQuestion(null, lastType); };
    $('qExam').onchange = renderQuestions;
    $('qForm').onsubmit = saveQuestion;
    $('addOpt').onclick = function () { addOptRow('', false); };
    $('addPair').onclick = function () { addPairRow('', ''); };
    $('typePicker').onclick = function (e) { var b = e.target.closest('button[data-type]'); if (b) setType(b.dataset.type); };
    $('qText').oninput = function () { if (editingQ && editingQ.type === 'fill') syncBlanks(); };
    $('insertBlank').onclick = insertBlank;
    $('imgFile').onchange = onImageFile;
    $('imgUrl').oninput = function () { setImage(this.value.trim(), true); };
    $('imgRemove').onclick = function () { setImage('', false); $('imgFile').value = ''; };
    $('rExam').onchange = loadResults;
    $('rClass').onchange = renderResults;
    $('refreshResults').onclick = loadResults;
    $('exportCsv').onclick = exportCsv;
    $('pwForm').onsubmit = changePw;
  }

  function login(p, silent) {
    pw = p;
    var btn = $('loginBtn'); btn.disabled = true;
    api('tLogin').then(function () {
      try { sessionStorage.setItem(PW_KEY, p); } catch (e) {}
      $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden'); $('logoutBtn').classList.remove('hidden');
      return refresh();
    }).catch(function (e) {
      try { sessionStorage.removeItem(PW_KEY); } catch (x) {}
      if (!silent) showErr($('loginError'), e.message);
    }).then(function () { btn.disabled = false; });
  }

  function refresh() {
    return api('tGetAll').then(function (d) { data = d; if (d.maxQuestions) MAX_Q = d.maxQuestions; renderExams(); fillExamSelects(); renderQuestions(); });
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    ['exams', 'questions', 'results', 'settings'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== name); });
    if (name === 'results') loadResults();
  }

  /* ---------- מבחנים ---------- */
  function studentLink(id) {
    var base = location.href.replace(/teacher\.html.*$/, '').replace(/[?#].*$/, '');
    return base + 'exam.html?exam=' + encodeURIComponent(id);
  }

  function renderExams() {
    var el = $('examList');
    var gf = $('gradeFilter').value;
    var list = data.exams.filter(function (x) { return !gf || x.grade === gf; });
    if (!list.length) { el.innerHTML = '<p class="muted">' + (gf ? 'אין מבחנים בשכבה הזו.' : 'עדיין אין מבחנים.') + ' לחצו "+ מבחן חדש".</p>'; return; }
    el.innerHTML = list.map(function (x) {
      var n = qCount(x.id);
      var shown = x.drawCount && x.drawCount < n ? x.drawCount + ' מתוך ' + n : n;
      return '<div class="list-item"><div class="info">' +
        '<h3 style="margin:0 0 4px">' + esc(x.title) + '</h3>' +
        '<span class="pill grade">' + esc(GRADE_NAMES[x.grade] || 'ללא שכבה') + '</span>' +
        '<span class="pill ' + (x.open ? 'on' : 'off') + '">' + (x.open ? 'פתוח' : 'סגור') + '</span>' +
        '<span class="muted">' + shown + ' שאלות · ' + (x.timeLimit ? x.timeLimit + ' דקות' : 'ללא הגבלת זמן') +
        (x.classes ? ' · כיתות: ' + esc(x.classes) : '') + (x.allowRetake ? ' · הגשה חוזרת מותרת' : '') + '</span></div>' +
        '<div class="actions">' +
        '<button class="btn small ' + (x.open ? 'ghost' : 'gold') + '" data-act="toggle" data-id="' + esc(x.id) + '">' + (x.open ? 'סגירה' : 'פתיחה') + '</button>' +
        '<button class="btn small ghost" data-act="link" data-id="' + esc(x.id) + '">העתקת קישור</button>' +
        '<button class="btn small ghost" data-act="questions" data-id="' + esc(x.id) + '">שאלות</button>' +
        '<button class="btn small ghost" data-act="edit" data-id="' + esc(x.id) + '">עריכה</button>' +
        '<button class="btn small danger" data-act="delete" data-id="' + esc(x.id) + '">מחיקה</button>' +
        '</div></div>';
    }).join('');
    el.onclick = function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var x = examById(b.dataset.id);
      if (b.dataset.act === 'edit') openExam(x);
      if (b.dataset.act === 'questions') { $('qExam').value = x.id; renderQuestions(); switchTab('questions'); }
      if (b.dataset.act === 'link') copy(studentLink(x.id));
      if (b.dataset.act === 'toggle') {
        if (!x.open && !qCount(x.id)) return toast('אין שאלות במבחן. הוסיפו שאלות לפני הפתיחה.');
        api('tSaveExam', { exam: Object.assign({}, x, { open: !x.open }) }).then(refresh).then(function () { toast(x.open ? 'המבחן נסגר' : 'המבחן פתוח לתלמידים'); }).catch(fail);
      }
      if (b.dataset.act === 'delete') {
        if (!confirm('למחוק את המבחן "' + x.title + '" ואת כל השאלות שלו? התוצאות שכבר הוגשו יישארו בגיליון.')) return;
        api('tDeleteExam', { examId: x.id }).then(refresh).then(function () { toast('המבחן נמחק'); }).catch(fail);
      }
    };
  }

  function copy(text) {
    var done = function () { toast('הקישור הועתק'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('העתיקו את הקישור:', text); });
    else prompt('העתיקו את הקישור:', text);
  }

  function openExam(x) {
    editingExam = x;
    $('examModalTitle').textContent = x ? 'עריכת מבחן' : 'מבחן חדש';
    $('exTitle').value = x ? x.title : '';
    $('exGrade').value = x ? x.grade : $('gradeFilter').value;
    $('exTime').value = x ? x.timeLimit : 0;
    $('exDraw').value = x ? x.drawCount : 0;
    $('exClasses').value = x ? x.classes : '';
    $('exOpen').checked = x ? x.open : false;
    $('exRetake').checked = x ? x.allowRetake : false;
    $('examError').classList.add('hidden');
    $('examModal').classList.remove('hidden');
    $('exTitle').focus();
  }

  function saveExam(e) {
    e.preventDefault();
    var exam = {
      id: editingExam ? editingExam.id : '', title: $('exTitle').value.trim(), grade: $('exGrade').value,
      timeLimit: Number($('exTime').value) || 0, drawCount: Number($('exDraw').value) || 0,
      classes: $('exClasses').value.split(/[,،]/).map(function (s) { return s.trim(); }).filter(Boolean).join(','),
      open: $('exOpen').checked, allowRetake: $('exRetake').checked
    };
    api('tSaveExam', { exam: exam }).then(function (id) {
      $('examModal').classList.add('hidden');
      return refresh().then(function () {
        toast('המבחן נשמר');
        if (!editingExam) { $('qExam').value = id; renderQuestions(); switchTab('questions'); }
      });
    }).catch(function (err) { showErr($('examError'), err.message); });
  }

  function fillExamSelects() {
    ['qExam', 'rExam'].forEach(function (sid) {
      var sel = $(sid), prev = sel.value;
      sel.innerHTML = data.exams.length ? data.exams.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(examLabel(x)) + '</option>'; }).join('') : '<option value="">אין מבחנים</option>';
      if (examById(prev)) sel.value = prev;
    });
  }

  /* ---------- שאלות ---------- */
  function renderQuestions() {
    var exId = $('qExam').value;
    var list = data.questions.filter(function (q) { return q.examId === exId; });
    var total = list.reduce(function (s, q) { return s + q.points; }, 0);
    var ex = examById(exId);
    var full = list.length >= MAX_Q;
    $('newQBtn').disabled = !ex || full;
    $('qCounter').textContent = ex ? list.length + ' / ' + MAX_Q + ' שאלות' : '';
    $('qCounter').classList.toggle('full', full);
    $('qSummary').textContent = ex ? 'סך הכול ' + total + ' נקודות. הציון מחושב באחוזים.' + (full ? ' הגעתם למקסימום של ' + MAX_Q + ' שאלות.' : '') : '';
    if (!list.length) { $('questionList').innerHTML = ex ? '<p class="muted">אין עדיין שאלות למבחן הזה. לחצו "+ שאלה חדשה".</p>' : ''; return; }
    var okStyle = 'color:var(--ok);font-weight:700';
    $('questionList').innerHTML = list.map(function (q, i) {
      var body = '';
      if (q.type === 'mc') body = q.options.map(function (o, j) { return '<div style="' + (j === q.correct ? okStyle : '') + '">' + (j === q.correct ? '✓ ' : '· ') + esc(o) + '</div>'; }).join('');
      if (q.type === 'tf') body = '<div style="' + okStyle + '">✓ ' + (q.correct ? 'נכון' : 'לא נכון') + '</div>';
      if (q.type === 'fill') body = q.correct.map(function (alts, j) { return '<div><span style="' + okStyle + '">חלון ' + (j + 1) + ':</span> ' + alts.map(esc).join(' / ') + '</div>'; }).join('');
      if (q.type === 'match') body = q.pairs.map(function (p) { return '<div>' + esc(p[0]) + ' <span style="color:var(--gold-dark)">←</span> ' + esc(p[1]) + '</div>'; }).join('');
      return '<div class="list-item"><div class="info">' +
        '<span class="pill ' + q.type + '">' + TYPE_NAMES[q.type] + '</span><span class="muted">' + q.points + ' נק\'</span>' +
        '<p style="font-weight:600;margin:6px 0;white-space:pre-wrap">' + (i + 1) + '. ' + esc(q.text) + '</p>' +
        (q.image ? '<img class="list-thumb" src="' + esc(q.image) + '" alt="">' : '') +
        '<div class="muted">' + body + '</div></div>' +
        '<div class="actions"><button class="btn small ghost" data-act="edit" data-id="' + esc(q.qid) + '">עריכה</button>' +
        '<button class="btn small ghost" data-act="dup" data-id="' + esc(q.qid) + '"' + (full ? ' disabled' : '') + '>שכפול</button>' +
        '<button class="btn small danger" data-act="del" data-id="' + esc(q.qid) + '">מחיקה</button></div></div>';
    }).join('');
    $('questionList').onclick = function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var q = data.questions.filter(function (x) { return x.qid === b.dataset.id; })[0];
      if (b.dataset.act === 'edit') openQuestion(q, q.type);
      if (b.dataset.act === 'dup') api('tSaveQuestion', { question: Object.assign({}, q, { qid: '' }) }).then(refresh).then(function () { toast('השאלה שוכפלה'); }).catch(fail);
      if (b.dataset.act === 'del') {
        if (!confirm('למחוק את השאלה?')) return;
        api('tDeleteQuestion', { qid: q.qid }).then(refresh).then(function () { toast('השאלה נמחקה'); }).catch(fail);
      }
    };
  }

  /* --- עורך שאלה --- */
  function openQuestion(q, type) {
    editingQ = { qid: q ? q.qid : '', type: type, image: q ? q.image : '', orig: q };
    $('qModalTitle').textContent = q ? 'עריכת שאלה' : 'שאלה חדשה';
    $('qText').value = q ? q.text : '';
    $('qPoints').value = q ? q.points : 10;
    $('imgUrl').value = q && q.image && !/^data:/.test(q.image) ? q.image : '';
    $('imgFile').value = '';
    setImage(q ? q.image : '', false);
    $('imgStatus').textContent = '';
    // מילוי שדות לפי השאלה הקיימת
    $('optEditor').innerHTML = '';
    (q && q.type === 'mc' ? q.options : ['', '', '', '']).forEach(function (o, i) { addOptRow(o, q && q.type === 'mc' && i === q.correct); });
    $('pairEditor').innerHTML = '';
    (q && q.type === 'match' ? q.pairs : [['', ''], ['', ''], ['', '']]).forEach(function (p) { addPairRow(p[0], p[1]); });
    document.querySelectorAll('input[name=tfCorrect]').forEach(function (r) { r.checked = q && q.type === 'tf' && String(q.correct) === r.value; });
    blankValues = q && q.type === 'fill' ? q.correct.map(function (alts) { return alts.join(' / '); }) : [];
    $('qError').classList.add('hidden');
    $('blankEditor').innerHTML = '';
    setType(type);
    $('qModal').classList.remove('hidden');
    $('qText').focus();
  }

  function setType(type) {
    editingQ.type = type; lastType = type;
    document.querySelectorAll('#typePicker button').forEach(function (b) { b.classList.toggle('active', b.dataset.type === type); });
    ['mc', 'fill', 'tf', 'match'].forEach(function (t) { $(t + 'Fields').classList.toggle('hidden', t !== type); });
    $('fillTools').classList.toggle('hidden', type !== 'fill');
    $('qTextLabel').textContent = type === 'tf' ? 'המשפט' : type === 'match' ? 'הוראה לתלמיד' : 'נוסח השאלה';
    $('qTextHint').textContent = type === 'fill' ? 'כתבו ___ (שלושה קווים תחתונים) בכל מקום שהתלמיד צריך להשלים. עד ' + MAX_PER_LINE + ' חלונות בכל שורה; אפשר כמה שורות.'
      : type === 'match' ? 'למשל: חברו כל רכיב לשכבה שבה הוא פועל.' : '';
    if (type === 'match' && !$('qText').value.trim()) $('qText').placeholder = 'חברו כל פריט מימין לפריט המתאים משמאל';
    else $('qText').placeholder = '';
    $('partialHint').textContent = type === 'fill' ? 'ניקוד חלקי: כל חלון נכון מקבל חלק יחסי מהניקוד.' : type === 'match' ? 'ניקוד חלקי: כל חיבור נכון מקבל חלק יחסי מהניקוד.' : '';
    if (type === 'fill') syncBlanks();
  }

  function addOptRow(text, correct) {
    var ed = $('optEditor');
    if (ed.children.length >= 6) return toast('אפשר עד 6 תשובות');
    var row = document.createElement('div'); row.className = 'opt-edit';
    row.innerHTML = '<input type="radio" name="correctOpt" title="תשובה נכונה" aria-label="תשובה נכונה"' + (correct ? ' checked' : '') + '>' +
      '<input type="text" placeholder="תשובה ' + (ed.children.length + 1) + '" value="' + esc(text) + '">' +
      '<button type="button" class="btn small danger" title="הסרה" aria-label="הסרת תשובה">✕</button>';
    row.querySelector('button').onclick = function () { if (ed.children.length > 2) row.remove(); else toast('צריך לפחות 2 תשובות'); };
    ed.appendChild(row);
  }

  function addPairRow(a, b) {
    var ed = $('pairEditor');
    if (ed.children.length >= 8) return toast('אפשר עד 8 זוגות');
    var n = ed.children.length + 1;
    var row = document.createElement('div'); row.className = 'pair-edit';
    row.innerHTML = '<input type="text" placeholder="פריט ' + n + ' (ימין)" value="' + esc(a) + '" aria-label="פריט ימני">' +
      '<span class="arrow" aria-hidden="true">←</span>' +
      '<input type="text" placeholder="ההתאמה שלו (שמאל)" value="' + esc(b) + '" aria-label="פריט שמאלי">' +
      '<button type="button" class="btn small danger" title="הסרה" aria-label="הסרת זוג">✕</button>';
    row.querySelector('button').onclick = function () { if (ed.children.length > 2) row.remove(); else toast('צריך לפחות 2 זוגות'); };
    ed.appendChild(row);
  }

  /* חלונות השלמה: שדה תשובה לכל ___ בטקסט */
  var blankValues = [];
  function syncBlanks() {
    var ed = $('blankEditor');
    ed.querySelectorAll('input').forEach(function (inp, i) { blankValues[i] = inp.value; });
    var lines = $('qText').value.split('\n');
    var html = '', n = 0, warn = [];
    lines.forEach(function (line, li) {
      var c = (line.match(/_{3,}/g) || []).length;
      if (c > MAX_PER_LINE) warn.push('בשורה ' + (li + 1) + ' יש ' + c + ' חלונות (מקסימום ' + MAX_PER_LINE + ').');
      for (var k = 0; k < c; k++) {
        html += '<div class="blank-edit"><span class="tag">חלון ' + (n + 1) + (lines.length > 1 ? ' · שורה ' + (li + 1) : '') + '</span>' +
          '<input type="text" data-i="' + n + '" placeholder="תשובה נכונה (אפשר כמה, מופרדות ב- /)" value="' + esc(blankValues[n] || '') + '"></div>';
        n++;
      }
    });
    ed.innerHTML = n ? html : '<p class="muted">עדיין אין חלונות. כתבו ___ בטקסט או לחצו "+ חלון השלמה".</p>';
    $('lineWarn').textContent = warn.join(' ');
    $('lineWarn').classList.toggle('hidden', !warn.length);
  }

  function insertBlank() {
    var ta = $('qText'), pos = ta.selectionStart || ta.value.length;
    var lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    var lineEnd = ta.value.indexOf('\n', pos); if (lineEnd < 0) lineEnd = ta.value.length;
    var inLine = (ta.value.slice(lineStart, lineEnd).match(/_{3,}/g) || []).length;
    if (inLine >= MAX_PER_LINE) return toast('בשורה הזו כבר יש ' + MAX_PER_LINE + ' חלונות. עברו לשורה חדשה (Enter).');
    var before = ta.value.slice(0, pos), after = ta.value.slice(pos);
    var ins = (before && !/\s$/.test(before) ? ' ' : '') + '___' + (after && !/^\s/.test(after) ? ' ' : '');
    ta.value = before + ins + after;
    ta.focus(); ta.selectionStart = ta.selectionEnd = pos + ins.length;
    syncBlanks();
  }

  /* תמונה */
  function setImage(src, fromUrl) {
    editingQ.image = src;
    var pv = $('imgPreview');
    if (src) { pv.src = src; pv.classList.remove('hidden'); $('imgRemove').classList.remove('hidden'); }
    else { pv.removeAttribute('src'); pv.classList.add('hidden'); $('imgRemove').classList.add('hidden'); if (!fromUrl) $('imgUrl').value = ''; }
    if (!fromUrl && src && !/^data:/.test(src)) $('imgUrl').value = src;
  }

  function loadImage(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('לא הצלחתי לקרוא את התמונה')); }; im.src = r.result; };
      r.onerror = function () { rej(new Error('לא הצלחתי לקרוא את הקובץ')); };
      r.readAsDataURL(file);
    });
  }

  function compress(im, maxW, quality, png) {
    var scale = Math.min(1, maxW / im.naturalWidth);
    var c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * scale); c.height = Math.round(im.naturalHeight * scale);
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL(png ? 'image/png' : 'image/jpeg', quality);
  }

  /** תמונה קטנה מספיק כדי להישמר ישירות בתא בגיליון */
  function compressToCell(im) {
    var tries = [[900, .8], [700, .7], [560, .6], [440, .55], [340, .5]];
    for (var i = 0; i < tries.length; i++) { var d = compress(im, tries[i][0], tries[i][1], false); if (d.length < 44000) return d; }
    return null;
  }

  function onImageFile() {
    var f = this.files && this.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('בחרו קובץ תמונה');
    var st = $('imgStatus'), save = $('qSave');
    st.textContent = 'מעבד תמונה…'; save.disabled = true;
    loadImage(f).then(function (im) {
      if (ExamAPI.isDemo()) {
        var d = compress(im, 900, .8, false);
        setImage(d, false); st.textContent = 'התמונה נוספה (מצב הדגמה: נשמרת בדפדפן).';
        return;
      }
      var png = f.type === 'image/png';
      var full = compress(im, 1400, .85, png);
      if (full.length > 4000000) full = compress(im, 1400, .8, false);
      st.textContent = 'מעלה את התמונה ל-Google Drive…';
      return api('tUploadImage', { dataUrl: full }).then(function (url) {
        setImage(url, false); st.textContent = 'התמונה הועלתה לתיקייה "מחולל בחינות – תמונות" ב-Drive שלכם.';
      }, function (err) {
        var small = compressToCell(im);
        if (!small) throw new Error('ההעלאה ל-Drive נכשלה (' + err.message + ') והתמונה גדולה מדי לגיליון. נסו להדביק קישור לתמונה.');
        setImage(small, false);
        st.textContent = 'ההעלאה ל-Drive נכשלה, ולכן התמונה כווצה ונשמרת ישירות בגיליון (באיכות נמוכה יותר).';
      });
    }).catch(function (e) { st.textContent = ''; showErr($('qError'), e.message); })
      .then(function () { save.disabled = false; });
  }

  function saveQuestion(e) {
    e.preventDefault();
    var type = editingQ.type;
    var question = { qid: editingQ.qid, examId: $('qExam').value, type: type, text: $('qText').value.trim(),
      points: Number($('qPoints').value) || 0, image: editingQ.image || '' };
    var err = function (m) { showErr($('qError'), m); };
    if (!question.text) return err(type === 'tf' ? 'כתבו את המשפט' : 'כתבו את נוסח השאלה');
    if (type === 'mc') {
      var rows = Array.prototype.slice.call($('optEditor').children);
      var filled = rows.filter(function (r) { return r.querySelector('input[type=text]').value.trim(); });
      if (filled.length < 2) return err('צריך לפחות 2 תשובות');
      question.options = filled.map(function (r) { return r.querySelector('input[type=text]').value.trim(); });
      question.correct = filled.findIndex(function (r) { return r.querySelector('input[type=radio]').checked; });
      if (question.correct < 0) return err('סמנו את התשובה הנכונה (העיגול שליד התשובה)');
    } else if (type === 'tf') {
      var sel = document.querySelector('input[name=tfCorrect]:checked');
      if (!sel) return err('סמנו אם המשפט נכון או לא נכון');
      question.correct = sel.value === 'true';
    } else if (type === 'fill') {
      syncBlanks();
      if (!$('lineWarn').classList.contains('hidden')) return err($('lineWarn').textContent);
      question.correct = Array.prototype.map.call($('blankEditor').querySelectorAll('input'), function (inp) {
        return inp.value.split('/').map(function (s) { return s.trim(); }).filter(Boolean);
      });
      if (!question.correct.length) return err('אין חלונות השלמה. כתבו ___ בטקסט.');
      var empty = question.correct.findIndex(function (a) { return !a.length; });
      if (empty >= 0) return err('חסרה תשובה נכונה לחלון ' + (empty + 1));
    } else {
      question.pairs = Array.prototype.map.call($('pairEditor').children, function (r) {
        var ins = r.querySelectorAll('input'); return [ins[0].value.trim(), ins[1].value.trim()];
      }).filter(function (p) { return p[0] || p[1]; });
      if (question.pairs.length < 2) return err('צריך לפחות 2 זוגות');
      var bad = question.pairs.findIndex(function (p) { return !p[0] || !p[1]; });
      if (bad >= 0) return err('זוג ' + (bad + 1) + ' לא שלם');
    }
    var btn = $('qSave'); btn.disabled = true;
    api('tSaveQuestion', { question: question }).then(function () {
      $('qModal').classList.add('hidden');
      return refresh().then(function () { toast('השאלה נשמרה'); });
    }).catch(function (er) { err(er.message); }).then(function () { btn.disabled = false; });
  }

  /* ---------- תוצאות ---------- */
  function loadResults() {
    var exId = $('rExam').value;
    if (!exId) { results = []; renderResults(); return; }
    $('resultsTable').innerHTML = '<tr><td class="muted">טוען…</td></tr>';
    api('tResults', { examId: exId }).then(function (r) {
      results = r.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : -1; });
      var classes = Array.from(new Set(results.map(function (x) { return x.cls; }))).sort();
      var sel = $('rClass'), prev = sel.value;
      sel.innerHTML = '<option value="">כל הכיתות</option>' + classes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      if (classes.indexOf(prev) !== -1) sel.value = prev;
      renderResults();
    }).catch(fail);
  }

  function filtered() {
    var c = $('rClass').value;
    return results.filter(function (r) { return !c || r.cls === c; });
  }

  function renderResults() {
    var rows = filtered();
    var scores = rows.map(function (r) { return r.score; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : 0;
    var pass = scores.filter(function (s) { return s >= 55; }).length;
    $('stats').innerHTML = rows.length ? [
      ['נבחנים', rows.length], ['ממוצע', avg], ['ציון גבוה', Math.max.apply(null, scores)], ['ציון נמוך', Math.min.apply(null, scores)], ['עברו (55+)', pass]
    ].map(function (s) { return '<div class="stat"><span class="muted">' + s[0] + '</span><b>' + s[1] + '</b></div>'; }).join('') : '';
    if (!rows.length) { $('resultsTable').innerHTML = '<tr><td class="muted" style="padding:18px">אין עדיין הגשות.</td></tr>'; return; }
    $('resultsTable').innerHTML = '<thead><tr><th>תאריך ושעה</th><th>שם</th><th>כיתה</th><th>ת.ז.</th><th class="num">ציון</th><th class="num">נקודות</th><th class="num">דקות</th><th>הערה</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(fmtDate(r.timestamp)) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.cls) + '</td><td>' + esc(r.studentId) + '</td>' +
          '<td class="num"><b>' + r.score + '</b></td><td class="num">' + r.earned + '/' + r.total + '</td><td class="num">' + (r.minutes || 0) + '</td><td>' + (r.late ? 'הוגש באיחור' : '') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function exportCsv() {
    var rows = filtered();
    if (!rows.length) return toast('אין נתונים לייצוא');
    var ex = examById($('rExam').value);
    var head = ['תאריך', 'שם', 'כיתה', 'תעודת זהות', 'ציון', 'נקודות', 'מתוך', 'דקות', 'הערה'];
    var lines = [head].concat(rows.map(function (r) {
      return [fmtDate(r.timestamp), r.name, r.cls, '="' + r.studentId + '"', r.score, r.earned, r.total, r.minutes, r.late ? 'באיחור' : ''];
    })).map(function (cols) {
      return cols.map(function (c) { c = String(c == null ? '' : c); return /^=/.test(c) ? c : '"' + c.replace(/"/g, '""') + '"'; }).join(',');
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'תוצאות - ' + (ex ? ex.title : 'מבחן') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- הגדרות ---------- */
  function changePw(e) {
    e.preventDefault();
    var a = $('newPw').value, b = $('newPw2').value, msg = $('pwMsg');
    msg.className = 'error';
    if (a.length < 4) { msg.textContent = 'לפחות 4 תווים'; return; }
    if (a !== b) { msg.textContent = 'הסיסמאות לא תואמות'; return; }
    api('tChangePw', { newPw: a }).then(function () {
      pw = a; try { sessionStorage.setItem(PW_KEY, a); } catch (x) {}
      msg.className = 'success'; msg.textContent = 'הסיסמה עודכנה'; $('pwForm').reset();
    }).catch(function (err) { msg.textContent = err.message; });
  }

  init();
})();
