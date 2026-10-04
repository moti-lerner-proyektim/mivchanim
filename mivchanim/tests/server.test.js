// בדיקות לקוד השרת (Code.gs) עם שירותי Google מדומים. הרצה: node tests/server.test.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const ctx = { console, crypto: require('crypto').webcrypto };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/google-shim.js'), 'utf8'), ctx);
const G = ctx.GoogleShim;
const drive = { files: [] };
const DriveApp = {
  Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' },
  getFoldersByName: () => ({ hasNext: () => false }),
  createFolder: () => ({ createFile: (b) => { const f = { id: 'F' + drive.files.length, b, getId() { return this.id; }, setSharing() { this.shared = true; } }; drive.files.push(f); return f; } })
};
const Utilities = Object.assign({}, G.Utilities, {
  base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (bytes, type, name) => ({ bytes, type, name })
});
const factory = new Function('SpreadsheetApp', 'CacheService', 'PropertiesService', 'LockService', 'Utilities', 'ContentService', 'DriveApp',
  fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8') + '\nreturn { doPost, setup, isValidIsraeliId };');
const S = factory(G.SpreadsheetApp, G.CacheService, G.PropertiesService, G.LockService, Utilities, G.ContentService, DriveApp);
S.setup();
const call = (action, body) => JSON.parse(S.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, body)) } }).content);
const ok = (r) => { if (!r.ok) throw new Error('expected ok: ' + r.error); return r.data; };
const err = (r, re) => { assert.ok(!r.ok, 'expected error'); assert.match(r.error, re); };
const pw = '1234';

// כניסת מורה
err(call('tLogin', { pw: 'x' }), /סיסמה/);
assert.equal(ok(call('tLogin', { pw })).maxQuestions, 40);

// מבחן לדוגמה עם 4 סוגים
let all = ok(call('tGetAll', { pw }));
assert.deepEqual(all.questions.map(q => q.type).sort(), ['fill', 'match', 'mc', 'tf']);

// מבחן חדש + בדיקות תקינות
const ex = ok(call('tSaveExam', { pw, exam: { title: 'בדיקה', open: true, grade: 'יא' } }));
err(call('tSaveExam', { pw, exam: { title: 'x', drawCount: 41, grade: 'י' } }), /40/);
err(call('tSaveExam', { pw, exam: { title: 'בלי שכבה' } }), /שכבה/);
// סינון לפי שכבה
assert.deepEqual(ok(call('listExams', { grade: 'יא' })).map(x => x.id), [ex]);
assert.equal(ok(call('listExams', { grade: 'י' })).length, 1);   // מבחן הדוגמה
assert.equal(ok(call('listExams', { grade: 'ט' })).length, 0);
assert.equal(ok(call('listExams', {})).length, 2);
const Q = (q) => call('tSaveQuestion', { pw, question: Object.assign({ examId: ex, points: 10 }, q) });
err(Q({ type: 'mc', text: 'a', options: ['x'], correct: 0 }), /2 עד 6/);
err(Q({ type: 'tf', text: 'a' }), /נכון/);
err(Q({ type: 'fill', text: 'אין חלון', correct: [] }), /___/);
err(Q({ type: 'fill', text: '___ ___ ___ ___ ___ ___', correct: [['a'], ['a'], ['a'], ['a'], ['a'], ['a']] }), /המקסימום הוא 5/);
err(Q({ type: 'fill', text: '___ ו-___', correct: [['a']] }), /2 חלונות/);
err(Q({ type: 'match', text: 'a', pairs: [['a', 'b']] }), /2 עד 8/);
err(Q({ type: 'match', text: 'a', pairs: [['a', 'b'], ['c', '']] }), /לא שלם/);
err(Q({ type: 'mc', text: 'a', options: ['x', 'y'], correct: 0, image: 'http://x' }), /https/);
// 5 בשורה + עוד שורה עם 5 = מותר (מגבלה לשורה)
const qFill = ok(Q({ type: 'fill', text: '___ ___ ___ ___ ___\n___ ___ ___ ___ ___', correct: Array.from({ length: 10 }, (_, i) => ['w' + i]) }));
const qMc = ok(Q({ type: 'mc', text: 'מה?', options: ['A', 'B', 'C'], correct: 2, image: 'https://example.com/a.png' }));
const qTf = ok(Q({ type: 'tf', text: 'נכון?', correct: true }));
const qMatch = ok(Q({ type: 'match', text: 'חברו', pairs: [['1', 'א'], ['2', 'ב'], ['3', 'ג'], ['4', 'ד']] }));

// מגבלת 40
for (let i = 0; i < 36; i++) ok(Q({ type: 'tf', text: 't' + i, correct: false }));
err(Q({ type: 'tf', text: 'עוד אחת', correct: false }), /מקסימום של 40/);
// עריכה של שאלה קיימת עדיין מותרת
ok(Q({ qid: qTf, type: 'tf', text: 'נכון? (עודכן)', correct: true }));

// העלאת תמונה ל-Drive
const png = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');
const url = ok(call('tUploadImage', { pw, dataUrl: png }));
assert.match(url, /^https:\/\/drive\.google\.com\/thumbnail\?id=F0/); assert.ok(drive.files[0].shared);
err(call('tUploadImage', { pw, dataUrl: 'data:text/plain;base64,AAA' }), /אינו נתמך/);

// מבחן לתלמיד: רק 4 שאלות, מגריל 4 מתוך 40
ok(call('tSaveExam', { pw, exam: { id: ex, title: 'בדיקה', open: true, drawCount: 0, grade: 'יא' } }));
const start = (sid) => ok(call('startExam', { examId: ex, name: 'תלמיד', cls: 'יא1', sid }));
const s1 = start('000000018');
assert.equal(s1.questions.length, 40);
const txt = JSON.stringify(s1);
assert.ok(!/"correct"|"pairs"|w0/.test(txt), 'answers leaked to student');
const byId = Object.fromEntries(s1.questions.map(q => [q.qid, q]));
assert.equal(byId[qFill].blanks, 10); assert.equal(byId[qMc].image, 'https://example.com/a.png');
assert.equal(byId[qMatch].right.length, 4); assert.equal(byId[qMatch].left.length, 4);

// תשובות: mc נכון, tf נכון, fill 7/10, match 2/4, השאר (36 tf, נכון=false) – חצי נכון
const answers = {};
answers[qMc] = 2; answers[qTf] = true;
answers[qFill] = Array.from({ length: 10 }, (_, i) => i < 7 ? ' W' + i + '. ' : 'zzz');
answers[qMatch] = { 0: 0, 1: 1, 2: 3, 3: 2 };
s1.questions.filter(q => q.type === 'tf' && q.qid !== qTf).forEach((q, i) => { answers[q.qid] = i % 2 ? false : 'true'; });
const r1 = ok(call('submitExam', { token: s1.token, answers }));
// נקודות: mc10 + tf10 + fill7 + match5 + 18 טובות*10 = 212 מתוך 400 -> 53
assert.equal(r1.score, 53);
err(call('submitExam', { token: s1.token, answers }), /פג תוקף/);
err(call('startExam', { examId: ex, name: 'תלמיד', cls: 'יא1', sid: '00018' }), /כבר הגשת/);
const res = ok(call('tResults', { pw, examId: ex }));
assert.equal(res.length, 1); assert.equal(res[0].earned, 212); assert.equal(res[0].total, 400); assert.equal(res[0].studentId, '000000018');

// הגרלה
ok(call('tSaveExam', { pw, exam: { id: ex, title: 'בדיקה', open: true, drawCount: 15, grade: 'יא' } }));
assert.equal(start('123456782').questions.length, 15);

// ערבוב: שני תלמידים מקבלים סדר שונה
ok(call('tSaveExam', { pw, exam: { id: ex, title: 'בדיקה', open: true, drawCount: 0, allowRetake: true, grade: 'יא' } }));
const a = start('123456782'), b = start('123456782');
assert.notDeepEqual(a.questions.map(q => q.qid), b.questions.map(q => q.qid));

// תאימות לאחור: שאלת השלמה בפורמט הישן "a|b"
const ctx2 = {}; vm.createContext(ctx2); vm.runInContext(fs.readFileSync(path.join(root, 'js/core.js'), 'utf8'), ctx2);
const old = ctx2.parseQuestion({ qid: 'o', examId: 'e', type: 'fill', text: 'x ___', correct: 'DHCP|dhcp server', points: 5 });
assert.equal(ctx2.scoreQuestion(old, ['Dhcp Server']), 1);
assert.equal(ctx2.scoreQuestion({ type: 'tf', correct: false }, 'false'), 1);
assert.equal(ctx2.scoreQuestion({ type: 'tf', correct: false }, 'maybe'), 0);

// מיגרציה: גיליון ישן בלי עמודת image
G.reset();
const S2 = factory(G.SpreadsheetApp, G.CacheService, G.PropertiesService, G.LockService, Utilities, G.ContentService, DriveApp);
const ss = G.SpreadsheetApp.getActiveSpreadsheet();
const oldQ = ss.insertSheet('Questions'); oldQ.appendRow(['qid', 'examId', 'type', 'text', 'options', 'correct', 'points']);
oldQ.appendRow(['x1', 'e1', 'fill', 'old ___', '', 'abc', 3]);
const oldE = ss.insertSheet('Exams'); oldE.appendRow(['id', 'title', 'open', 'timeLimit', 'allowRetake', 'drawCount', 'classes']); oldE.appendRow(['e1', 'ישן', true, 0, false, 0, '']);
S2.setup();
const head = oldQ.getDataRange().getValues()[0];
assert.ok(head.includes('image'));
const r2 = JSON.parse(S2.doPost({ postData: { contents: JSON.stringify({ action: 'tGetAll', pw: '1234' }) } }).content).data;
assert.deepEqual(r2.questions[0].correct, [['abc']]);

console.log('server tests OK');
