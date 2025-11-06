/* -------------------------------------------------------------------------------------------------
   AlgoRhythms — Drums Logic
   (updated: 32 bars + robust glow)
--------------------------------------------------------------------------------------------------- */
/* Neon / Cyberpunk palette */
const PALETTE = ["#ff0080", "#7928ca", "#00f0ff", "#4b0082", "#ff2079"];

/* App state */
const app = {
  ctx: null,
  dest: null,
  an: null,
  recorder: null,
  chunks: [],
  recordings: [],
};

const $ = id => document.getElementById(id);

let recStart = 0, timer;

/* -------------------------------------------------------------------------------------------------
   AUDIO SETUP
--------------------------------------------------------------------------------------------------- */
function ctxInit() {
  if (app.ctx) return app.ctx;

  const C = window.AudioContext || window.webkitAudioContext;
  app.ctx = new C();
  app.dest = app.ctx.createMediaStreamDestination();
  app.an = app.ctx.createAnalyser();
  app.an.fftSize = 1024;

  // ✅ Keep the graph alive even when silent
  const silence = app.ctx.createOscillator();
  const gain = app.ctx.createGain();
  gain.gain.value = 0.00001; // inaudible but nonzero
  silence.connect(gain).connect(app.dest);
  silence.start();

  return app.ctx;
}

/* -------------------------------------------------------------------------------------------------
   VISUALIZER SETUP
--------------------------------------------------------------------------------------------------- */
const canvas = $("vizCanvas");
const c2d = canvas ? canvas.getContext("2d") : null;
let vizRAF = null, vizRunning = false;

/* DPR-aware resize (draw in CSS pixels) */
function resizeViz() {
  if (!canvas || !c2d) return;

  const cw = canvas.clientWidth || 600;
  const ch = canvas.clientHeight || 200;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.floor(cw * ratio));
  canvas.height = Math.max(1, Math.floor(ch * ratio));
  c2d.setTransform(ratio, 0, 0, ratio, 0, 0);
}

window.addEventListener("resize", resizeViz);
resizeViz();

/* Visualizer config: reduced bars */
const BAR_COUNT = 32;
let vizBars = new Array(BAR_COUNT).fill(0);
let pulse = 0;

/* -------------------------------------------------------------------------------------------------
   RENDER: minimal neon bars + robust glow
--------------------------------------------------------------------------------------------------- */
function renderViz() {
  if (!app.an) {
    try { ctxInit(); } catch (e) {}
  }
  if (!app.an || !c2d || !canvas) {
    vizRAF = requestAnimationFrame(renderViz);
    return;
  }

  vizRunning = true;

  const bufferLength = app.an.frequencyBinCount;
  const freqData = new Uint8Array(bufferLength);
  app.an.getByteFrequencyData(freqData);

  // CSS pixel dims
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;

  // Geometry
  const bars = vizBars.length;
  const slot = cw / bars;
  const barWidth = Math.max(3, slot * 0.68);
  const gap = Math.max(2, slot * 0.32);

  // Clear canvas
  c2d.clearRect(0, 0, cw, ch);

  // --- Subtle base radial glow ---
  // const rg = c2d.createRadialGradient(cw / 2, ch * 0.9, ch * 0.02, cw / 2, ch * 0.9, ch * 0.9);
  // rg.addColorStop(0, "rgba(255, 0, 128, 0.08)");
  // rg.addColorStop(0.25, "rgba(120, 30, 200, 0.05)");
  // rg.addColorStop(0.6, "rgba(0, 230, 255, 0.03)");
  // rg.addColorStop(1, "rgba(0,0,0,0)");

  // c2d.globalCompositeOperation = "lighter";
  // c2d.fillStyle = rg;
  // c2d.fillRect(0, 0, cw, ch);
  // c2d.globalCompositeOperation = "source-over";

  // --- Update bars (logarithmic mapping) ---
  for (let i = 0; i < bars; i++) {
    const logIndex = Math.pow(i / bars, 2.2) * (bufferLength - 1);
    const idx = Math.floor(logIndex);
    const v = (freqData[idx] || 0) / 255;
    const target = Math.pow(v, 0.9) * ch * 0.92;
    vizBars[i] = Math.max(target, vizBars[i] - ch * 0.02);
  }

  // Pulse decay and scaling
  pulse *= 0.88;
  const pulseScale = 1 + pulse * 0.06;

  // --- Draw bars ---
  let x = gap * 0.5;
  for (let i = 0; i < bars; i++) {
    const barHeight = vizBars[i];
    const y = ch - barHeight;
    const color = PALETTE[i % PALETTE.length];

    c2d.shadowBlur = 16;
    c2d.shadowColor = color;
    c2d.fillStyle = color;
    c2d.fillRect(x, y, barWidth * pulseScale, barHeight);
    c2d.shadowBlur = 0;

    x += barWidth + gap;
  }

  // --- Reflection / Floor glow ---
  const reflectionHeight = ch * 0.25;
  const gradient = c2d.createLinearGradient(0, ch, 0, ch - reflectionHeight);
  gradient.addColorStop(0, "rgba(255,255,255,0.06)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  c2d.save();
  c2d.translate(0, ch * 2);
  c2d.scale(1, -1);

  let xr = gap * 0.5;
  for (let i = 0; i < bars; i++) {
    const barHeight = vizBars[i];
    const y = ch - barHeight;
    const color = PALETTE[i % PALETTE.length];
    c2d.fillStyle = color;
    c2d.globalAlpha = 0.25;
    c2d.fillRect(xr, y, barWidth * pulseScale, barHeight);
    xr += barWidth + gap;
  }

  c2d.globalAlpha = 1;
  c2d.globalCompositeOperation = "destination-out";
  c2d.fillStyle = gradient;
  c2d.fillRect(0, ch, cw, reflectionHeight);
  c2d.globalCompositeOperation = "source-over";
  c2d.restore();

  vizRAF = requestAnimationFrame(renderViz);
}

/* -------------------------------------------------------------------------------------------------
   VIZ HELPERS
--------------------------------------------------------------------------------------------------- */
function startViz() {
  if (!vizRAF) {
    resizeViz();
    vizRAF = requestAnimationFrame(renderViz);
  }
}

function stopViz() {
  if (vizRAF) {
    cancelAnimationFrame(vizRAF);
    vizRAF = null;
  }
}

/* Trigger pulse (used by playDrum) */
function triggerPulse(intensity = 1) {
  pulse = Math.min(1.2, pulse + intensity * 0.6);
  const divider = document.querySelector(".viz-divider");
  if (divider) {
    divider.style.transform = "scaleX(1.06)";
    divider.style.transition = "transform 0.12s ease";
    setTimeout(() => divider.style.transform = "scaleX(1)", 120);
  }
}

/* Divider click feedback */
document.querySelectorAll(".drum-pad").forEach(btn => {
  btn.addEventListener("mousedown", () => {
    const divider = document.querySelector(".viz-divider");
    if (divider) {
      divider.style.transform = "scaleX(1.04)";
      setTimeout(() => divider.style.transform = "scaleX(1)", 100);
    }
  });
});

/* Init audio + start visuals */
try { ctxInit(); startViz(); } catch (e) {}

/* -------------------------------------------------------------------------------------------------
   DRUM SYNTHESIS
--------------------------------------------------------------------------------------------------- */
function playDrum(type, el) {
  const ctx = ctxInit();
  const { dest, an } = app;

  const g = ctx.createGain();
  try { g.connect(ctx.destination); } catch (e) {}
  if (dest) g.connect(dest);
  if (an) g.connect(an);

  if (type === "kick") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.45);
    g.gain.setValueAtTime(1.0, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.connect(g);
    o.start();
    o.stop(ctx.currentTime + 0.5);
    triggerPulse(1.2);

  } else if (type === "snare") {
    const noise = ctx.createBufferSource();
    const bufLen = Math.floor(ctx.sampleRate * 0.16);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 800;

    noise.connect(filter);
    filter.connect(g);
    g.gain.setValueAtTime(1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    noise.start();
    noise.stop(ctx.currentTime + 0.2);
    triggerPulse(0.85);

  } else if (type === "hihat") {
    const noise = ctx.createBufferSource();
    const bufLen = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;

    noise.connect(hp);
    hp.connect(g);
    g.gain.setValueAtTime(0.6, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    noise.start();
    noise.stop(ctx.currentTime + 0.1);
    triggerPulse(0.5);

  } else if (type === "tomh" || type === "toml") {
    const o = ctx.createOscillator();
    o.type = "sine";
    const base = type === "tomh" ? 200 : 120;
    o.frequency.setValueAtTime(base, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(base / 2, ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0.8, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    triggerPulse(0.75);
  }

  if (el) {
    el.classList.add("active");
    setTimeout(() => el.classList.remove("active"), 150);
  }
}

/* Bind pads */
document.querySelectorAll(".drum-pad").forEach(btn => {
  btn.addEventListener("mousedown", () => playDrum(btn.dataset.drum, btn));
});

/* -------------------------------------------------------------------------------------------------
   RECORDING CONTROLS
--------------------------------------------------------------------------------------------------- */
const recBtn = $("recordBtn"),
      stopBtn = $("stopBtn"),
      recInd = $("recIndicator"),
      recTime = $("recTimer"),
      topbar = $("topbar");

if (recBtn && stopBtn) {
  recBtn.onclick = startRec;
  stopBtn.onclick = stopRec;
}

function startRec() {
  ctxInit();
  if (!app.dest) {
    console.error("No recording destination available");
    return;
  }

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  app.recorder = new MediaRecorder(app.dest.stream, { mimeType: mime });
  app.chunks = [];

  app.recorder.ondataavailable = e => {
    if (e.data && e.data.size) app.chunks.push(e.data);
  };
  app.recorder.onstop = saveRec;

  app.recorder.start();
  recStart = Date.now();

  recBtn.classList.add("recording");
  if (topbar) topbar.classList.add("recording");
  stopBtn.disabled = false;
  if (recInd) recInd.style.visibility = "visible";
  tick();
}

function tick() {
  if (!app.recorder || app.recorder.state !== "recording") return;

  const t = Math.floor((Date.now() - recStart) / 1000);
  if (recTime) {
    recTime.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }
  timer = setTimeout(tick, 500);
}

function stopRec() {
  if (app.recorder && app.recorder.state === "recording") app.recorder.stop();

  if (recBtn) recBtn.classList.remove("recording");
  if (topbar) topbar.classList.remove("recording");
  if (stopBtn) stopBtn.disabled = true;
  if (recInd) recInd.style.visibility = "hidden";
  clearTimeout(timer);
}

async function saveRec() {
  const blob = new Blob(app.chunks, { type: app.chunks[0]?.type || "audio/webm" });
  const url = URL.createObjectURL(blob);
  const name = `Recording ${new Date().toLocaleTimeString()}`;

  app.recordings.unshift({ name, url });
  renderRecs();
}

function renderRecs() {
  const list = $("recordingsList");
  if (!list) return;

  list.innerHTML = "";
  app.recordings.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "recording-item";

    const nameInput = document.createElement("input");
    nameInput.value = r.name;
    nameInput.onchange = () => { r.name = nameInput.value; };

    const aud = document.createElement("audio");
    aud.src = r.url;
    aud.controls = true;

    const del = document.createElement("button");
    del.className = "small-btn";
    del.textContent = "Delete";
    del.onclick = () => {
      app.recordings.splice(i, 1);
      renderRecs();
    };

    div.append(nameInput, aud, del);
    list.append(div);
  });
}

const clearAllBtn = $("clearAllBtn");
if (clearAllBtn) {
  clearAllBtn.onclick = () => {
    if (confirm("Clear all recordings?")) {
      app.recordings = [];
      renderRecs();
    }
  };
}

/* -------------------------------------------------------------------------------------------------
   COLLAPSIBLE DOCK
--------------------------------------------------------------------------------------------------- */
const dock = $("bottomDock");
const dockHeader = $("dockHeader");

if (dockHeader) {
  dockHeader.onclick = () => {
    if (dock) dock.classList.toggle("expanded");
    const main = $("mainSection");
    if (dock && dock.classList.contains("expanded") && main)
      main.scrollTo({ top: 0, behavior: "smooth" });
  };
}
