/* -------------------------------------------------------------------------------------------------
   Guitar Visualizer + Recorder Logic
   (with SynthCore integration, Karplus-Strong strings, and waveform visualizer)
--------------------------------------------------------------------------------------------------- */

const app = {
  ctx: null,
  dest: null,
  an: null,
  recorder: null,
  chunks: [],
  recordings: [],
  master: null,
};

const $ = id => document.getElementById(id);

let recStart = 0;
let timer = null;
let vizRunning = false;
let vizRAF = null;

/* -------------------------------------------------------------------------------------------------
   AUDIO SETUP
--------------------------------------------------------------------------------------------------- */
function ctxInit() {
  if (app.ctx) return app.ctx;

  const C = window.AudioContext || window.webkitAudioContext;
  app.ctx = new C();

  // Expect SynthCore to provide ensure(), dest, and analyser
  if (typeof SynthCore === "undefined" || typeof SynthCore.ensure !== "function") {
    console.warn("SynthCore not available yet. Call SynthCore.ensure() when available.");
  } else {
    SynthCore.ensure();
    app.dest = SynthCore.dest || app.ctx.createMediaStreamDestination();
    app.an = SynthCore.analyser || app.ctx.createAnalyser();
  }

  // Ensure analyser exists
  if (!app.an) {
    app.an = app.ctx.createAnalyser();
    app.an.fftSize = 1024;
  } else if (!app.an.fftSize) {
    app.an.fftSize = 1024;
  }

  // Create master bus to route to speakers, recorder, and visualizer
  if (!app.master) {
    app.master = app.ctx.createGain();
    app.master.gain.value = 1.0;

    // Speakers
    try { app.master.connect(app.ctx.destination); } catch (e) {}

    // Recorder destination (SynthCore.dest should be MediaStreamDestination)
    if (app.dest && app.dest.stream) {
      try { app.master.connect(app.dest); } catch (e) {}
    }

    // Analyser tap
    try { app.master.connect(app.an); } catch (e) {}
  }

  return app.ctx;
}

/* -------------------------------------------------------------------------------------------------
   VISUALIZER SETUP
--------------------------------------------------------------------------------------------------- */
const canvas = $("vizCanvas");
const c2d = canvas ? canvas.getContext("2d") : null;

function resizeViz() {
  if (!canvas || !c2d) return;

  const cw = canvas.clientWidth || 600;
  const ch = canvas.clientHeight || 200;
  const ratio = window.devicePixelRatio || 1;

  // Use integers to avoid subpixel blurriness
  canvas.width = Math.max(1, Math.floor(cw * ratio));
  canvas.height = Math.max(1, Math.floor(ch * ratio));

  // Draw in CSS pixels by scaling the context
  c2d.setTransform(ratio, 0, 0, ratio, 0, 0);
}

window.addEventListener("resize", resizeViz);
resizeViz();

/* -------------------------------------------------------------------------------------------------
   VISUALIZATION STATE
--------------------------------------------------------------------------------------------------- */
const BAR_COUNT = 32; // kept for future use; waveform uses analyser bins
let hue = 30;

/* -------------------------------------------------------------------------------------------------
   RENDER VISUALIZER
--------------------------------------------------------------------------------------------------- */
function renderViz() {
  ctxInit();
  if (!app.an || !c2d || !canvas) {
    if (vizRunning) vizRAF = requestAnimationFrame(renderViz);
    return;
  }

  // Read time-domain data
  const bufferLength = app.an.frequencyBinCount || 1024;
  const data = new Uint8Array(bufferLength);
  app.an.getByteTimeDomainData(data);

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  c2d.clearRect(0, 0, cw, ch);

  // Compute average deviation from center (128)
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
  const avg = data.length ? sum / data.length : 0;

  // Animate hue
  hue = (hue + 0.6) % 360;

  // Dynamic line width (scaled by devicePixelRatio)
  const dpr = window.devicePixelRatio || 1;
  c2d.lineWidth = Math.max(1.0, avg / 30) * dpr;

  // Neon gradient stroke
  const grad = c2d.createLinearGradient(0, 0, cw, 0);
  grad.addColorStop(0, `hsl(${(hue - 40 + 360) % 360}, 95%, 65%)`);
  grad.addColorStop(0.5, `hsl(${hue}, 95%, 50%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 95%, 65%)`);
  c2d.strokeStyle = grad;
  c2d.lineJoin = "round";
  c2d.lineCap = "round";

  // Draw waveform
  c2d.beginPath();
  const sliceWidth = cw / data.length;
  let x = 0;
  const ampFactor = Math.max(0.8, 2.0 - avg / 40);

  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    const y = ch / 2 + v * (ch / ampFactor);
    if (i === 0) c2d.moveTo(x, y);
    else c2d.lineTo(x, y);
    x += sliceWidth;
  }

  c2d.lineTo(cw, ch / 2);
  c2d.stroke();

  if (vizRunning) vizRAF = requestAnimationFrame(renderViz);
}

/* -------------------------------------------------------------------------------------------------
   STRINGS (Karplus–Strong)
--------------------------------------------------------------------------------------------------- */
const GUITAR_STRINGS = [
  { name: "E2", frequency: 82.41, color: "#ff2079" },
  { name: "A2", frequency: 110.00, color: "#7928ca" },
  { name: "D3", frequency: 146.83, color: "#00f0ff" },
  { name: "G3", frequency: 196.00, color: "#4b0082" },
  { name: "B3", frequency: 246.94, color: "#ff0080" },
  { name: "E4", frequency: 329.63, color: "#ff9900" },
];

/* -------------------------------------------------------------------------------------------------
   UI INITIALIZATION
--------------------------------------------------------------------------------------------------- */
function initGuitar() {
  ctxInit();

  // Start visualizer loop
  if (!vizRunning) {
    vizRunning = true;
    resizeViz();
    renderViz();
  }

  const neck = $("guitarNeck");
  if (!neck) return;

  // Clear existing pads (safe re-init)
  neck.innerHTML = "";

  GUITAR_STRINGS.forEach(string => {
    const pad = document.createElement("button");
    pad.className = "pluck-pad";
    pad.innerHTML = `<span class="string-name">${string.name}</span>`;
    pad.style.borderColor = string.color;

    const onPress = e => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();

      // Pluck using SynthCore (Karplus-Strong)
      if (typeof SynthCore !== "undefined" && typeof SynthCore.pluckGuitarString === "function") {
        SynthCore.pluckGuitarString({ frequency: string.frequency });
      } else {
        console.warn("SynthCore.pluckGuitarString not found");
      }

      pad.classList.add("plucked");
      pad.style.boxShadow = `0 0 18px ${string.color}, inset 0 0 12px ${string.color}`;
    };

    const onRelease = () => {
      pad.classList.remove("plucked");
      pad.style.boxShadow = "none";
    };

    pad.addEventListener("pointerdown", onPress, { passive: false });
    pad.addEventListener("pointerup", onRelease);
    pad.addEventListener("pointercancel", onRelease);
    pad.addEventListener("pointerleave", onRelease);

    neck.appendChild(pad);
  });
}

window.addEventListener("load", initGuitar);

/* -------------------------------------------------------------------------------------------------
   RECORDING LOGIC
--------------------------------------------------------------------------------------------------- */
const recordBtn = $("recordBtn");
const stopBtn = $("stopBtn");
const topbar = $("topbar");
const recIndicator = $("recIndicator");
const recTimer = $("recTimer");

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startRec() {
  if (!app.dest || !app.dest.stream) {
    ctxInit();
    if (!app.dest || !app.dest.stream) {
      alert("Recording destination unavailable. Ensure SynthCore is initialized and the browser supports MediaRecorder.");
      return;
    }
  }

  if (app.recorder && app.recorder.state === "recording") return;

  // MIME negotiation
  const preferred = "audio/webm;codecs=opus";
  const mime = MediaRecorder.isTypeSupported(preferred)
    ? preferred
    : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "");

  try {
    app.recorder = mime
      ? new MediaRecorder(app.dest.stream, { mimeType: mime })
      : new MediaRecorder(app.dest.stream);
  } catch (e) {
    console.error("MediaRecorder creation failed:", e);
    alert("Could not start recording (MediaRecorder unsupported or permission denied).");
    return;
  }

  app.chunks = [];
  app.recorder.ondataavailable = e => {
    if (e.data && e.data.size) app.chunks.push(e.data);
  };
  app.recorder.onstop = saveRec;
  app.recorder.start();

  // UI updates
  if (topbar) topbar.classList.add("recording");
  if (recIndicator) recIndicator.style.visibility = "visible";
  if (stopBtn) stopBtn.disabled = false;
  if (recordBtn) recordBtn.disabled = true;

  recStart = Date.now();
  recTimer.textContent = "00:00";
  timer = setInterval(() => {
    recTimer.textContent = formatTime(Date.now() - recStart);
  }, 500);
}

function stopRec() {
  if (!app.recorder) return;
  if (app.recorder.state === "recording") app.recorder.stop();

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  if (topbar) topbar.classList.remove("recording");
  if (recIndicator) recIndicator.style.visibility = "hidden";
  if (stopBtn) stopBtn.disabled = true;
  if (recordBtn) recordBtn.disabled = false;
  recTimer.textContent = "00:00";
}

async function saveRec() {
  if (!app.chunks || !app.chunks.length) return;

  const blob = new Blob(app.chunks, { type: app.chunks[0]?.type || "audio/webm" });
  const url = URL.createObjectURL(blob);
  const name = `Guitar Recording ${new Date().toLocaleTimeString()}`;
  app.recordings.unshift({ name, url });

  renderRecs();
}

/* -------------------------------------------------------------------------------------------------
   RECORDINGS UI
--------------------------------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------------------------------
   BUTTONS + DOCK
--------------------------------------------------------------------------------------------------- */
if (recordBtn) recordBtn.addEventListener("click", startRec);
if (stopBtn) stopBtn.addEventListener("click", stopRec);

const clearAllBtn = $("clearAllBtn");
if (clearAllBtn) {
  clearAllBtn.onclick = () => {
    if (confirm("Clear all recordings?")) {
      app.recordings = [];
      renderRecs();
    }
  };
}

const dock = $("bottomDock");
const dockHeader = $("dockHeader");
if (dockHeader && dock) dockHeader.onclick = () => dock.classList.toggle("expanded");
