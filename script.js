'use strict';
// ===== 設定 =====
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzRa6s9XUMV0YHQVwc8LnqRi9HgdoQsj2KT8K2daLcCr0hnB2xPzv18ZqyfMt5fCINT/exec';   // GASをデプロイして得たURLに置き換える
const STUDY_END = 10;             // 学習できる最終日
const TEST_DAY = 15;              // この日以降に遅延テスト

const $ = id => document.getElementById(id);
const show = n => document.querySelectorAll('section').forEach(s => s.hidden = s.id !== 's-' + n);
const norm = s => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const isOK = (w, a) => w.ja.some(x => norm(x) === norm(a));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const jget = k => JSON.parse(localStorage.getItem(k) || 'null');
const jset = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ===== 参加者情報 (?id=P07&c=bar) =====
const P = new URLSearchParams(location.search);
let S = jget('st') || {};
if (P.get('id') && S.id !== P.get('id')) S = { id: P.get('id') };
if (P.get('id')) S.cond = P.get('c') || S.cond;
jset('st', S);

let words = [], info = null, sid = '', mode = '', Q = [], done = 0, score = 0;
let tries = {}, cur = null, t0 = 0, tSes = 0, fbShown = false;

// ===== ログ（送信失敗時は端末に溜めて再送）=====
let sending = false;
function log(event, o = {}) {
  const q = jget('queue') || [];
  q.push({ ts: new Date().toISOString(), eid: Date.now() + Math.random().toString(36).slice(2, 6),
    id: S.id, cond: S.cond, day: info ? info.day : '', event, sid, ...o });
  jset('queue', q); flush();
}
async function flush() {
  if (sending) return;
  const q = (jget('queue') || []).slice(0, 100);
  if (!q.length) return;
  sending = true;
  try {
    const r = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(q), keepalive: true });
    if ((await r.json()).ok) jset('queue', (jget('queue') || []).slice(q.length));
  } catch (e) { /* 次回再送 */ }
  sending = false;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

// ===== 起動 =====
async function init() {
  show('load'); $('retry').hidden = true; $('msg').textContent = '読み込み中...';
  if (!S.id) { $('msg').textContent = 'URLが正しくありません．配布されたURLから開いてください．'; return; }
  try {
    words = await (await fetch('words.json')).json();
    info = await (await fetch(GAS_URL + '?action=init&id=' + encodeURIComponent(S.id) + '&cond=' + encodeURIComponent(S.cond || ''))).json();
    if (!info.ok) throw new Error('init');
    S.cond = info.cond; jset('st', S); flush();
    S.consent ? home() : show('consent');
  } catch (e) { $('msg').textContent = '読み込みに失敗しました．通信を確認してください．'; $('retry').hidden = false; }
}

function home() {
  show('home');
  $('who').textContent = 'ID: ' + S.id;
  $('day').textContent = info.day + ' 日目';
  const canStudy = info.day <= STUDY_END && !info.testDone;
  const canTest = info.day >= TEST_DAY && !info.testDone;
  $('b-study').hidden = !canStudy; $('b-test').hidden = !canTest;
  $('note').textContent = info.testDone ? 'すべて終了しました．ご協力ありがとうございました．'
    : canStudy ? '1日に何度でも学習できます．'
    : canTest ? '' : TEST_DAY + '日目に最終テストがあります．';
}

// ===== 学習 / テスト =====
function startStudy() {
  mode = 'study'; sid = 'S' + Date.now(); Q = shuffle(words); done = 0; tries = {}; tSes = Date.now();
  $('pg').hidden = S.cond !== 'bar';          // 対照群は進捗表示を一切出さない
  updBar(); log('session_start'); showQ();
}
function startTest() {
  mode = 'test'; sid = 'T' + Date.now(); Q = shuffle(words); score = 0; tries = {};
  $('pg').hidden = true; log('test_start'); showQ();
}
function updBar() {
  const p = Math.round(done / words.length * 100);
  $('bar').value = p; $('pgtext').textContent = '学習進捗：' + p + '%';
}
function showQ() {
  cur = Q[0]; fbShown = false; show('study');
  $('word').textContent = cur.en; $('ans').value = ''; $('ans').disabled = false;
  $('fb').textContent = ''; $('fb').className = ''; $('b-next').hidden = true; $('b-ans').hidden = false;
  $('qno').hidden = mode !== 'test';
  if (mode === 'test') $('qno').textContent = '問題 ' + (words.length - Q.length + 1) + ' / ' + words.length;
  t0 = Date.now(); $('ans').focus();
}
function answer() {
  if (fbShown) return;
  const a = $('ans').value.trim();
  if (!a) { $('fb').className = 'ng'; $('fb').textContent = '答えを入力してください．'; return; }
  const rt = Date.now() - t0, ok = isOK(cur, a);
  tries[cur.no] = (tries[cur.no] || 0) + 1;
  log(mode === 'study' ? 'answer' : 'test_answer', { word: cur.no, answer: a, correct: ok ? 1 : 0, rt, attempt: tries[cur.no] });
  Q.shift();
  if (mode === 'test') { if (ok) score++; return Q.length ? showQ() : finishTest(); }
  done++;                              // 正誤にかかわらず進捗が進み，20問で終了
  updBar(); fbShown = true;
  $('fb').className = ok ? 'ok' : 'ng';
  $('fb').textContent = (ok ? '正解です！ ' : '不正解です． ') + '正解：' + cur.ja[0];
  $('ans').disabled = true; $('b-ans').hidden = true; $('b-next').hidden = false;
  setTimeout(() => $('b-next').focus(), 50);
}
function next() { fbShown = false; Q.length ? showQ() : finishStudy(); }
function finishStudy() {
  log('session_complete', { rt: Date.now() - tSes });
  end('本日の学習は完了です', 'お疲れさまでした．');
}
function finishTest() {
  log('test_done', { score }); info.testDone = true;
  end('最終テストは終了です', 'ご協力ありがとうございました．');
}
function end(t, p) { show('end'); $('end-t').textContent = t; $('end-p').textContent = p; }

// ===== イベント =====
$('retry').onclick = init;
$('agree').onchange = e => $('b-consent').disabled = !e.target.checked;
$('b-consent').onclick = () => { S.consent = 1; jset('st', S); log('consent'); home(); };
$('b-study').onclick = startStudy;
$('b-test').onclick = startTest;
$('b-ans').onclick = answer;
$('b-next').onclick = next;
$('b-home').onclick = home;
$('ans').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) answer();   // 日本語変換確定のEnterは無視
});
init();