// Type A — improved typing feel + pacing
const $ = (id) => document.getElementById(id);
const elInbox = $('inbox'), elGhost = $('ghost'), elInput = $('input');
const elSender = $('metaSender'), elSubject = $('metaSubject'), elUrg = $('metaUrgency');
const elWpm = $('wpm'), elAcc = $('acc'), elDone = $('done'), elStress = $('stressBar');
const overlay = $('overlay'), ovWpm = $('ovWpm'), ovAcc = $('ovAcc'), ovDone = $('ovDone');
const btnOverlayRestart = $('overlayRestart');

// Difficulty tuned to feel fair @ ~95 WPM, with breathing room
const DIFF = {
  intern:  { spawnMs:[9000,14000], targetWPM:35, queueMax:4, dayGoal:10 },
  manager: { spawnMs:[7000,12000], targetWPM:55, queueMax:5, dayGoal:14 },
  director:{ spawnMs:[5500,10000], targetWPM:75, queueMax:6, dayGoal:18 }
};

let emailsPool = [];
let bag = [];  // shuffle-bag of indices to avoid repeats
let state = {
  queue: [],
  activeId: null,
  stress: 0,         // 0..100
  resolved: 0,       // total session
  resolvedToday: 0,  // for the current day
  totalChars: 0,
  correctChars: 0,
  totalTimeMs: 0,
  diffKey: 'manager',
  lenient: true,
  day: 1,
  spawnTimer: null,
  rafId: 0
};

const rnd = (min,max)=>Math.floor(Math.random()*(max-min+1))+min;
const now = ()=>performance.now();

// ---------- data ----------
async function loadPool(){
  const res = await fetch('assets/typea-emails.json', { cache:'no-store' });
  emailsPool = await res.json();
  refillBag();
}
function refillBag(){
  bag = [...Array(emailsPool.length).keys()];
  // Fisher–Yates
  for (let i=bag.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1)); [bag[i], bag[j]]=[bag[j], bag[i]];
  }
}

// ---------- spawn / timers ----------
function spawnEmail(){
  if (!emailsPool.length) return;
  const { queueMax, targetWPM } = DIFF[state.diffKey];
  if (state.queue.length >= queueMax) return;

  if (!bag.length) refillBag();
  const idx = bag.pop();
  const src = emailsPool[idx];

  // dynamic deadline from message length + difficulty target WPM (with small randomness)
  const words = (src.bodyTarget.length)/5;
  let dueMs = (words / targetWPM) * 60000;
  dueMs *= rnd(108,125)/100;          // 8–25% cushion
  dueMs = Math.max(15000, Math.min(dueMs, 90000)); // clamp 15–90s

  const dueAt = now() + dueMs;
  const email = {
    id: `${src.id}-${Math.random().toString(36).slice(2,7)}`,
    sender: src.sender,
    subject: src.subject,
    baseUrgency: src.urgency || 'normal',
    body: src.bodyTarget,
    dueAt, dueMs,
    typed: '',
    firstKeyAt: 0
  };
  state.queue.push(email);
  if (!state.activeId) selectEmail(email.id);
  renderInbox();
}

function scheduleSpawns(){
  clearTimeout(state.spawnTimer);
  const [a,b] = DIFF[state.diffKey].spawnMs;
  const delay = rnd(a,b);
  state.spawnTimer = setTimeout(()=>{ spawnEmail(); scheduleSpawns(); }, delay);
}

// ---------- urgency / colors ----------
function urgencyFromRemaining(rem, dueMs){
  const r = Math.max(0, rem) / Math.max(1, dueMs);
  if (r <= 0.25) return 'urgent';
  if (r <= 0.60) return 'normal';
  return 'low';
}
function ringColorFor(u){ return u==='urgent' ? '#e53935' : (u==='low' ? '#2f9e44' : '#f7b500'); }
function setMetaUrg(u){
  elUrg.textContent = u[0].toUpperCase()+u.slice(1);
  elUrg.className = 'badge ' + (u==='urgent'?'urgent': (u==='low'?'low':''));
}

// ---------- selection ----------
function selectEmail(id){
  const e = state.queue.find(x=>x.id===id) || null;
  state.activeId = e ? e.id : null;

  elSender.textContent = e ? e.sender : '—';
  elSubject.textContent = e ? e.subject : 'Select an email';
  elInput.value = e ? e.typed : '';

  // Draw combined ghost/typed
  paintLine(e);

  // meta urgency now
  if (e){
    const rem = Math.max(0, e.dueAt - now());
    setMetaUrg(urgencyFromRemaining(rem, e.dueMs));
  } else { elUrg.textContent=''; elUrg.className='badge'; }

  renderInbox();
}
function active(){ return state.queue.find(x=>x.id===state.activeId) || null; }

// ---------- normalize punctuation for comparison ----------
function normChar(ch){
  const map = {
    '“':'"', '”':'"', '„':'"', '‟':'"', '«':'"', '»':'"',
    '‘':"'", '’':"'", '‚':"'", '‛':"'",
    '–':'-', '—':'-', '−':'-',
    '\u00A0':' ', '\u2009':' ', '\u200A':' ', '\u2002':' ', '\u2003':' ', '\u2006':' '
  };
  return map[ch] || ch;
}

// ---------- draw combined line (no overlay misalignment) ----------
function paintLine(e){
  if (!e){ elGhost.innerHTML=''; return; }
  const t = e.typed || '';
  const target = e.body;
  const n = Math.min(t.length, target.length);

  let correctSoFar = 0;
  let html = '';
  for (let i=0;i<target.length;i++){
    if (i < n){
      const ok = normChar(t[i]) === normChar(target[i]);
      if (ok) correctSoFar++;
      html += `<span class="${ok?'ok':'err'}">${escapeHtml(target[i])}</span>`;
    } else {
      html += `<span class="ghost">${escapeHtml(target[i])}</span>`;
    }
  }
  elGhost.innerHTML = html;

  // Live WPM/accuracy (typed portion only)
  if (!e.firstKeyAt || t.length===0) {
    elWpm.textContent = '0';
    elAcc.textContent = '100%';
  } else {
    const elapsed = Math.max(1, now() - e.firstKeyAt);
    const grossWpm = ((t.length/5) / (elapsed/60000)) || 0;
    elWpm.textContent = Math.round(grossWpm);
    const acc = n ? (correctSoFar / n) * 100 : 100;
    elAcc.textContent = Math.max(0, Math.min(100, Math.round(acc))) + '%';
  }
}

function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ---------- input ----------
elInput.addEventListener('input', ()=>{
  const e = active(); if (!e) return;
  if (!e.firstKeyAt && elInput.value.length>0) e.firstKeyAt = now(); // start clock on first keystroke
  e.typed = elInput.value;
  paintLine(e);
});

// exact/lenient send
function trySend(exactOnly=false){
  const e = active(); if (!e) return;
  const t = e.typed || '';
  const target = e.body;
  const n = Math.min(t.length, target.length);
  let correct = 0;
  for (let i=0;i<n;i++) if (normChar(t[i])===normChar(target[i])) correct++;

  const exact = (t === target);
  const accTyped = n ? correct/n : 1;
  const elapsed = e.firstKeyAt ? (now() - e.firstKeyAt) : 1;

  const ok = exact || (!exactOnly && state.lenient && accTyped >= 0.95 && t.length >= target.length*0.95);
  if (ok){
    // success
    state.resolved++;
    state.resolvedToday++;
    state.totalChars += target.length;
    state.correctChars += Math.round(target.length * accTyped);
    state.totalTimeMs += elapsed;
    bumpStress(-8);
    removeEmail(e.id);
    checkDayProgress();
    selectNext();
  } else {
    // nudge
    elInput.style.borderColor = '#ef476f';
    setTimeout(()=>elInput.style.borderColor='#e0e0e0', 150);
  }
}

function removeEmail(id){
  const idx = state.queue.findIndex(x=>x.id===id);
  if (idx>=0) state.queue.splice(idx,1);
  renderInbox();
}
function selectNext(dir=1){
  if (!state.queue.length){ state.activeId=null; renderInbox(); return; }
  const idx = Math.max(0, state.queue.findIndex(x=>x.id===state.activeId));
  const nextIdx = (idx + dir + state.queue.length) % state.queue.length;
  selectEmail(state.queue[nextIdx].id);
}

// ---------- inbox render ----------
function requiredWpmFor(e){
  const rem = Math.max(1, e.dueAt - now());
  const remainingChars = Math.max(0, e.body.length - (e.typed||'').length);
  const req = ((remainingChars/5) / (rem/60000));
  // nearest 5 WPM
  return Math.max(0, Math.round(req/5)*5);
}

function renderInbox(){
  const items = state.queue.map((e)=>{
    const rem = Math.max(0, e.dueAt - now());
    const pElapsed = Math.max(0, 1 - rem / e.dueMs);
    const pct = Math.floor(pElapsed*100);
    const urg = urgencyFromRemaining(rem, e.dueMs);
    const ringColor = ringColorFor(urg);
    const timeLeft = Math.ceil(rem/1000);
    const activeCls = e.id===state.activeId ? ' active' : '';
    const reqWpm = requiredWpmFor(e);
    if (e.id===state.activeId) setMetaUrg(urg);
    return `
      <div class="email${activeCls}" data-id="${e.id}">
        <div class="ring" style="--p:${pct};--ring-color:${ringColor}"><span>${timeLeft}</span></div>
        <div style="flex:1;min-width:0">
          <div class="sender">${e.sender}</div>
          <div class="subject ellipsis">${e.subject} <span style="color:#7a7a7a;font-size:.8rem">· ~${reqWpm} WPM</span></div>
        </div>
        <span class="badge ${urg==='urgent'?'urgent':urg==='low'?'low':''}">${urg}</span>
      </div>`;
  }).join('');
  elInbox.innerHTML = items || `<div class="email" style="justify-content:center;color:#666">Inbox zero — nice.</div>`;
}

// ---------- day progression ----------
function checkDayProgress(){
  const goal = DIFF[state.diffKey].dayGoal + (state.day-1); // tiny ramp per day
  if (state.resolvedToday >= goal){
    showDayComplete(goal);
  }
}
function showDayComplete(goal){
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.spawnTimer);
  const avgWpm = state.totalTimeMs ? Math.round(((state.totalChars/5)/(state.totalTimeMs/60000))) : 0;
  const accPct = state.totalChars ? Math.round((state.correctChars/state.totalChars)*100) : 100;
  $('overlay').querySelector('h3').textContent = `Day ${state.day} complete 🎯`;
  $('overlay').querySelector('p').textContent = `Nice work. You cleared ${goal} emails today. Ready for tomorrow?`;
  ovWpm.textContent = avgWpm; ovAcc.textContent = accPct + '%'; ovDone.textContent = state.resolved;
  btnOverlayRestart.textContent = 'Next Day';
  overlay.classList.add('active');
}
function endGame(){
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.spawnTimer);
  const avgWpm = state.totalTimeMs ? Math.round(((state.totalChars/5)/(state.totalTimeMs/60000))) : 0;
  const accPct = state.totalChars ? Math.round((state.correctChars/state.totalChars)*100) : 100;
  $('overlay').querySelector('h3').textContent = 'Burnout 💥';
  $('overlay').querySelector('p').textContent = 'You pushed it too hard. Take a breath and try again.';
  ovWpm.textContent = avgWpm; ovAcc.textContent = accPct + '%'; ovDone.textContent = state.resolved;
  btnOverlayRestart.textContent = 'Restart';
  overlay.classList.add('active');
}

// ---------- tick / stress ----------
function tick(){
  const t = now();
  for (let i=state.queue.length-1; i>=0; i--){
    const e = state.queue[i];
    if (t >= e.dueAt){
      bumpStress(15);
      state.queue.splice(i,1);
      if (e.id === state.activeId) state.activeId = null;
    }
  }
  if (state.stress >= 100){ endGame(); return; }
  renderInbox();
  state.rafId = requestAnimationFrame(tick);
}
function bumpStress(delta){
  state.stress = Math.max(0, Math.min(100, state.stress + delta));
  elStress.style.width = state.stress + '%';
}

// ---------- keyboard / mouse ----------
window.addEventListener('keydown', (e)=>{
  // F1–F6 to select inbox slots (numbers free for typing)
  if (/^F[1-6]$/.test(e.key)){
    const idx = Number(e.key.slice(1)) - 1;
    if (state.queue[idx]) { selectEmail(state.queue[idx].id); e.preventDefault(); }
    return;
  }
  if (e.key === 'Tab'){
    e.preventDefault();
    selectNext(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === 'Enter'){
    if (e.ctrlKey || e.metaKey) { trySend(false); }
    else { trySend(true); }
    e.preventDefault();
  }
});
elInbox.addEventListener('click', (e)=>{
  const item = e.target.closest('.email');
  if (!item) return;
  selectEmail(item.dataset.id);
  elInput.focus();
});

// ---------- controls ----------
$('difficulty').addEventListener('change', (e)=>{
  state.diffKey = e.target.value;
});
$('lenient').addEventListener('change', (e)=>{
  state.lenient = e.target.checked;
});
$('restart').addEventListener('click', startGame);
btnOverlayRestart.addEventListener('click', ()=>{
  // If day complete → harder next day; if burnout → restart day 1
  if (btnOverlayRestart.textContent.includes('Next Day')){
    overlay.classList.remove('active');
    // ramp difficulty slightly: faster spawns, tighter target WPM by +3 per day
    state.day++;
    state.resolvedToday = 0;
    // tiny stress carry-over reset
    state.stress = Math.max(0, state.stress - 30);
    elStress.style.width = state.stress + '%';
    // bump targetWPM by 3 (soft ramp)
    DIFF[state.diffKey].targetWPM += 3;
    startLoops();
  } else {
    overlay.classList.remove('active');
    startGame(); // full reset
  }
});

// ---------- start/reset ----------
async function startGame(){
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.spawnTimer);
  if (!emailsPool.length) await loadPool();
  state.queue = [];
  state.activeId = null;
  state.stress = 0;
  state.resolved = 0;
  state.resolvedToday = 0;
  state.totalChars = 0;
  state.correctChars = 0;
  state.totalTimeMs = 0;
  state.day = 1;
  // reset targetWPM to defaults
  DIFF.intern.targetWPM  = 35;
  DIFF.manager.targetWPM = 55;
  DIFF.director.targetWPM= 75;

  elStress.style.width = '0%';
  elDone.textContent = '0';
  elWpm.textContent = '0';
  elAcc.textContent = '100%';
  overlay.classList.remove('active');

  // seed 3
  spawnEmail(); spawnEmail(); spawnEmail();
  startLoops();
  elInput.value = '';
  elInput.focus();
}
function startLoops(){
  renderInbox();
  scheduleSpawns();
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(tick);
}

startGame();
