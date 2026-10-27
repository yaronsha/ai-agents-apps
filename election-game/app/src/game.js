// עגבנייה בקלפי: a quote appears, throw a tomato at whoever said it.
// One throw at a politician per quote: right +100, wrong -50. Misses on the background only cost accuracy.
(() => {
  'use strict';

  const QUOTES_PER_ROUND = 10;
  const MAX_PER_SPEAKER = 2;
  const LEVELS = {
    easy: { seconds: 12, upMs: [1900, 2700], maxUp: 3, decoys: 4, minLevel: 2 },
    hard: { seconds: 9, upMs: [1300, 2000], maxUp: 3, decoys: 6, minLevel: 1 },
  };
  const SCENES = ['plenum', 'outside'];
  const SPLAT_PATH = 'M45 8 C57 3 61 18 73 15 C86 13 84 30 78 36 C88 44 81 58 70 56 C67 68 54 66 50 59 C40 70 27 62 31 51 C18 53 14 38 24 33 C16 24 27 12 37 18 C39 10 40 9 45 8 Z';
  const TOMATO_SVG = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><circle cx="12" cy="14" r="8.5" fill="#E5482E"/><circle cx="9" cy="11" r="2.2" fill="#FF8A70" opacity=".8"/><path d="M8 6.5 L12 8 L16 6.5 L14 9.5 L12 8.5 L10 9.5 Z" fill="#3C9A4E"/></svg>';
  const SPEAKER_ON = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F4EFE6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9 L8 9 L13 5 L13 19 L8 15 L4 15 Z"/><path d="M16.5 8.5 C18 10 18 14 16.5 15.5"/></svg>';
  const SPEAKER_OFF = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F4EFE6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9 L8 9 L13 5 L13 19 L8 15 L4 15 Z"/><path d="M17 9 L22 14 M22 9 L17 14"/></svg>';

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fmt = (n) => n.toLocaleString('he-IL');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('eg.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('eg.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------- data ----------
  let CAST = {};      // id -> Hebrew name
  let QUOTES = [];
  let SPOTS = null;   // scenes/spots.json

  const app = {
    level: store.get('level', 'easy'),
    muted: store.get('muted', false),
    roundNo: Math.floor(Math.random() * 2),
    seen: new Set(),
    round: null,
  };

  // ---------- screens ----------
  const screens = ['home', 'play', 'end', 'poll'];
  function show(name) {
    for (const s of screens) $(s).hidden = s !== name;
    if (name === 'play') requestAnimationFrame(fitStage);
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    const where = go.dataset.go;
    if (where === 'start') startRound();
    else if (where === 'poll') openPoll();
    else { stopRound(); show(where); renderBest(); }
  });

  // ---------- home ----------
  function renderLevel() {
    document.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === app.level)));
  }
  document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    app.level = b.dataset.level;
    store.set('level', app.level);
    renderLevel();
  }));
  function renderBest() {
    const best = store.get('best', null);
    const el = $('best');
    if (best === null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = 'השיא שלכם: ' + fmt(best);
  }
  $('start').addEventListener('click', () => { unlockAudio(); startRound(); });

  // ---------- sound ----------
  let actx = null;
  let clip = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch { actx = null; }
  }
  // A short filtered noise burst: the splat.
  function splatSound(strength = 1) {
    if (app.muted || !actx) return;
    const len = Math.floor(actx.sampleRate * 0.18);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + 500 * strength;
    const g = actx.createGain();
    g.gain.value = 0.55 * strength;
    src.connect(f).connect(g).connect(actx.destination);
    src.start();
  }
  function stopClip() {
    if (clip) { clip.pause(); clip = null; }
    $('playAudio').classList.remove('playing');
  }
  function playClip(q) {
    stopClip();
    if (!q || !q.audio || app.muted) return;
    clip = new Audio(q.audio);
    const btn = $('playAudio');
    btn.classList.add('playing');
    clip.addEventListener('ended', () => btn.classList.remove('playing'));
    clip.play().catch(() => btn.classList.remove('playing'));
  }
  function renderMute() {
    const b = $('mute');
    b.innerHTML = app.muted ? SPEAKER_OFF : SPEAKER_ON;
    b.setAttribute('aria-pressed', String(app.muted));
    b.setAttribute('aria-label', app.muted ? 'הפעלת קול' : 'השתקה');
  }
  $('mute').addEventListener('click', () => {
    app.muted = !app.muted;
    store.set('muted', app.muted);
    if (app.muted) stopClip();
    renderMute();
  });
  $('playAudio').addEventListener('click', () => {
    const r = app.round;
    if (!r || r.active) return;
    unlockAudio();
    if (app.muted) { app.muted = false; store.set('muted', false); renderMute(); }
    playClip(r.quotes[r.qi]);
  });

  // ---------- stage ----------
  const stage = $('stage');
  let spots = [];
  let sceneName = 'plenum';

  function fitStage() {
    const wrap = $('stageWrap');
    const k = Math.min(wrap.clientWidth / SPOTS.size.w, wrap.clientHeight / SPOTS.size.h, 1.3);
    stage.style.transform = `translateX(-50%) scale(${k})`;
    stage.dataset.k = k;
  }
  window.addEventListener('resize', () => { if (!$('play').hidden) fitStage(); });

  function buildScene(name) {
    sceneName = name;
    const sc = SPOTS.scenes[name];
    stage.className = 'stage ' + name;
    stage.innerHTML = '';
    const bg = new Image();
    bg.src = 'scenes/' + sc.background;
    bg.alt = '';
    bg.className = 'layer';
    bg.style.cssText = 'left:0;top:0;width:100%;height:100%';
    stage.append(bg);
    for (const f of sc.foreground) {
      const img = new Image();
      img.src = 'scenes/' + f.file;
      img.alt = '';
      img.className = 'layer';
      img.style.left = f.x + 'px';
      img.style.top = f.y + 'px';
      stage.append(img);
    }
    spots = sc.spots.map((sp) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spot';
      btn.style.cssText = `left:${sp.x}px;top:${sp.y}px;width:${sp.w}px;height:${sp.h}px`;
      btn.tabIndex = -1;
      const clipBox = document.createElement('div');
      clipBox.className = 'clip';
      const face = document.createElement('div');
      face.className = 'face';
      const s = sp.scale;
      const sink = sp.sink || 0;
      face.style.bottom = -sink + 'px';
      face.style.setProperty('--s', s);
      face.style.setProperty('--hide', Math.ceil(150 * s + 8) + 'px');
      const img = new Image();
      img.alt = '';
      img.draggable = false;
      face.append(img);
      clipBox.append(face);
      const plate = document.createElement('span');
      plate.className = 'plate';
      btn.append(clipBox, plate);
      stage.append(btn);
      const spot = { def: sp, btn, img, plate, who: null, timer: 0 };
      btn.addEventListener('click', (e) => { e.stopPropagation(); throwAt(spot, e); });
      return spot;
    });
  }

  function popUp(spot, who, ms) {
    clearTimeout(spot.timer);
    spot.who = who;
    spot.img.src = `assets/ai/${who}-idle.webp`;
    spot.plate.textContent = CAST[who];
    spot.btn.setAttribute('aria-label', 'לזרוק עגבנייה על ' + CAST[who]);
    spot.btn.tabIndex = 0;
    spot.btn.classList.toggle('named', app.level === 'easy');
    spot.btn.classList.remove('hit', 'ring', 'reveal', 'frozen');
    // Restart the rise from hidden even if it was mid-hide.
    void spot.btn.offsetWidth;
    spot.btn.classList.add('up');
    if (ms) spot.timer = setTimeout(() => hide(spot), ms);
  }
  function hide(spot) {
    clearTimeout(spot.timer);
    spot.btn.classList.remove('up');
    spot.btn.tabIndex = -1;
    spot.btn.removeAttribute('aria-label');
    // Free the spot after the slide down.
    spot.timer = setTimeout(() => { spot.who = null; }, 220);
  }
  function clearSpots() {
    for (const s of spots) {
      clearTimeout(s.timer);
      s.who = null;
      s.btn.className = 'spot';
      s.btn.tabIndex = -1;
    }
    stage.querySelectorAll('.miss-splat, .thrown').forEach((n) => n.remove());
  }

  // ---------- round ----------
  function chooseQuotes(level) {
    const min = LEVELS[level].minLevel;
    let pool = QUOTES.filter((q) => q.level >= min && !app.seen.has(q.id));
    if (pool.length < QUOTES_PER_ROUND * 2) {
      app.seen.clear();
      pool = QUOTES.filter((q) => q.level >= min);
    }
    const out = [];
    const per = {};
    for (const q of shuffle(pool)) {
      if ((per[q.speaker] || 0) >= MAX_PER_SPEAKER) continue;
      // Avoid the same speaker twice in a row.
      if (out.length && out[out.length - 1].speaker === q.speaker) continue;
      per[q.speaker] = (per[q.speaker] || 0) + 1;
      out.push(q);
      if (out.length === QUOTES_PER_ROUND) break;
    }
    out.forEach((q) => app.seen.add(q.id));
    return out;
  }

  function startRound() {
    stopRound();
    const quotes = chooseQuotes(app.level);
    app.roundNo += 1;
    app.round = {
      quotes, qi: 0, score: 0, streak: 0, bestStreak: 0, correct: 0, throws: 0, hits: {},
      pairs: {}, gotYou: null, active: false, tick: 0, clock: 0,
    };
    buildScene(SCENES[app.roundNo % 2]);
    show('play');
    renderMute();
    $('score').textContent = '0';
    startQuote();
  }

  function stopRound() {
    const r = app.round;
    if (r) { clearInterval(r.tick); clearInterval(r.clock); r.active = false; }
    stopClip();
    clearSpots();
    $('toast').hidden = true;
  }

  function quoteSizeClass(text) {
    if (text.length > 70) return 'quote xlong';
    if (text.length > 38) return 'quote long';
    return 'quote';
  }

  function startQuote() {
    const r = app.round;
    const q = r.quotes[r.qi];
    const cfg = LEVELS[app.level];
    clearSpots();
    $('toast').hidden = true;
    $('qcount').textContent = `ציטוט ${r.qi + 1} מתוך ${r.quotes.length}`;
    const qEl = $('quote');
    qEl.textContent = '״' + q.text + '״';
    qEl.className = quoteSizeClass(q.text);
    $('ammo').textContent = '× ' + (r.quotes.length - r.qi);
    // The voice gives the answer away, so the clip waits until the player has thrown.
    $('playAudio').hidden = true;
    $('hint').textContent = 'הם צצים ונעלמים. תפסו את מי שאמר!';

    // Decoys: people you could mix this quote up with first, then anyone else.
    const others = Object.keys(CAST).filter((id) => id !== q.speaker);
    const confusable = shuffle((q.confusableWith || []).filter((id) => CAST[id] && id !== q.speaker));
    const rest = shuffle(others.filter((id) => !confusable.includes(id)));
    r.decoys = confusable.concat(rest).slice(0, cfg.decoys);
    r.target = q.speaker;
    r.lastTarget = performance.now() - 800;
    r.deadline = performance.now() + cfg.seconds * 1000;
    r.active = true;

    // Two up right away so the stage is never empty.
    pop(); pop();
    clearInterval(r.tick);
    r.tick = setInterval(pop, 330);
    clearInterval(r.clock);
    r.clock = setInterval(updateClock, 200);
    updateClock();
  }

  function pop() {
    const r = app.round;
    if (!r || !r.active) return;
    const cfg = LEVELS[app.level];
    const now = performance.now();
    const up = spots.filter((s) => s.who);
    const upWho = new Set(up.map((s) => s.who));
    if (upWho.has(r.target)) r.lastTarget = now;
    if (up.length >= cfg.maxUp) return;
    if (up.length > 0 && Math.random() < 0.35) return;
    const free = spots.filter((s) => !s.who);
    if (!free.length) return;
    let who;
    if (!upWho.has(r.target) && (now - r.lastTarget > 1500 || Math.random() < 0.4)) who = r.target;
    else {
      const choices = r.decoys.filter((id) => !upWho.has(id));
      if (!choices.length) return;
      who = pick(choices);
    }
    if (who === r.target) r.lastTarget = now;
    popUp(pick(free), who, rand(cfg.upMs[0], cfg.upMs[1]));
  }

  function updateClock() {
    const r = app.round;
    if (!r || !r.active) return;
    const left = Math.max(0, r.deadline - performance.now());
    const secs = Math.ceil(left / 1000);
    $('timer').textContent = '0:' + String(secs).padStart(2, '0');
    $('timer').parentElement.classList.toggle('low', secs <= 3);
    if (left <= 0) resolve(null);
  }

  // Tomato flight from the bottom middle of the stage to (x, y) in stage px.
  function fly(x, y) {
    const t = document.createElement('div');
    t.className = 'thrown';
    t.innerHTML = TOMATO_SVG;
    stage.append(t);
    const sx = SPOTS.size.w / 2, sy = SPOTS.size.h + 30;
    const mx = (sx + x) / 2, my = Math.min(sy, y) - 70;
    const dur = 260;
    const anim = t.animate([
      { transform: `translate(${sx}px, ${sy}px) scale(1.5) rotate(0deg)` },
      { transform: `translate(${mx}px, ${my}px) scale(1.1) rotate(200deg)`, offset: 0.5 },
      { transform: `translate(${x}px, ${y}px) scale(.8) rotate(380deg)` },
    ], { duration: dur, easing: 'ease-in' });
    return new Promise((done) => {
      const finish = () => { t.remove(); done(); };
      anim.onfinish = finish;
      setTimeout(finish, dur + 80);
    }).then(() => {});
  }

  function stagePoint(e) {
    const rect = stage.getBoundingClientRect();
    const k = parseFloat(stage.dataset.k) || 1;
    if (e && e.clientX) return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
    return null;
  }

  stage.addEventListener('click', async (e) => {
    const r = app.round;
    if (!r || !r.active || e.target.closest('.spot')) return;
    r.throws += 1;
    const p = stagePoint(e);
    if (!p) return;
    await fly(p.x, p.y);
    if (!r.active) return;
    splatSound(0.5);
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 90 70');
    s.setAttribute('class', 'miss-splat');
    s.setAttribute('aria-hidden', 'true');
    s.style.left = p.x + 'px';
    s.style.top = p.y + 'px';
    s.innerHTML = `<path d="${SPLAT_PATH}" fill="#E5482E" opacity=".85"/>`;
    stage.append(s);
    s.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 1200 }).onfinish = () => s.remove();
    $('hint').textContent = 'פספוס! זרקו על מישהו.';
  });

  async function throwAt(spot, e) {
    const r = app.round;
    if (!r || !r.active || !spot.who) return;
    const who = spot.who;
    r.active = false;
    r.throws += 1;
    clearInterval(r.tick);
    clearInterval(r.clock);
    // Freeze the one we aimed at; it stays up for the splat.
    clearTimeout(spot.timer);
    spot.btn.classList.add('up', 'frozen');
    // Start the clip here, inside the tap: mobile browsers block it once we've awaited the throw.
    playClip(r.quotes[r.qi]);
    const d = spot.def;
    const p = stagePoint(e);
    const tx = p ? p.x : d.x + d.w / 2;
    const ty = Math.min(p ? p.y : d.y + d.h * 0.4, d.y + d.h - 10);
    await fly(tx, ty);
    spot.img.src = `assets/ai/${who}-hit.webp`;
    spot.btn.classList.add('hit');
    splatSound(1);
    if (navigator.vibrate) navigator.vibrate(30);
    resolve(spot);
  }

  // spot = the politician that got hit, or null when the time ran out.
  function resolve(spot) {
    const r = app.round;
    r.active = false;
    clearInterval(r.tick);
    clearInterval(r.clock);
    const q = r.quotes[r.qi];
    const target = q.speaker;
    const right = spot && spot.who === target;
    if (!spot) playClip(q);
    $('playAudio').hidden = !q.audio;

    // Hide everyone who's not part of the answer.
    let targetSpot = right ? spot : spots.find((s) => s.who === target && s !== spot);
    for (const s of spots) if (s !== spot && s !== targetSpot && s.who) hide(s);
    if (!targetSpot) {
      // Bring the real speaker up so the player sees who it was: biggest free spot first.
      const free = spots.filter((s) => s !== spot).sort((a, b) => b.def.w * b.def.h - a.def.w * a.def.h);
      targetSpot = free[0];
      popUp(targetSpot, target, 0);
    } else {
      clearTimeout(targetSpot.timer);
      targetSpot.btn.classList.add('up');
    }
    targetSpot.btn.classList.add('frozen', 'reveal');

    const toast = $('toast');
    const name = CAST[target];
    if (right) {
      r.score += 100;
      r.correct += 1;
      r.streak += 1;
      r.bestStreak = Math.max(r.bestStreak, r.streak);
      r.hits[target] = (r.hits[target] || 0) + 1;
      toast.className = 'toast good';
      $('toastTitle').textContent = 'בול! +100';
      $('toastSub').textContent = `${name} באמת אמר את זה.` + (r.streak >= 2 ? ` רצף ×${r.streak}` : '');
    } else {
      r.streak = 0;
      targetSpot.btn.classList.add('ring');
      if (!r.gotYou) r.gotYou = q;
      if (spot) {
        r.score -= 50;
        const key = [target, spot.who].sort().join('|');
        r.pairs[key] = (r.pairs[key] || 0) + 1;
        toast.className = 'toast bad';
        $('toastTitle').textContent = 'אופס! −50';
        $('toastSub').textContent = `זה לא ${CAST[spot.who]}. אמר את זה: ${name} (מסומן בצהוב)`;
      } else {
        toast.className = 'toast late';
        $('toastTitle').textContent = 'נגמר הזמן!';
        $('toastSub').textContent = `אמר את זה: ${name} (מסומן בצהוב)`;
      }
    }
    $('toastCtx').textContent = [q.year, q.context].filter(Boolean).join(' · ');
    $('next').textContent = r.qi + 1 < r.quotes.length ? 'הבא' : 'לתוצאות';
    placeToast(toast, [spot, targetSpot]);
    toast.hidden = false;
    $('score').textContent = fmt(r.score);
    $('ammo').textContent = '× ' + (r.quotes.length - r.qi - 1);
    $('next').focus({ preventScroll: true });
  }

  // The toast goes at the top of the stage unless that would cover the politicians it's about.
  function placeToast(toast, involved) {
    const defs = involved.filter(Boolean).map((sp) => sp.def);
    const reach = 150; // stage px a toast covers, about
    const topBusy = defs.some((d) => d.y < reach);
    const bottomBusy = defs.some((d) => d.y + d.h > SPOTS.size.h - reach);
    const k = parseFloat(stage.dataset.k) || 1;
    if (topBusy && !bottomBusy) {
      toast.style.top = 'auto';
      toast.style.bottom = Math.max(10, $('stageWrap').clientHeight - SPOTS.size.h * k + 10) + 'px';
    } else {
      toast.style.top = '';
      toast.style.bottom = '';
    }
  }

  $('next').addEventListener('click', () => {
    const r = app.round;
    if (!r) return;
    stopClip();
    r.qi += 1;
    if (r.qi >= r.quotes.length) endRound();
    else startQuote();
  });
  $('quit').addEventListener('click', () => { stopRound(); app.round = null; show('home'); renderBest(); });

  // ---------- end of round ----------
  function rankTitle(score) {
    if (score >= 900) return 'יורה עגבניות ממלכתי';
    if (score >= 700) return 'פרשן בכיר באולפן';
    if (score >= 500) return 'עסקן מפלגתי';
    if (score >= 300) return 'בוחר צף';
    if (score > 0) return 'מתלבט עד הקלפי';
    return 'הצבעת מחאה';
  }

  function endRound() {
    const r = app.round;
    stopRound();
    const best = store.get('best', null);
    const isBest = best === null || r.score > best;
    if (isBest) store.set('best', r.score);
    $('endScore').textContent = fmt(r.score);
    $('endRank').textContent = 'התואר: ' + rankTitle(r.score);
    $('endBest').textContent = isBest ? 'שיא אישי חדש!' : 'השיא שלכם: ' + fmt(best);
    $('stCorrect').textContent = `${r.correct}/${r.quotes.length}`;
    $('stAcc').textContent = r.throws ? Math.round((r.correct / r.throws) * 100) + '%' : '—';
    $('stStreak').textContent = '×' + r.bestStreak;

    const pairs = Object.entries(r.pairs).sort((a, b) => b[1] - a[1]);
    if (pairs.length) {
      const [[key, n]] = pairs;
      const [a, b] = key.split('|');
      $('cfA').src = `assets/ai/${a}-idle.webp`;
      $('cfB').src = `assets/ai/${b}-idle.webp`;
      $('cfText').textContent = `${CAST[a]} ל${CAST[b]}` + (n > 1 ? ` (${n} פעמים)` : '');
      $('confused').hidden = false;
    } else $('confused').hidden = true;

    if (r.gotYou) {
      const q = r.gotYou;
      $('gotQuote').textContent = '״' + q.text + '״';
      $('gotWho').textContent = `אמר: ${CAST[q.speaker]}` + (q.year ? ` · ${q.year}` : '') + ' ·';
      $('gotSrc').href = q.source;
      $('gotYou').hidden = false;
    } else $('gotYou').hidden = true;

    $('shareNote').textContent = '';
    app.lastResult = { score: r.score, correct: r.correct, total: r.quotes.length, rank: rankTitle(r.score) };
    show('end');
    sendPoll(r.hits);
  }

  function sendPoll(hits) {
    if (!Object.keys(hits).length) return;
    fetch('api/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hits }),
      keepalive: true,
    }).catch(() => {});
  }

  $('share').addEventListener('click', async () => {
    const res = app.lastResult;
    if (!res) return;
    const url = location.origin + location.pathname;
    const text = `עגבנייה בקלפי: זיהיתי ${res.correct} מתוך ${res.total} ציטוטים ועשיתי ${fmt(res.score)} נקודות. התואר שלי: ${res.rank}. נסו לנצח אותי 🍅`;
    try {
      if (navigator.share) { await navigator.share({ title: 'עגבנייה בקלפי', text, url }); return; }
      await navigator.clipboard.writeText(text + '\n' + url);
      $('shareNote').textContent = 'הועתק! אפשר להדביק בוואטסאפ.';
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      $('shareNote').textContent = 'לא הצלחנו לשתף. ' + url;
    }
  });
  $('again').addEventListener('click', () => { unlockAudio(); startRound(); });

  // ---------- poll ----------
  let pollRange = 'all';
  let pollReq = 0;
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    pollRange = b.dataset.range;
    loadPoll();
  }));
  function openPoll() {
    stopRound();
    show('poll');
    loadPoll();
  }
  async function loadPoll() {
    document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === pollRange)));
    const note = $('pollNote');
    note.textContent = 'טוען…';
    const req = ++pollReq;
    let counts;
    try {
      const res = await fetch('api/poll?range=' + pollRange, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      counts = (await res.json()).counts;
    } catch {
      if (req === pollReq) { note.textContent = 'הסקר לא זמין כרגע. נסו שוב עוד מעט.'; renderPoll(null); }
      return;
    }
    if (req !== pollReq) return;
    renderPoll(counts);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    note.textContent = total ? `סה״כ נזרקו: ${fmt(total)} עגבניות` : 'עוד אין עגבניות בטווח הזה. היו הראשונים!';
  }
  function renderPoll(counts) {
    const ids = Object.keys(CAST);
    const rows = ids.map((id) => ({ id, n: counts ? counts[id] || 0 : 0 })).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...rows.map((x) => x.n));
    const ol = $('pollRows');
    ol.innerHTML = '';
    rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'poll-row';
      li.innerHTML = `<span class="rank">${i + 1}</span>
        <span class="mini"><img src="assets/ai/${row.id}-idle.webp" alt=""></span>
        <span class="bar-box"><span class="bar-head"><span class="bar-name"></span><span class="bar-count">${fmt(row.n)}</span></span>
        <span class="bar"><span style="width:${Math.round((row.n / max) * 100)}%"></span></span></span>`;
      li.querySelector('.bar-name').textContent = CAST[row.id];
      ol.append(li);
    });
  }

  // ---------- boot ----------
  async function boot() {
    renderLevel();
    renderBest();
    renderMute();
    const [quotes, cast, spotsJson] = await Promise.all([
      fetch('data/quotes.json').then((r) => r.json()),
      fetch('assets/caricatures/cast.json').then((r) => r.json()),
      fetch('scenes/spots.json').then((r) => r.json()),
    ]);
    CAST = Object.fromEntries(cast.map((c) => [c.id, c.name]));
    QUOTES = quotes.quotes.filter((q) => CAST[q.speaker]);
    SPOTS = spotsJson;
    // Warm the cache so faces don't flash in on first pop.
    for (const id of Object.keys(CAST)) for (const v of ['idle', 'hit']) new Image().src = `assets/ai/${id}-${v}.webp`;
    if (location.hash === '#poll') openPoll();
  }
  boot().catch(() => {
    $('start').disabled = true;
    $('start').textContent = 'שגיאה בטעינה. רעננו את הדף';
  });
})();
