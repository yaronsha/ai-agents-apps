/**
 * Guitar Tabber — Guitar Pro–style browser viewer
 * Loads .tab.json, renders a horizontal 6-string staff, plays via Tone.js,
 * and highlights currently sounding notes. Highlight + audio share one clock.
 */
(() => {
  "use strict";

  const STRING_LABELS = ["E", "A", "D", "G", "B", "e"]; // index 0 = low E
  const DRAW_ORDER = [5, 4, 3, 2, 1, 0]; // top → bottom

  const cfg = {
    leftPad: 56,
    rightPad: 48,
    topPad: 36,
    stringGap: 34,
    pxPerSec: 160,
    noteMinW: 22,
    noteH: 26,
  };

  /** @type {{ version:number, tuning:string[], notes:object[], title?:string } | null} */
  let tabData = null;
  let duration = 0;
  let layoutNotes = [];
  let playheadX = cfg.leftPad;

  let playing = false;
  let logicTime = 0;
  let tempoPct = 100;
  let rafId = 0;
  let lastFrameTs = 0;
  /** @type {Set<number>} indices already triggered in this play pass */
  let fired = new Set();
  /** @type {import('tone').PolySynth | null} */
  let synth = null;

  const el = {
    canvas: document.getElementById("tabCanvas"),
    scroll: document.getElementById("tabScroll"),
    status: document.getElementById("status"),
    empty: document.getElementById("emptyHint"),
    time: document.getElementById("timeDisplay"),
    seek: document.getElementById("seek"),
    tempo: document.getElementById("tempo"),
    tempoValue: document.getElementById("tempoValue"),
    btnPlay: document.getElementById("btnPlay"),
    btnStop: document.getElementById("btnStop"),
    btnDemo: document.getElementById("btnDemo"),
    btnMidi: document.getElementById("btnMidi"),
    fileInput: document.getElementById("fileInput"),
    midiInput: document.getElementById("midiInput"),
  };
  const ctx = el.canvas.getContext("2d");

  function setStatus(msg) {
    el.status.innerHTML = msg;
  }

  function fmtTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function ensureSynth() {
    if (synth) return synth;
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.008, decay: 0.18, sustain: 0.3, release: 0.35 },
    }).toDestination();
    synth.volume.value = -6;
    synth.maxPolyphony = 12;
    return synth;
  }

  function stopPlayback(resetTime = false) {
    playing = false;
    el.btnPlay.textContent = "Play";
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    fired.clear();
    if (synth) {
      try {
        synth.releaseAll();
      } catch (_) {
        /* ignore */
      }
    }
    if (resetTime) {
      logicTime = 0;
      updateTransportUI();
      draw();
      autoscroll();
    }
  }

  function triggerDueNotes() {
    if (!tabData) return;
    const s = ensureSynth();
    const rate = tempoPct / 100;
    tabData.notes.forEach((n, i) => {
      if (fired.has(i)) return;
      const t0 = Number(n.t) || 0;
      if (logicTime + 0.001 >= t0) {
        fired.add(i);
        const remaining = t0 + Math.max(0.05, Number(n.dur) || 0.3) - logicTime;
        if (remaining <= 0.01) return;
        // Wall-clock duration scaled so perceived length matches tempo
        const wallDur = remaining / rate;
        try {
          const freq = Tone.Frequency(n.midi, "midi").toFrequency();
          s.triggerAttackRelease(freq, wallDur);
        } catch (_) {
          /* ignore */
        }
      }
    });
  }

  async function play() {
    if (!tabData || !tabData.notes.length) return;
    await Tone.start();
    ensureSynth();
    if (logicTime >= duration - 0.02) {
      logicTime = 0;
      fired.clear();
    }
    // Mark past notes as already fired so seeking mid-song doesn't replay them
    fired.clear();
    tabData.notes.forEach((n, i) => {
      if ((Number(n.t) || 0) < logicTime - 0.01) fired.add(i);
    });

    playing = true;
    el.btnPlay.textContent = "Pause";
    lastFrameTs = performance.now();
    triggerDueNotes();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    el.btnPlay.textContent = "Play";
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (synth) {
      try {
        synth.releaseAll();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function tick(ts) {
    if (!playing) return;
    const dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;
    logicTime += dt * (tempoPct / 100);
    if (logicTime >= duration) {
      logicTime = duration;
      updateTransportUI();
      draw();
      stopPlayback(false);
      return;
    }
    triggerDueNotes();
    updateTransportUI();
    draw();
    autoscroll();
    rafId = requestAnimationFrame(tick);
  }

  function updateTransportUI() {
    el.time.textContent = `${fmtTime(logicTime)} / ${fmtTime(duration)}`;
    const max = Number(el.seek.max) || 1000;
    el.seek.value = String(duration > 0 ? Math.round((logicTime / duration) * max) : 0);
  }

  function buildLayout() {
    layoutNotes = [];
    if (!tabData || !tabData.notes.length) {
      duration = 0;
      return;
    }
    let maxEnd = 0;
    for (const n of tabData.notes) {
      const t = Number(n.t) || 0;
      const dur = Math.max(0.05, Number(n.dur) || 0.3);
      maxEnd = Math.max(maxEnd, t + dur);
      const w = Math.max(cfg.noteMinW, dur * cfg.pxPerSec * 0.85);
      layoutNotes.push({
        t,
        dur,
        x: cfg.leftPad + t * cfg.pxPerSec,
        w,
        string: Number(n.string),
        fret: Number(n.fret),
        midi: Number(n.midi),
      });
    }
    duration = Math.max(maxEnd + 0.4, 1);
  }

  function canvasSize() {
    const h = cfg.topPad + DRAW_ORDER.length * cfg.stringGap + 48;
    const w = Math.max(
      el.scroll.clientWidth - 8,
      cfg.leftPad + duration * cfg.pxPerSec + cfg.rightPad
    );
    const dpr = window.devicePixelRatio || 1;
    el.canvas.width = Math.floor(w * dpr);
    el.canvas.height = Math.floor(h * dpr);
    el.canvas.style.width = `${w}px`;
    el.canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function stringY(stringIndex) {
    const row = DRAW_ORDER.indexOf(stringIndex);
    return cfg.topPad + row * cfg.stringGap;
  }

  function isActive(n) {
    return logicTime >= n.t - 0.01 && logicTime < n.t + n.dur + 0.02;
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function draw() {
    const { w, h } = canvasSize();
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1c212b");
    grad.addColorStop(1, "#151920");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (tabData && tabData.title) {
      ctx.fillStyle = "#9aa0a6";
      ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
      ctx.fillText(tabData.title, cfg.leftPad, 18);
    }

    for (const s of DRAW_ORDER) {
      const y = stringY(s);
      ctx.strokeStyle = "#3a4150";
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(cfg.leftPad - 8, y);
      ctx.lineTo(w - cfg.rightPad + 8, y);
      ctx.stroke();

      ctx.fillStyle = "#c5cad3";
      ctx.font = "700 13px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(STRING_LABELS[s], cfg.leftPad - 16, y);
    }
    ctx.textAlign = "left";

    ctx.strokeStyle = "#2a303c";
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px ui-monospace, monospace";
    for (let t = 0; t <= duration; t += 1) {
      const x = cfg.leftPad + t * cfg.pxPerSec;
      ctx.beginPath();
      ctx.moveTo(x, cfg.topPad - 10);
      ctx.lineTo(x, cfg.topPad + DRAW_ORDER.length * cfg.stringGap - cfg.stringGap + 10);
      ctx.stroke();
      ctx.fillText(`${t}s`, x + 3, cfg.topPad - 14);
    }

    for (const n of layoutNotes) {
      const y = stringY(n.string);
      const active = isActive(n);
      const hh = cfg.noteH;
      const yy = y - hh / 2;

      roundRect(ctx, n.x, yy, n.w, hh, 6);
      if (active) {
        ctx.fillStyle = "#ffd166";
        ctx.shadowColor = "rgba(255, 209, 102, 0.55)";
        ctx.shadowBlur = 14;
      } else {
        ctx.fillStyle = "#2b3342";
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = active ? "#ffe8a3" : "#4a5568";
      ctx.lineWidth = active ? 1.75 : 1;
      ctx.stroke();

      ctx.fillStyle = active ? "#1a1200" : "#f0f3f8";
      ctx.font = `700 ${active ? 15 : 14}px JetBrains Mono, ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelX = n.x + Math.min(n.w * 0.5, 18);
      ctx.fillText(String(n.fret), labelX, y);
    }
    ctx.textAlign = "left";

    playheadX = cfg.leftPad + logicTime * cfg.pxPerSec;
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, cfg.topPad - 16);
    ctx.lineTo(
      playheadX,
      cfg.topPad + DRAW_ORDER.length * cfg.stringGap - cfg.stringGap + 16
    );
    ctx.stroke();
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, cfg.topPad - 18);
    ctx.lineTo(playheadX + 6, cfg.topPad - 18);
    ctx.lineTo(playheadX, cfg.topPad - 8);
    ctx.fill();
  }

  function autoscroll() {
    const viewW = el.scroll.clientWidth;
    const target = playheadX - viewW * 0.35;
    if (Math.abs(el.scroll.scrollLeft - target) > 4) {
      el.scroll.scrollLeft = Math.max(0, target);
    }
  }

  function loadTabObject(data, label) {
    stopPlayback(true);
    if (!data || !Array.isArray(data.notes)) {
      setStatus("Invalid tab JSON: missing <strong>notes</strong> array.");
      return;
    }
    tabData = data;
    buildLayout();
    el.empty.classList.add("hidden");
    logicTime = 0;
    updateTransportUI();
    draw();
    const title = data.title ? ` · ${escapeHtml(data.title)}` : "";
    setStatus(
      `Loaded <strong>${escapeHtml(label || "tab")}</strong>${title} — ` +
        `<strong>${data.notes.length}</strong> notes · ${fmtTime(duration)}`
    );
  }

  async function loadDemo() {
    try {
      const res = await fetch("demo.tab.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadTabObject(await res.json(), "demo.tab.json");
    } catch (err) {
      console.warn("fetch demo failed, using embedded", err);
      loadTabObject(
        {
          version: 1,
          tuning: ["E", "A", "D", "G", "B", "e"],
          title: "open_a demo (embedded)",
          notes: [
            { t: 0.16, dur: 0.74, midi: 45, string: 1, fret: 0, hz: 109.9 },
            { t: 1.07, dur: 0.66, midi: 57, string: 3, fret: 2, hz: 219.9 },
            { t: 1.86, dur: 0.59, midi: 50, string: 2, fret: 0, hz: 146.8 },
          ],
        },
        "embedded demo"
      );
    }
  }

  async function loadFromQuery() {
    const params = new URLSearchParams(location.search);
    const jsonParam = params.get("json");
    if (!jsonParam) return false;
    try {
      const res = await fetch(jsonParam, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadTabObject(await res.json(), jsonParam);
      return true;
    } catch (err) {
      setStatus(
        `Could not load <code>?json=${escapeHtml(jsonParam)}</code>: ${escapeHtml(err.message)}. ` +
          `Serve via <code>python -m http.server</code> or use the file picker.`
      );
      return false;
    }
  }

  el.btnPlay.addEventListener("click", async () => {
    if (playing) pause();
    else await play();
  });
  el.btnStop.addEventListener("click", () => stopPlayback(true));
  el.btnDemo.addEventListener("click", () => loadDemo());

  el.fileInput.addEventListener("change", async () => {
    const f = el.fileInput.files && el.fileInput.files[0];
    if (!f) return;
    try {
      loadTabObject(JSON.parse(await f.text()), f.name);
    } catch (err) {
      setStatus(`Failed to parse file: ${escapeHtml(err.message)}`);
    }
    el.fileInput.value = "";
  });

  el.btnMidi.addEventListener("click", () => el.midiInput.click());
  el.midiInput.addEventListener("change", () => {
    const f = el.midiInput.files && el.midiInput.files[0];
    if (!f) return;
    setStatus(
      `MIDI file <strong>${escapeHtml(f.name)}</strong> noted ` +
        `(${(f.size / 1024).toFixed(1)} KB). Playback & highlight use <code>.tab.json</code> for sync.`
    );
    el.midiInput.value = "";
  });

  el.seek.addEventListener("input", () => {
    if (!duration) return;
    const was = playing;
    if (was) pause();
    const max = Number(el.seek.max) || 1000;
    logicTime = (Number(el.seek.value) / max) * duration;
    fired.clear();
    updateTransportUI();
    draw();
    autoscroll();
    if (was) play();
  });

  el.tempo.addEventListener("input", () => {
    tempoPct = Number(el.tempo.value);
    el.tempoValue.textContent = `${tempoPct}%`;
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
    if (ev.code === "Space") {
      ev.preventDefault();
      el.btnPlay.click();
    } else if (ev.code === "ArrowRight") {
      const was = playing;
      if (was) pause();
      logicTime = Math.min(duration, logicTime + 0.5);
      fired.clear();
      updateTransportUI();
      draw();
      autoscroll();
      if (was) play();
    } else if (ev.code === "ArrowLeft") {
      const was = playing;
      if (was) pause();
      logicTime = Math.max(0, logicTime - 0.5);
      fired.clear();
      updateTransportUI();
      draw();
      autoscroll();
      if (was) play();
    } else if (ev.code === "Home") {
      stopPlayback(true);
    }
  });

  window.addEventListener("resize", () => draw());

  (async () => {
    const fromQuery = await loadFromQuery();
    if (!fromQuery) await loadDemo();
  })();
})();
