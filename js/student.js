/* דף התלמיד: כניסה, מבחן מעורבב (4 סוגי שאלות), הגשה וציון */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var SESSION_KEY = 'examgen-active';
  var LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
  var exams = [];
  var state = null; // { token, title, timeLimit, questions, answers, start, name, cls }
  var timerId = null;
  var submitting = false;
  var matchSel = {}; // qid -> id של הפריט הימני שנבחר וממתין לחיבור

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(view) {
    ['loginView', 'examView', 'resultView'].forEach(function (v) { $(v).classList.toggle('hidden', v !== view); });
    window.scrollTo(0, 0);
  }
  function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
  function hideError(el) { el.classList.add('hidden'); }
  function saveSession() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch (e) {} }
  function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
  function qById(qid) { return state.questions.filter(function (q) { return q.qid === qid; })[0]; }

  /* ---------- כניסה ---------- */
  // שכבה מתוך הכתובת: exam.html?grade=9 | 10 | 11 | bagrut
  var GRADES = { '9': ['ט', 'כיתה ט׳'], '10': ['י', 'כיתה י׳'], '11': ['יא', 'כיתה יא׳'], 'bagrut': ['בגרות', 'מאגר שאלות לבגרות'] };
  var params = new URLSearchParams(location.search);
  var gradeInfo = GRADES[params.get('grade')] || null;

  function init() {
    if (gradeInfo) {
      document.title = 'מחולל בחינות · ' + gradeInfo[1];
      $('gradeLabel').textContent = gradeInfo[1];
      $('gradeLabel').classList.remove('hidden');
    }
    if (ExamAPI.isDemo()) $('demoBanner').classList.remove('hidden');
    $('lightbox').onclick = function () { this.classList.add('hidden'); };

    var saved = loadSession();
    if (saved && saved.token) { state = saved; renderExam(); return; }

    var wanted = params.get('exam');
    ExamAPI.call('listExams', { grade: wanted || !gradeInfo ? '' : gradeInfo[0] }).then(function (list) {
      exams = list;
      var sel = $('exam');
      if (!list.length) {
        sel.innerHTML = '<option value="">אין מבחן פתוח כרגע</option>'; $('startBtn').disabled = true;
        showError($('loginError'), 'אין כרגע מבחן פתוח' + (gradeInfo ? ' ל' + gradeInfo[1] : '') + '. המורה יפתח אותו כשיגיע הזמן.');
        return;
      }
      sel.innerHTML = (list.length > 1 ? '<option value="">בחרו מבחן</option>' : '') +
        list.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.title) + '</option>'; }).join('');
      if (wanted && list.some(function (x) { return x.id === wanted; })) { sel.value = wanted; $('examPick').classList.add('hidden'); }
      else if (list.length === 1) { $('examPick').classList.add('hidden'); }
      onExamChange();
    }).catch(function (e) { showError($('loginError'), e.message); $('exam').innerHTML = '<option value="">שגיאה בטעינה</option>'; });

    $('exam').addEventListener('change', onExamChange);
    $('loginForm').addEventListener('submit', onStart);
    $('sid').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 9); });
  }

  function currentExam() { return exams.filter(function (x) { return x.id === $('exam').value; })[0]; }

  function onExamChange() {
    var ex = currentExam();
    var wrap = $('clsWrap');
    var prev = $('cls') ? $('cls').value : '';
    if (ex && ex.classes && ex.classes.length) {
      wrap.innerHTML = '<select id="cls" required><option value="">בחרו כיתה</option>' +
        ex.classes.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>';
      if (ex.classes.indexOf(prev) !== -1) $('cls').value = prev;
    } else {
      wrap.innerHTML = '<input type="text" id="cls" required>';
      $('cls').value = prev;
    }
  }

  function onStart(ev) {
    ev.preventDefault();
    var err = $('loginError'); hideError(err);
    var data = { examId: $('exam').value, name: $('name').value.trim(), cls: $('cls').value.trim(), sid: $('sid').value.trim() };
    if (!data.examId) return showError(err, 'יש לבחור מבחן');
    if (data.name.length < 2) return showError(err, 'יש להזין שם מלא');
    if (!data.cls) return showError(err, 'יש לבחור כיתה');
    if (!isValidIsraeliId(data.sid)) return showError(err, 'מספר תעודת הזהות אינו תקין. בדקו את כל 9 הספרות.');

    var btn = $('startBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> טוען מבחן…';
    ExamAPI.call('startExam', data).then(function (res) {
      state = { token: res.token, title: res.title, timeLimit: res.timeLimit, questions: res.questions,
        answers: {}, start: Date.now(), name: data.name, cls: data.cls };
      saveSession();
      renderExam();
    }).catch(function (e) { showError(err, e.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'התחלת המבחן'; });
  }

  /* ---------- ציור השאלות ---------- */
  var TYPE_HINT = { mc: 'בחרו תשובה אחת', tf: 'סמנו נכון או לא נכון', fill: 'השלימו את החסר', match: 'חברו בקו: לחצו על פריט מימין ואז על הפריט המתאים משמאל' };

  function renderQuestion(q, i) {
    var a = state.answers[q.qid];
    var html = '<article class="card q" data-qid="' + esc(q.qid) + '" data-type="' + q.type + '">' +
      '<div class="q-head"><span class="q-num">שאלה ' + (i + 1) + ' <span class="q-hint">· ' + TYPE_HINT[q.type] + '</span></span><span class="q-pts">' + q.points + ' נק\'</span></div>';

    if (q.type === 'fill') {
      var n = 0;
      html += '<div class="q-text fill-text">' + q.text.split('\n').map(function (line) {
        return line.split(/_{3,}/).map(function (part, j, arr) {
          var s = esc(part);
          if (j < arr.length - 1) {
            var val = a && a[n] != null ? a[n] : '';
            s += '<input type="text" class="blank-input" data-qid="' + esc(q.qid) + '" data-i="' + n + '" aria-label="חלון השלמה ' + (n + 1) + '" autocomplete="off" value="' + esc(val) + '">';
            n++;
          }
          return s;
        }).join('');
      }).join('<br>') + '</div>';
    } else {
      html += '<div class="q-text">' + esc(q.text) + '</div>';
    }

    if (q.image) html += '<img class="q-img" src="' + esc(q.image) + '" alt="תמונה לשאלה ' + (i + 1) + '" loading="lazy">';

    if (q.type === 'mc') {
      html += q.options.map(function (o, j) {
        var checked = a !== undefined && a !== null && String(a) === String(o.id);
        return '<label class="opt' + (checked ? ' sel' : '') + '"><input type="radio" name="q_' + esc(q.qid) + '" value="' + o.id + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="letter">' + LETTERS[j] + '.</span><span class="t">' + esc(o.text) + '</span></label>';
      }).join('');
    }

    if (q.type === 'tf') {
      html += '<div class="tf-row">' + [[true, 'נכון'], [false, 'לא נכון']].map(function (p) {
        var checked = a === p[0];
        return '<label class="opt tf' + (checked ? ' sel' : '') + '"><input type="radio" name="q_' + esc(q.qid) + '" value="' + p[0] + '"' + (checked ? ' checked' : '') + '>' +
          '<span class="t">' + p[1] + '</span></label>';
      }).join('') + '</div>';
    }

    if (q.type === 'match') {
      html += '<div class="match" data-qid="' + esc(q.qid) + '"><svg class="match-lines" aria-hidden="true"></svg>' +
        '<div class="match-col right">' + q.right.map(function (r) {
          return '<button type="button" class="match-item" data-side="r" data-id="' + r.id + '"><span class="t">' + esc(r.text) + '</span><span class="badge"></span><span class="dot"></span></button>';
        }).join('') + '</div>' +
        '<div class="match-col left">' + q.left.map(function (l, j) {
          return '<button type="button" class="match-item" data-side="l" data-id="' + l.id + '"><span class="dot"></span><span class="letter">' + LETTERS[j] + '</span><span class="t">' + esc(l.text) + '</span></button>';
        }).join('') + '</div></div>' +
        '<button type="button" class="btn ghost small match-clear" data-qid="' + esc(q.qid) + '">ניקוי החיבורים</button>';
    }
    return html + '</article>';
  }

  function renderExam() {
    $('examTitle').textContent = state.title;
    $('examInfo').textContent = state.questions.length + ' שאלות' + (state.timeLimit ? ' · ' + state.timeLimit + ' דקות' : '') + ' · ענו על כל השאלות ולחצו "הגשת המבחן"';
    $('examMeta').innerHTML = '<span>' + esc(state.name) + ' · ' + esc(state.cls) + '</span>' + (state.timeLimit ? '<span class="timer" id="timer"></span>' : '');
    $('questions').innerHTML = state.questions.map(renderQuestion).join('');

    $('questions').onchange = function (e) {
      var t = e.target;
      if (t.type !== 'radio') return;
      var qid = t.name.slice(2), q = qById(qid);
      state.answers[qid] = q.type === 'tf' ? t.value === 'true' : Number(t.value);
      t.closest('.q').querySelectorAll('.opt').forEach(function (l) { l.classList.toggle('sel', l.contains(t)); });
      changed(qid);
    };
    $('questions').oninput = function (e) {
      var t = e.target;
      if (!t.classList.contains('blank-input')) return;
      var q = qById(t.dataset.qid);
      var arr = state.answers[q.qid] || new Array(q.blanks).fill('');
      arr[Number(t.dataset.i)] = t.value;
      state.answers[q.qid] = arr;
      changed(q.qid);
    };
    $('questions').onclick = function (e) {
      var img = e.target.closest('.q-img');
      if (img) { $('lightboxImg').src = img.src; $('lightbox').classList.remove('hidden'); return; }
      var clear = e.target.closest('.match-clear');
      if (clear) { delete state.answers[clear.dataset.qid]; delete matchSel[clear.dataset.qid]; drawMatch(clear.dataset.qid); changed(clear.dataset.qid); return; }
      var item = e.target.closest('.match-item');
      if (item) onMatchClick(item);
    };
    $('submitBtn').onclick = askSubmit;
    $('confirmNo').onclick = function () { $('confirmModal').classList.add('hidden'); };
    $('confirmYes').onclick = function () { $('confirmModal').classList.add('hidden'); submit(false); };
    window.onbeforeunload = function () { return state ? 'המבחן עדיין לא הוגש' : undefined; };
    window.onresize = function () { if (state) drawAllMatches(); };

    updateProgress();
    show('examView');
    drawAllMatches();
    // תמונות שנטענות משנות גובה – לצייר שוב את הקווים
    document.querySelectorAll('.q-img').forEach(function (im) { im.addEventListener('load', drawAllMatches); });
    startTimer();
  }

  function changed(qid) {
    var el = document.querySelector('.q[data-qid="' + qid + '"]');
    if (el && isAnswered(qById(qid))) el.classList.remove('unanswered');
    saveSession(); updateProgress();
  }

  /* ---------- העברת חיצים ---------- */
  function onMatchClick(item) {
    var box = item.closest('.match'), qid = box.dataset.qid;
    var id = Number(item.dataset.id);
    var ans = state.answers[qid] || {};
    if (item.dataset.side === 'r') {
      if (matchSel[qid] === id) { delete matchSel[qid]; }
      else if (ans[id] !== undefined) { delete ans[id]; matchSel[qid] = id; }   // לחיצה על פריט מחובר: מנתקים ובוחרים מחדש
      else { matchSel[qid] = id; }
    } else {
      var r = matchSel[qid];
      if (r === undefined) {
        // לחיצה על פריט שמאלי בלי בחירה: אם הוא מחובר – מנתקים
        Object.keys(ans).forEach(function (k) { if (ans[k] === id) delete ans[k]; });
      } else {
        Object.keys(ans).forEach(function (k) { if (ans[k] === id) delete ans[k]; }); // כל פריט משמאל מחובר פעם אחת
        ans[r] = id;
        delete matchSel[qid];
      }
    }
    if (Object.keys(ans).length) state.answers[qid] = ans; else delete state.answers[qid];
    drawMatch(qid);
    changed(qid);
  }

  function drawAllMatches() {
    document.querySelectorAll('.match').forEach(function (m) { drawMatch(m.dataset.qid); });
  }

  function drawMatch(qid) {
    var box = document.querySelector('.match[data-qid="' + qid + '"]');
    if (!box) return;
    var q = qById(qid), ans = state.answers[qid] || {};
    var svg = box.querySelector('svg');
    var b = box.getBoundingClientRect();
    svg.setAttribute('width', b.width); svg.setAttribute('height', b.height);
    svg.setAttribute('viewBox', '0 0 ' + b.width + ' ' + b.height);
    var leftLetter = {};
    q.left.forEach(function (l, j) { leftLetter[l.id] = LETTERS[j]; });
    var lines = '';
    box.querySelectorAll('.match-item').forEach(function (el) {
      var id = Number(el.dataset.id), side = el.dataset.side;
      var linked = side === 'r' ? ans[id] !== undefined : Object.keys(ans).some(function (k) { return ans[k] === id; });
      el.classList.toggle('linked', linked);
      el.classList.toggle('picked', side === 'r' && matchSel[qid] === id);
      if (side === 'r') el.querySelector('.badge').textContent = linked ? leftLetter[ans[id]] : '';
    });
    Object.keys(ans).forEach(function (rid) {
      var r = box.querySelector('.match-item[data-side="r"][data-id="' + rid + '"] .dot');
      var l = box.querySelector('.match-item[data-side="l"][data-id="' + ans[rid] + '"] .dot');
      if (!r || !l) return;
      var rb = r.getBoundingClientRect(), lb = l.getBoundingClientRect();
      var x1 = rb.left + rb.width / 2 - b.left, y1 = rb.top + rb.height / 2 - b.top;
      var x2 = lb.left + lb.width / 2 - b.left, y2 = lb.top + lb.height / 2 - b.top;
      var mx = (x1 + x2) / 2;
      lines += '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" fill="none" stroke="#0E8D81" stroke-width="3" stroke-linecap="round"/>' +
        '<polygon points="' + (x2 + 11) + ',' + (y2 - 6) + ' ' + (x2 + 11) + ',' + (y2 + 6) + ' ' + x2 + ',' + y2 + '" fill="#0E8D81"/>';
    });
    svg.innerHTML = lines;
  }

  /* ---------- התקדמות, זמן והגשה ---------- */
  function isAnswered(q) {
    var a = state.answers[q.qid];
    if (q.type === 'fill') return Array.isArray(a) && a.length >= q.blanks && a.slice(0, q.blanks).every(function (x) { return String(x || '').trim() !== ''; });
    if (q.type === 'match') return !!a && Object.keys(a).length === q.right.length;
    return a !== undefined && a !== null;
  }
  function answeredCount() { return state.questions.filter(isAnswered).length; }
  function updateProgress() { $('progressBar').style.width = (answeredCount() / state.questions.length * 100) + '%'; }

  function startTimer() {
    if (!state.timeLimit) return;
    clearInterval(timerId);
    var tick = function () {
      var left = Math.max(0, Math.round(state.timeLimit * 60 - (Date.now() - state.start) / 1000));
      var el = $('timer');
      if (el) {
        el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
        el.classList.toggle('warn', left <= 60);
      }
      if (left <= 0) { clearInterval(timerId); submit(true); }
    };
    tick(); timerId = setInterval(tick, 1000);
  }

  function askSubmit() {
    var missing = 0;
    document.querySelectorAll('.q').forEach(function (el) {
      var ok = isAnswered(qById(el.dataset.qid));
      if (!ok) missing++;
      el.classList.toggle('unanswered', !ok);
    });
    $('confirmText').textContent = missing ? 'יש ' + missing + ' שאלות שלא עניתם עליהן במלואן (מסומנות באדום). אחרי ההגשה אי אפשר לשנות.' : 'אחרי ההגשה אי אפשר לשנות תשובות.';
    $('confirmModal').classList.remove('hidden');
  }

  function submit(auto) {
    if (submitting) return;
    submitting = true;
    var btn = $('submitBtn'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> שולח…';
    hideError($('submitError'));
    ExamAPI.call('submitExam', { token: state.token, answers: state.answers }).then(function (res) {
      clearInterval(timerId);
      var name = state.name;
      state = null; clearSession(); window.onbeforeunload = null;
      $('examMeta').innerHTML = '';
      $('resultName').textContent = name + (auto ? ' · הזמן הסתיים והמבחן הוגש אוטומטית' : '');
      $('scoreNum').textContent = res.score;
      $('scoreRing').style.setProperty('--p', res.score);
      $('resultMsg').textContent = res.score >= 90 ? 'כל הכבוד!' : res.score >= 55 ? 'עברתם את המבחן.' : 'כדאי לחזור על החומר.';
      show('resultView');
    }).catch(function (e) {
      showError($('submitError'), e.message + ' אפשר לנסות שוב.');
      btn.disabled = false; btn.textContent = 'הגשת המבחן';
    }).then(function () { submitting = false; });
  }

  init();
})();
