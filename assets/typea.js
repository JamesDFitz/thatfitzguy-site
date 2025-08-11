// Type A — minimal, fast, and vanilla
const $ = (id) => document.getElementById(id);
const elInbox = $('inbox'), elGhost = $('ghost'), elMask = $('typedMask'), elInput = $('input');
const elSender = $('metaSender'), elSubject = $('metaSubject'), elUrg = $('metaUrgency');
const elWpm = $('wpm'), elAcc = $('acc'), elDone = $('done'), elStress = $('stressBar');
const overlay = $('overlay'), ovWpm = $('ovWpm'), ovAcc = $('ovAcc'), ovDone = $('ovDone');

const DIFF = {
  intern:  { spawnMs:[5200,9000], dueRange:[24000,34000], queueMax:4 },
  manager: { spawnMs:[3800,7200], dueRange:[18000,28000], queueMax:5 },
  director:{ spawnMs:[2500,5200], dueRange:[12000,22000], queueMax:6 }
};

let emailsPool = [];
let state = {
  queue: [],
  activeId: null,
  stress: 0,         // 0..100
  resolved: 0,
  totalChars: 0,
  correctChars: 0,
  totalTimeMs: 0,
  startedAt: 0,      // session start
  typingStart: 0,    // per-email
  diffKey: 'manager',
  lenient: true,
  spawnTimer: null,
  rafId: 0
};

const rnd = (min,max)=>Math.floor(Math.random()*(max-min+1))+min;
const now = ()=>performance.now();

// Load seed emails
async function loadPool(){
  const res = await fetch('assets/typea-emails.json', { cache:'no-store' });
  emailsPool = await res.json();
}

// Spawn a new email from pool with difficulty timers
function spawnEmail(){
  if (!emailsPool.length) return;
  const { dueRange, queueMax } = DIFF[state.diffKey];
  if (state.queue.length >= queueMax) return;

  const src = emailsPool[rnd(0, emailsPool.length-1)];
  const id = `${src.id}-${Math.random().toString(36).slice(2,7)}`;
  const dueMs = rnd(dueRange[0], dueRange[1]);
  const dueAt = now() + dueMs;
  const email = {
    id, sender: src.sender, subject: src.subject,
    urgency: src.urgency || 'normal',
    body: src.bodyTarget,
    dueAt, dueMs,
    typed: '',
    startedTypingAt: 0
  };
  state.queue.push(email);
  if (!state.activeId) selectEmail(email.id);
  renderInbox();
}

// Master spawn loop
function scheduleSpawns(){
  clearTimeout(state.spawnTimer);
  const [a,b] = DIFF[state.diffKey].spawnMs;
  const delay = rnd(a,b);
  state.spawnTimer = setTimeout(()=>{ spawnEmail(); scheduleSpawns(); }, delay);
}

// Select an email by id
function selectEmail(id){
  const e = state.queue.find(x=>x.id===id);
  state.activeId = id;
  if (e && !e.startedTypingAt) e.startedTypingAt = now();
  elSender.textContent = e ? e.sender : '—';
  elSubject.textContent = e ? e.subject : 'Select an email';
  elUrg.textContent = e ? (e.urgency[0].toUpperCase()+e.urgency.slice(1)) : '';
  elUrg.className = 'badge ' + (e ? (e.urgency==='urgent'?'urgent':e.urgency==='low'?'low':'') : '');
  elGhost.textContent = e ? e.body : '';
  elInput.value = e ? e.typed : '';
  paintMask();
  renderInbox();
}

function active(){
  return state.queue.find(x=>x.id===state.activeId) || null;
}

// Re-render inbox list & timers
function renderInbox(){
  const items = state.queue
    .map((e,i)=>{
      const rem = Math.max(0, e.dueAt - now());
      const p = Math.max(0, 1 - rem / e.dueMs); // 0..1 elapsed
      const pct = Math.floor(p*100);
      const ringColor = e.urgency==='urgent' ? '#e53935' : (e.urgency==='low' ? '#2f9e44' : '#f7b500');
      const timeLeft = Math.ceil(rem/1000);
      const activeCls = e.id===state.activeId ? ' active' : '';
      return `
        <div class="email${activeCls}" data-id="${e.id}">
          <div class="ring" style="--p:${pct};--ring-color:${ringColor}"><span>${timeLeft}</span></div>
          <div style="flex:1;min-width:0">
            <div class="sender">${e.sender}</div>
            <div class="subject ellipsis">${e.subject}</div>
          </div>
          <span class="badge ${e.urgency==='urgent'?'urgent':e.urgency==='low'?'low':''}">${e.urgency}</span>
        </div>`;
    }).join('');
  elInbox.innerHTML = items || `<div class="email" style="justify-content:center;color:#666">Inbox zero — nice.</div>`;
}

// Paint the typed mask (correct/err highlights) & live stats
function paintMask(){
  const e = active(); if (!e) { elMask.innerHTML=''; return; }
  const t = e.typed || '';
  const target = e.body;
  // compute highlights
  let html = '';
  let correct = 0;
  for (let i=0;i<target.length;i++){
    const ch = target[i];
    const typedCh = t[i];
    if (typedCh == null){
      html += '<span>' + escapeHtml(ch) + '</span>';
    } else if (typedCh === ch){
      html += '<span class="ok">' + escapeHtml(ch) + '</span>';
      correct++;
    } else {
      html += '<span class="err">' + escapeHtml(ch) + '</span>';
    }
  }
  elMask.innerHTML = html;
  // live WPM/accuracy
  const elapsedMs = Math.max(1, now() - (e.startedTypingAt || now()));
  const wpm = ((t.length/5) / (elapsedMs/60000)) || 0;
  const acc = target.length ? (correct/target.length)*100 : 100;
  elWpm.textContent = Math.round(wpm);
  elAcc.textContent = Math.max(0, Math.min(100, Math.round(acc))) + '%';
}

function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Input handling
elInput.addEventListener('input', ()=>{
  const e = active(); if (!e) return;
  e.typed = elInput.value;
  paintMask();
});

function trySend(exactOnly=false){
  const e = active(); if (!e) return;
  const t = e.typed || '';
  const target = e.body;
  const exact = t === target;
  const correct = [...t].reduce((acc,ch,i)=> acc + (target[i]===ch?1:0), 0);
  const acc = target.length ? correct/target.length : 1;
  const elapsed = Math.max(1, now() - (e.startedTypingAt || now()));

  if (exact || (!exactOnly && state.lenient && acc >= 0.95 && t.length >= target.length*0.95)){
    // success
    state.resolved++;
    state.totalChars += target.length;
    state.correctChars += Math.round(target.length * acc);
    state.totalTimeMs += elapsed;
    bumpStress(-8);
    removeEmail(e.id);
    selectNext();
  } else {
    // small nudge: flash textarea border?
    elInput.style.borderColor = '#ef476f';
    setTimeout(()=>elInput.style.borderColor='#e0e0e0', 150);
  }
  updateHud();
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

// Timers & escalation
function tick(){
  const t = now();
  // expire
  for (let i=state.queue.length-1; i>=0; i--){
    const e = state.queue[i];
    if (t >= e.dueAt){
      // Missed → escalate
      bumpStress(15);
      state.queue.splice(i,1);
      if (e.id === state.activeId) state.activeId = null;
    }
  }
  if (state.stress >= 100){
    endGame();
    return;
  }
  renderInbox();
  state.rafId = requestAnimationFrame(tick);
}

function bumpStress(delta){
  state.stress = Math.max(0, Math.min(100, state.stress + delta));
  elStress.style.width = state.stress + '%';
}

function endGame(){
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.spawnTimer);
  // Session stats
  const avgWpm = state.totalTimeMs ? Math.round(((state.totalChars/5)/(state.totalTimeMs/60000))) : 0;
  const accPct = state.totalChars ? Math.round((state.correctChars/state.totalChars)*100) : 100;
  ovWpm.textContent = avgWpm;
  ovAcc.textContent = accPct + '%';
  ovDone.textContent = state.resolved;
  overlay.classList.add('active');
}

function updateHud(){
  // already updated per keystroke; keep for future extensibility
}

// Keyboard controls
window.addEventListener('keydown', (e)=>{
  // numbers 1–6 pick slot
  if (e.key >= '1' && e.key <= '6'){
    const idx = Number(e.key)-1;
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

// Click select
elInbox.addEventListener('click', (e)=>{
  const item = e.target.closest('.email');
  if (!item) return;
  selectEmail(item.dataset.id);
  elInput.focus();
});

// Controls
$('difficulty').addEventListener('change', (e)=>{
  state.diffKey = e.target.value;
});
$('lenient').addEventListener('change', (e)=>{
  state.lenient = e.target.checked;
});
$('restart').addEventListener('click', startGame);
$('overlayRestart').addEventListener('click', ()=>{ overlay.classList.remove('active'); startGame(); });

// Start/restart
async function startGame(){
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.spawnTimer);
  if (!emailsPool.length) await loadPool();

  state.queue = [];
  state.activeId = null;
  state.stress = 0;
  state.resolved = 0;
  state.totalChars = 0;
  state.correctChars = 0;
  state.totalTimeMs = 0;
  state.startedAt = now();
  elStress.style.width = '0%';
  elDone.textContent = '0';
  elWpm.textContent = '0';
  elAcc.textContent = '100%';
  overlay.classList.remove('active');

  // seed a few messages
  spawnEmail(); spawnEmail(); spawnEmail();
  renderInbox();
  scheduleSpawns();
  state.rafId = requestAnimationFrame(tick);
  elInput.value = '';
  elInput.focus();
}

// Kick off
startGame();
