// Type A — calibration, intro, day stats, power-ups, delegation, streak economy, tooltips, toasts
const $ = (id) => document.getElementById(id);
const elInbox = $('inbox'), elGhost = $('ghost'), elInput = $('input');
const elSender = $('metaSender'), elSubject = $('metaSubject'), elUrg = $('metaUrgency');
const elWpm = $('wpm'), elAcc = $('acc'), elDone = $('done'), elStress = $('stressBar');
const overlay = $('overlay'), ovWpm = $('ovWpm'), ovAcc = $('ovAcc'), ovDone = $('ovDone');
const btnOverlayRestart = $('overlayRestart');
const powerEnabled = () => state.day > 1; // disabled in Orientation (Day 1)

const DIFF = {
  intern:  { spawnMs:[9000,14000], targetWPM:35, queueMax:4, baseDayGoal:10 },
  manager: { spawnMs:[7000,12000], targetWPM:55, queueMax:5, baseDayGoal:14 },
  director:{ spawnMs:[5500,10000], targetWPM:75, queueMax:6, baseDayGoal:18 }
};

let emailsPool = [];
let bag = [];
let firstLaunchShown = false;

let state = {
  queue: [],
  activeId: null,
  stress: 0,
  resolved: 0, resolvedToday: 0,
  totalChars: 0, correctChars: 0, totalTimeMs: 0,
  dayChars: 0, dayCorrectChars: 0, dayTimeMs: 0,

  diffKey: 'intern',
  lenient: true,
  day: 1,
  spawnTimer: null, rafId: 0,

  // power-ups
  power: { auto: 2, oof: 2 }, // refilled each day
  selectingDelegate: false,

  // streak economy
  streak: 0,
  streakMilestone: 0,
  awardFlip: 0,
  justAuto: false,

  // staff
  staff: [] // {id,name,wpm,taskId:null,progress:0,assignedAt:0}
};

const STAFF_NAMES = ['Ava','Ben','Cara','Diego','Elle','Finn','Gus','Hana'];
const rnd = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const now = ()=>performance.now();

/* ---------- Toasts ---------- */
function ensureToastContainer(){
  if (document.getElementById('toasts')) return;
  const box = document.createElement('div');
  box.id = 'toasts';
  box.className = 'toasts';
  document.body.appendChild(box);
}
function showToast(msg){
  ensureToastContainer();
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  document.getElementById('toasts').appendChild(d);
  requestAnimationFrame(()=>d.classList.add('in'));
  setTimeout(()=>d.classList.remove('in'), 2200);
  setTimeout(()=>d.remove(), 2600);
}

/* ---------- HUD / power bar ---------- */
function ensureHudBits(){
  const hud = document.querySelector('.hud');
  if (!hud) return {};

  // Left-today pill
  let left = document.getElementById('leftToday');
  if (!left) {
    left = document.createElement('span');
    left.className = 'pill';
    left.id = 'leftToday';
    hud.insertBefore(left, elStress?.parentElement || null);
  }
  // Calibration badge
  let cal = document.getElementById('calBadge');
  if (!cal) {
    cal = document.createElement('span');
    cal.className = 'pill pill--cal';
    cal.id = 'calBadge';
    hud.insertBefore(cal, left);
  }
  // Streak pill
  let streak = document.getElementById('streakPill');
  if (!streak){
    streak = document.createElement('span');
    streak.className = 'pill pill--streak';
    streak.id = 'streakPill';
    streak.setAttribute('data-tip','Earn a charge every 3 exact sends (no Auto/OOF/delegation)');
    hud.insertBefore(streak, left);
  }
  // Power bar
  let pbar = document.getElementById('powerBar');
  if (!pbar) {
    pbar = document.createElement('div');
    pbar.id = 'powerBar';
    pbar.className = 'powerbar';
    pbar.innerHTML = `
      <button id="pAuto" class="btn btn-sm has-tip" data-tip="Finish current email · Shortcut: F7">
        Auto-complete <span id="pAutoC" class="count"></span>
      </button>
      <button id="pDel" class="btn btn-sm has-tip" data-tip="Toggle delegate mode · Shortcut: F9">
        Delegate
      </button>
      <button id="pOof" class="btn btn-sm has-tip" data-tip="+45s to deadline · Shortcut: F8">
        Send OOF <span id="pOofC" class="count"></span>
      </button>`;
    hud.appendChild(pbar);
  }
  // Staff row
  let srow = document.getElementById('staffRow');
  if (!srow) {
    srow = document.createElement('div');
    srow.id = 'staffRow';
    srow.className = 'staffrow';
    elInbox?.parentElement?.appendChild(srow);
  }
  return { left, cal, streak, pbar, srow };
}
function dayGoalFor(){ return state.day===1 ? 5 : (DIFF[state.diffKey].baseDayGoal + Math.max(0, state.day-2)); }
function updatePills(){
  const { left, cal, streak } = ensureHudBits();
  if (left) left.textContent = `Left today: ${Math.max(0, dayGoalFor() - state.resolvedToday)}`;
  if (cal) { cal.hidden = state.day !== 1; cal.textContent = 'New-Hire Orientation'; }
  if (streak) { streak.textContent = `Streak: ${state.streak}`; }
}
function renderPowerBar(){
  ensureHudBits();
  const bar = document.getElementById('powerBar');
  if (!bar) return;
  bar.style.display = powerEnabled() ? '' : 'none';
  if (!powerEnabled()) return;
  const autoC = $('pAutoC'), oofC = $('pOofC'), btnAuto = $('pAuto'), btnOof = $('pOof'), btnDel = $('pDel');
  if (autoC) autoC.textContent = `x${state.power.auto}`;
  if (oofC)  oofC.textContent  = `x${state.power.oof}`;
  if (btnAuto) btnAuto.disabled = state.power.auto<=0 || !active() || isDelegated(active());
  if (btnOof)  btnOof.disabled  = state.power.oof<=0  || !active();
  if (btnDel)  btnDel.classList.toggle('active', state.selectingDelegate);
}

/* ---------- Intro overlay ---------- */
function ensureIntro(){
  if (document.getElementById('introOverlay')) return;
  const div = document.createElement('div');
  div.id = 'introOverlay';
  div.className = 'intro-overlay';
  div.innerHTML = `
    <div class="intro-card">
      <h3>Welcome to the job 👋</h3>
      <p>You’ve always been a go-getter. Today you’re stepping into an office manager role. First up: <strong>New-Hire Orientation</strong> — long timers, no failing. We’ll use it to gauge your baseline. After that, your workload scales to your speed.</p>
      <div class="intro-grid">
        <div>
          <h4>Controls</h4>
          <ul>
            <li><strong>F1–F6</strong>: select email</li>
            <li><strong>Tab</strong>/<strong>Shift+Tab</strong>: next/prev email</li>
            <li><strong>Enter</strong>: send (exact)</li>
            <li><strong>Ctrl/Cmd+Enter</strong>: send (lenient)</li>
            <li><strong>F7 / F8 / F9</strong>: Auto / OOF / Delegate</li>
          </ul>
        </div>
        <div>
          <h4>Power-ups</h4>
          <ul>
            <li><strong>Auto-complete</strong>: finishes current email</li>
            <li><strong>Delegate</strong>: assign to a teammate (they type at their WPM)</li>
            <li><strong>Send OOF</strong>: +45s to the deadline</li>
            <li><strong>Streaks</strong>: every 3 exact sends earns a charge (alternates Auto ↔ OOF)</li>
          </ul>
        </div>
      </div>
      <button id="introStart" class="btn">Start Orientation</button>
    </div>`;
  document.body.appendChild(div);
  $('introStart')?.addEventListener('click', ()=>{
    div.classList.remove('active');
    startLoops(); elInput?.focus();
  });
}

/* ---------- Data ---------- */
async function loadPool(){
  const res = await fetch('assets/typea-emails.json', { cache:'no-store' });
  emailsPool = await res.json();
  refillBag();
}
function refillBag(){
  bag = [...Array(emailsPool.length).keys()];
  for (let i=bag.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [bag[i],bag[j]]=[bag[j],bag[i]]; }
}

/* ---------- Normalize ---------- */
function normChar(ch){
  const map={'“':'"','”':'"','„':'"','‟':'"','«':'"','»':'"','‘':"'",'’':"'",'‚':"'",'‛':"'",'–':'-','—':'-','−':'-','\u00A0':' ','\u2009':' ','\u200A':' ','\u2002':' ','\u2003':' ','\u2006':' '};
  return map[ch] || ch;
}
function normalizeStr(s){ return [...(s||'')].map(normChar).join(''); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* ---------- Deadlines & spawns ---------- */
function deadlineMsFor(bodyLen){
  if (state.day===1) return 10*60*1000; // Orientation can't fail
  const words = bodyLen/5;
  const dayFactor = state.day===2?0.9:(state.day===3?1.0:1.07+0.02*(state.day-4));
  const target = Math.max(20, Math.round(DIFF[state.diffKey].targetWPM * dayFactor));
  let ms = (words/target)*60000; ms *= rnd(108,125)/100;
  return Math.max(15000, Math.min(ms, 90000));
}
function spawnEmail(){
  if (!emailsPool.length) return;
  const { queueMax } = DIFF[state.diffKey];
  if (state.queue.length >= queueMax) return;
  if (!bag.length) refillBag();
  const idx = bag.pop();
  const src = emailsPool[idx];
  const dueMs = deadlineMsFor(src.bodyTarget.length);
  const dueAt = now()+dueMs;
  const email={ id:`${src.id}-${Math.random().toString(36).slice(2,7)}`, sender:src.sender, subject:src.subject,
    baseUrgency:src.urgency||'normal', body:src.bodyTarget, dueAt, dueMs, typed:'', firstKeyAt:0, delegatedTo:null, usedOOF:0 };
  state.queue.push(email);
  if (!state.activeId) selectEmail(email.id);
  renderInbox();
}
function scheduleSpawns(initial=false){
  clearTimeout(state.spawnTimer);
  const [a,b] = DIFF[state.diffKey].spawnMs;
  const delay = initial ? rnd(a+1500,b+2500) : rnd(a,b);
  state.spawnTimer = setTimeout(()=>{ spawnEmail(); scheduleSpawns(); }, delay);
}

/* ---------- Urgency ---------- */
function urgencyFromRemaining(rem,dueMs){
  const r=Math.max(0,rem)/Math.max(1,dueMs);
  if (r<=0.25) return 'urgent';
  if (r<=0.60) return 'normal';
  return 'low';
}
function ringColorFor(u){ return u==='urgent'?'#e53935':(u==='low'?'#2f9e44':'#f7b500'); }
function setMetaUrg(u){
  if (!elUrg) return;
  elUrg.textContent=u[0].toUpperCase()+u.slice(1);
  elUrg.className='badge '+(u==='urgent'?'urgent':(u==='low'?'low':''));
}

/* ---------- Staff ---------- */
function cryptoRandomId(){ return Math.random().toString(36).slice(2,9); }
function unlockStaffForDay(){
  if (state.day < 2) return; // none in Orientation
  const targetCount = Math.min(5, state.day - 1); // Day2=1, Day3=2, ...
  while (state.staff.length < targetCount){
    const name = STAFF_NAMES[state.staff.length % STAFF_NAMES.length];
    const baseWpm = 35 + state.staff.length*8;
    const st = { id:cryptoRandomId(), name, wpm:baseWpm, taskId:null, progress:0, assignedAt:0 };
    state.staff.push(st);
    showToast(`Teammate unlocked: ${st.name} · ${st.wpm} WPM`);
  }
}
function isDelegated(e){ return !!e?.delegatedTo; }
function renderStaff(){
  const { srow } = ensureHudBits();
  if (!srow) return;
  srow.style.display = powerEnabled() ? '' : 'none';
  if (!powerEnabled()) return;
  srow.innerHTML = state.staff.map(st=>{
    const working = !!st.taskId;
    const task = state.queue.find(x=>x.id===st.taskId);
    const pct = task ? Math.min(100, Math.floor((st.progress/(task.body.length||1))*100)) : 0;
    return `<div class="staff ${working?'busy':''} has-tip" data-id="${st.id}" data-tip="${working?'Working…':'Click Assign to delegate current email'}">
      <div class="name">${st.name}</div>
      <div class="meta">${st.wpm} WPM ${working?`· ${pct}%`:''}</div>
      <button class="sAssign btn btn-xs" ${working?'disabled':''}>${working?'Working…':'Assign'}</button>
    </div>`;
  }).join('');
}
function delegateTo(staffId, emailId){
  const st = state.staff.find(s=>s.id===staffId); if (!st || st.taskId) return;
  const e = state.queue.find(x=>x.id===emailId); if (!e || isDelegated(e)) return;
  e.delegatedTo = staffId; st.taskId = emailId; st.progress = (e.typed||'').length; st.assignedAt = now();
  if (state.activeId===emailId && elInput) { elInput.value=''; elInput.placeholder=`Delegated to ${st.name} — working…`; }
  renderInbox(); renderStaff();
}

/* ---------- Selection & render ---------- */
function selectEmail(id){
  const e = state.queue.find(x=>x.id===id) || null;
  state.activeId = e ? e.id : null;
  if (elSender) elSender.textContent = e ? e.sender : '—';
  if (elSubject) elSubject.textContent = e ? e.subject : 'Select an email';
  if (elInput){
    elInput.disabled = e && isDelegated(e);
    elInput.placeholder = e && isDelegated(e) ? 'Delegated — you cannot type this.' : '';
    elInput.value = e ? (e.typed||'') : '';
  }
  paintLine(e);
  if (e){ const rem=Math.max(0,e.dueAt-now()); setMetaUrg(urgencyFromRemaining(rem,e.dueMs)); }
  else if (elUrg){ elUrg.textContent=''; elUrg.className='badge'; }
  renderInbox(); renderPowerBar();
}
function active(){ return state.queue.find(x=>x.id===state.activeId)||null; }
function requiredWpmFor(e){
  if (isDelegated(e)) return 0;
  const rem = Math.max(1, e.dueAt-now());
  const remainingChars = Math.max(0, e.body.length - (e.typed||'').length);
  const req = ((remainingChars/5) / (rem/60000));
  return Math.max(0, Math.round(req/5)*5);
}
function renderInbox(){
  if (!elInbox) return;
  const items = state.queue.map((e)=>{
    const rem = Math.max(0, e.dueAt-now());
    const pct = Math.floor(Math.max(0,1 - rem/e.dueMs)*100);
    const urg = urgencyFromRemaining(rem,e.dueMs);
    const ringColor = ringColorFor(urg);
    const timeLeft = Math.ceil(rem/1000);
    const activeCls = e.id===state.activeId ? ' active' : '';
    const who = e.delegatedTo ? state.staff.find(s=>s.id===e.delegatedTo)?.name : null;
    const tag = who
      ? ` <span class="delegated">→ ${who}</span>`
      : ` <span style="color:#7a7a7a;font-size:.8rem">· ~${requiredWpmFor(e)} WPM</span>`;
    if (e.id===state.activeId) setMetaUrg(urg);
    return `
      <div class="email${activeCls} has-tip" data-id="${e.id}" data-tip="Time left: ${timeLeft}s">
        <div class="ring" style="--p:${pct};--ring-color:${ringColor}"><span>${timeLeft}</span></div>
        <div style="flex:1;min-width:0">
          <div class="sender">${e.sender}</div>
          <div class="subject ellipsis">${e.subject}${tag}</div>
        </div>
        <span class="badge ${urg==='urgent'?'urgent':urg==='low'?'low':''}">${urg}</span>
      </div>`;
  }).join('');
  elInbox.innerHTML = items || `<div class="email" style="justify-content:center;color:#666">Inbox zero — nice.</div>`;
  updatePills(); renderPowerBar();
}
function paintLine(e){
  if (!elGhost) return;
  if (!e){ elGhost.innerHTML=''; return; }
  const t = e.typed||'', target = e.body;
  const n = Math.min(t.length, target.length);
  let correctSoFar=0, html='';
  for (let i=0;i<target.length;i++){
    if (i<n){
      const ok = normChar(t[i])===normChar(target[i]);
      if (ok) correctSoFar++;
      html += `<span class="${ok?'ok':'err'}">${escapeHtml(target[i])}</span>`;
    } else {
      html += `<span class="ghost">${escapeHtml(target[i])}</span>`;
    }
  }
  elGhost.innerHTML = html;
  if (!e.firstKeyAt || t.length===0){ if(elWpm) elWpm.textContent='0'; if(elAcc) elAcc.textContent='100%'; }
  else {
    const elapsed = Math.max(1, now()-e.firstKeyAt);
    const grossWpm = ((t.length/5)/(elapsed/60000))||0;
    if (elWpm) elWpm.textContent = Math.round(grossWpm);
    const acc = n ? (correctSoFar/n)*100 : 100;
    if (elAcc) elAcc.textContent = Math.round(Math.max(0, Math.min(100, acc)))+'%';
  }
}

/* ---------- Input & send ---------- */
elInput?.addEventListener('input', ()=>{
  const e=active(); if(!e||isDelegated(e)) return;
  if (!e.firstKeyAt && elInput.value.length>0) e.firstKeyAt = now();
  e.typed = elInput.value;
  paintLine(e);
});
function handleSuccess({ exact, viaAuto, viaOOF, delegated }){
  const qualifies = exact && !viaAuto && !viaOOF && !delegated;
  if (qualifies){
    state.streak++;
    const milestones = Math.floor(state.streak / 3);
    if (milestones > state.streakMilestone){
      state.streakMilestone = milestones;
      if (state.awardFlip % 2 === 0){
        state.power.auto = Math.min(5, state.power.auto + 1);
        showToast('Streak reward: +1 Auto-complete');
      } else {
        state.power.oof  = Math.min(5, state.power.oof  + 1);
        showToast('Streak reward: +1 Send OOF');
      }
      state.awardFlip++;
      renderPowerBar();
    }
  } else {
    state.streak = 0;
    state.streakMilestone = 0;
    state.awardFlip = state.awardFlip % 2;
  }
  updatePills();
}
function trySend(exactOnly=false){
  const e=active(); if(!e||isDelegated(e)) return;
  const t = e.typed||'', target=e.body;
  const tN = normalizeStr(t), tgtN = normalizeStr(target);

  const exact = (tN === tgtN);
  let correctCount = 0;
  for (let i=0;i<target.length;i++){
    const tc = tN[i] ?? '';
    const gc = tgtN[i] ?? '';
    if (tc === gc) correctCount++;
  }
  const accWhole = correctCount / target.length;
  const elapsed = e.firstKeyAt ? (now()-e.firstKeyAt) : 1;

  const ok = exact || (!exactOnly && state.lenient && accWhole >= 0.95);
  if (ok){
    state.resolved++; state.resolvedToday++;
    state.totalChars += target.length; state.correctChars += correctCount; state.totalTimeMs += elapsed;
    state.dayChars += target.length;   state.dayCorrectChars += correctCount; state.dayTimeMs += elapsed;

    bumpStress(-8);
    removeEmail(e.id);
    handleSuccess({ exact, viaAuto: state.justAuto, viaOOF: !!e.usedOOF, delegated:false });
    state.justAuto = false;

    checkDayProgress();
    selectNext();
  } else {
    if (elInput){ elInput.style.borderColor='#ef476f'; setTimeout(()=>elInput.style.borderColor='#e0e0e0',150); }
  }
}
function removeEmail(id){
  const idx=state.queue.findIndex(x=>x.id===id);
  if (idx>=0) state.queue.splice(idx,1);
  renderInbox();
}
function selectNext(dir=1){
  if (!state.queue.length){ state.activeId=null; renderInbox(); return; }
  const idx=Math.max(0,state.queue.findIndex(x=>x.id===state.activeId));
  const nextIdx=(idx+dir+state.queue.length)%state.queue.length;
  selectEmail(state.queue[nextIdx].id);
}

/* ---------- Power-ups ---------- */
function useAuto(){ if(!powerEnabled()) return;
  const e=active(); if(!e||isDelegated(e)||state.power.auto<=0) return;
  state.power.auto--;
  state.justAuto = true;
  e.typed = e.body;
  if(!e.firstKeyAt) e.firstKeyAt=now()-500;
  paintLine(e);
  trySend(true);
  renderPowerBar();
}
function useOOF(){ if(!powerEnabled()) return;
  const e=active(); if(!e||state.power.oof<=0) return;
  state.power.oof--;
  e.dueAt += 45000;
  e.usedOOF = (e.usedOOF||0) + 1;
  showToast('OOF sent: +45s');
  renderInbox(); renderPowerBar();
}
function beginDelegateMode(){ if(!powerEnabled()) return;
  state.selectingDelegate = !state.selectingDelegate;
  renderPowerBar(); renderStaff();
}
function onStaffClick(staffId){
  if (!state.selectingDelegate) return;
  const e=active(); if(!e) return;
  delegateTo(staffId, e.id);
  state.selectingDelegate=false; renderPowerBar();
}

/* ---------- Day progression ---------- */
function finishCalibration(){
  const personalWPM = state.dayTimeMs ? ((state.dayChars/5)/(state.dayTimeMs/60000)) : 50;
  const base = Math.max(25, Math.round(personalWPM*0.90));
  DIFF.intern.targetWPM  = Math.max(25, Math.round(base*0.80));
  DIFF.manager.targetWPM = Math.max(35, Math.round(base*1.00));
  DIFF.director.targetWPM= Math.max(45, Math.round(base*1.20));

  cancelAnimationFrame(state.rafId); clearTimeout(state.spawnTimer);
  const avgWpm = state.dayTimeMs ? Math.round(((state.dayChars/5)/(state.dayTimeMs/60000))) : 0;
  const accPct = state.dayChars ? Math.round((state.dayCorrectChars/state.dayChars)*100) : 100;
  $('overlay')?.querySelector('h3').textContent='Orientation complete ✅';
  $('overlay')?.querySelector('p').textContent=`Baseline ~${Math.round(personalWPM)} WPM. We’ll tailor your workload to match.`;
  if (ovWpm) ovWpm.textContent=avgWpm; if (ovAcc) ovAcc.textContent=accPct+'%'; if (ovDone) ovDone.textContent=state.resolved;
  btnOverlayRestart.textContent='Start Day 2';
  overlay?.classList.add('active');
}
function showDayComplete(){
  cancelAnimationFrame(state.rafId); clearTimeout(state.spawnTimer);
  const avgWpm = state.dayTimeMs ? Math.round(((state.dayChars/5)/(state.dayTimeMs/60000))) : 0;
  const accPct = state.dayChars ? Math.round((state.dayCorrectChars/state.dayChars)*100) : 100;
  $('overlay')?.querySelector('h3').textContent=`Day ${state.day} complete 🎯`;
  $('overlay')?.querySelector('p').textContent=`Nice work. You cleared ${dayGoalFor()} emails. Ready for tomorrow?`;
  if (ovWpm) ovWpm.textContent=avgWpm; if (ovAcc) ovAcc.textContent=accPct+'%'; if (ovDone) ovDone.textContent=state.resolved;
  btnOverlayRestart.textContent='Next Day';
  overlay?.classList.add('active');
}
function checkDayProgress(){
  if (state.resolvedToday >= dayGoalFor()){
    if (state.day===1) finishCalibration();
    else showDayComplete();
  }
}

/* ---------- Tick: timers + staff typing ---------- */
function tick(){
  const t=now();
  // Staff type
  for (const st of state.staff){
    if (!st.taskId) continue;
    const e = state.queue.find(x=>x.id===st.taskId);
    if (!e){ st.taskId=null; continue; }
    const cps = (st.wpm*5)/60;
    const dt = 1/60;
    st.progress = Math.min(e.body.length, st.progress + cps*dt);
    e.typed = e.body.slice(0, Math.floor(st.progress));
    if (!e.firstKeyAt) e.firstKeyAt = st.assignedAt;
    if (e.typed.length >= e.body.length){
      const elapsed = Math.max(1, t - e.firstKeyAt);
      state.resolved++; state.resolvedToday++;
      state.totalChars += e.body.length; state.correctChars += e.body.length; state.totalTimeMs += elapsed;
      state.dayChars += e.body.length;   state.dayCorrectChars += e.body.length; state.dayTimeMs += elapsed;
      bumpStress(-8);
      removeEmail(e.id);
      if (state.activeId===e.id) state.activeId=null;
      st.taskId=null; st.progress=0; st.assignedAt=0;
      state.streak = 0; state.streakMilestone = 0;
      updatePills();
      checkDayProgress();
    }
  }

  // Timers & expiries
  for (let i=state.queue.length-1;i>=0;i--){
    const e = state.queue[i];
    if (state.day===1){
      if (t>=e.dueAt) e.dueAt = t + 10*60*1000;
      continue;
    }
    if (t>=e.dueAt){
      bumpStress(15);
      const st = state.staff.find(s=>s.taskId===e.id);
      if (st){ st.taskId=null; st.progress=0; st.assignedAt=0; }
      state.queue.splice(i,1);
      if (e.id===state.activeId) state.activeId=null;
      state.streak = 0; state.streakMilestone = 0;
    }
  }
  if (state.stress>=100){ endGame(); return; }
  renderInbox(); renderStaff();
  state.rafId = requestAnimationFrame(tick);
}
function endGame(){
  cancelAnimationFrame(state.rafId); clearTimeout(state.spawnTimer);
  const avgWpm = state.dayTimeMs ? Math.round(((state.dayChars/5)/(state.dayTimeMs/60000))) : 0;
  const accPct = state.dayChars ? Math.round((state.dayCorrectChars/state.dayChars)*100) : 100;
  $('overlay')?.querySelector('h3').textContent='Burnout 💥';
  $('overlay')?.querySelector('p').textContent='You pushed it too hard. Take a breath and try again.';
  if (ovWpm) ovWpm.textContent=avgWpm; if (ovAcc) ovAcc.textContent=accPct+'%'; if (ovDone) ovDone.textContent=state.resolved;
  btnOverlayRestart.textContent='Restart';
  overlay?.classList.add('active');
}
function bumpStress(d){ state.stress=Math.max(0,Math.min(100,state.stress+d)); if (elStress) elStress.style.width=state.stress+'%'; }

/* ---------- Events ---------- */

// Keyboard: F-keys only for actions
window.addEventListener('keydown',(e)=>{
  // F1–F6: select email 1..6
  if (/^F[1-6]$/.test(e.key)){
    const idx = Number(e.key.slice(1)) - 1;
    if (state.queue[idx]){ selectEmail(state.queue[idx].id); e.preventDefault(); }
    return;
  }
  // Tab navigation
  if (e.key === 'Tab'){ e.preventDefault(); selectNext(e.shiftKey?-1:1); return; }
  // Send
  if (e.key === 'Enter'){ if (e.ctrlKey||e.metaKey) trySend(false); else trySend(true); e.preventDefault(); return; }
  // F7/F8/F9 = Auto / OOF / Delegate  (only after Orientation)
  if (e.key === 'F7'){ e.preventDefault(); if (powerEnabled()) useAuto(); return; }
  if (e.key === 'F8'){ e.preventDefault(); if (powerEnabled()) useOOF();  return; }
  if (e.key === 'F9'){ e.preventDefault(); if (powerEnabled()) beginDelegateMode(); return; }
});

// Inbox click: normal select, or delegate-to-first-free if in delegate mode
elInbox?.addEventListener('click',(e)=>{
  const it = e.target.closest('.email');
  if (!it) return;
  if (state.selectingDelegate && powerEnabled()){
    const free = state.staff.find(s => !s.taskId);
    if (free){
      delegateTo(free.id, it.dataset.id);
      state.selectingDelegate = false;
      renderPowerBar();
      showToast(`Delegated to ${free.name}`);
      e.preventDefault();
      return;
    }
    state.selectingDelegate = false; renderPowerBar();
  }
  selectEmail(it.dataset.id);
  elInput?.focus();
});

// Power buttons
document.addEventListener('click',(e)=>{ const btn = e.target.closest('#pAuto'); if(btn){ useAuto(); }});
document.addEventListener('click',(e)=>{ const btn = e.target.closest('#pOof');  if(btn){ useOOF();  }});
document.addEventListener('click',(e)=>{ const btn = e.target.closest('#pDel');  if(btn){ beginDelegateMode(); }});
// Staff assign
document.addEventListener('click',(e)=>{
  const b = e.target.closest('.sAssign'); if(!b) return;
  const card = e.target.closest('.staff'); if(!card) return;
  onStaffClick(card.dataset.id);
});

// Optional controls (guarded if not present)
$('difficulty')?.addEventListener('change',(e)=>{ state.diffKey=e.target.value; });
$('lenient')?.addEventListener('change',(e)=>{ state.lenient=e.target.checked; });
$('restart')?.addEventListener('click', startGame);

btnOverlayRestart?.addEventListener('click', ()=>{
  overlay?.classList.remove('active');
  if (btnOverlayRestart.textContent.includes('Restart')) { startGame(); return; }
  // Next Day
  state.day++; state.resolvedToday=0; state.dayChars=0; state.dayCorrectChars=0; state.dayTimeMs=0;
  state.queue.length=0; state.activeId=null;
  state.streak=0; state.streakMilestone=0;
  state.power = { auto: 2, oof: 2 };
  unlockStaffForDay();
  renderStaff(); renderPowerBar();
  spawnEmail(); startLoops(true);
});

/* ---------- Start / reset ---------- */
async function startGame(){
  cancelAnimationFrame(state.rafId); clearTimeout(state.spawnTimer);
  if (!emailsPool.length) await loadPool();
  state.queue=[]; state.activeId=null; state.stress=0;
  state.resolved=0; state.resolvedToday=0;
  state.totalChars=0; state.correctChars=0; state.totalTimeMs=0;
  state.dayChars=0; state.dayCorrectChars=0; state.dayTimeMs=0;
  state.day=1; state.power={auto:2,oof:2}; state.staff=[];
  state.streak=0; state.streakMilestone=0; state.awardFlip=0; state.justAuto=false;
  DIFF.intern.targetWPM=35; DIFF.manager.targetWPM=55; DIFF.director.targetWPM=75;

  if (elStress) elStress.style.width='0%';
  if (elDone) elDone.textContent='0';
  if (elWpm)  elWpm.textContent='0';
  if (elAcc)  elAcc.textContent='100%';
  overlay?.classList.remove('active');
  const dd=$('difficulty'); if (dd) dd.value='intern';

  ensureHudBits(); renderStaff(); renderPowerBar();
  spawnEmail(); spawnEmail();
  renderInbox(); updatePills(); ensureIntro();
  if (!firstLaunchShown){ document.getElementById('introOverlay')?.classList.add('active'); firstLaunchShown=true; }
  if (elInput){ elInput.value=''; elInput.disabled=false; elInput.placeholder=''; }
}
function startLoops(initial=false){
  renderInbox(); updatePills();
  scheduleSpawns(initial);
  cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(tick);
}

startGame();
