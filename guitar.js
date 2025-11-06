/* guitar.js — Robust Karplus-Strong-style plucked strings
   - Rewritten to fix audio quality, cleanup, analyiser & recording integration.
   - Prefers shared window.appState.audioContext / dest / analyser when available.
   - Exposes pluck(freq,{strength,damping,duration}) and a small UI layer.
*/

const $ = id => document.getElementById(id);

const GUITAR = {
  ctx: null,
  dest: null,
  analyser: null,
  vizRAF: null,
  vizCanvas: null,
  vizCtx: null,
  vizBars: null,
  BAR_COUNT: 32, // reduced, tweakable
};

/* ---------- Audio context / shared resources ---------- */
function ctxInit() {
  if (GUITAR.ctx) return GUITAR.ctx;

  // Prefer re-using global shared context if available
  if (window.appState && window.appState.audioContext) {
    GUITAR.ctx = window.appState.audioContext;
    GUITAR.dest = window.appState.dest || null;
    // reuse or create analyser on shared ctx
    if (window.appState._analyser) {
      GUITAR.analyser = window.appState._analyser;
    } else {
      GUITAR.analyser = GUITAR.ctx.createAnalyser();
      GUITAR.analyser.fftSize = 1024;
      try { GUITAR.analyser.connect(GUITAR.ctx.destination); } catch (e) {}
      window.appState._analyser = GUITAR.analyser;
    }
    return GUITAR.ctx;
  }

  // Otherwise create local audio context and dest
  const C = window.AudioContext || window.webkitAudioContext;
  GUITAR.ctx = new C();
  GUITAR.dest = GUITAR.ctx.createMediaStreamDestination();
  GUITAR.analyser = GUITAR.ctx.createAnalyser();
  GUITAR.analyser.fftSize = 1024;
  try { GUITAR.analyser.connect(GUITAR.ctx.destination); } catch (e) {}

  // store in window.appState for cross-page reuse
  if (!window.appState) window.appState = {};
  window.appState.audioContext = GUITAR.ctx;
  window.appState.dest = GUITAR.dest;
  window.appState._analyser = GUITAR.analyser;

  return GUITAR.ctx;
}

/* ---------- Karplus-Strong like pluck (delay feedback loop) ---------- */
/*
 Approach:
  - Use a DelayNode with delayTime = 1 / freq (period).
  - Create a feedback loop: delay -> lowpassFilter -> feedbackGain -> delay
  - Inject a short noise burst into the delay to seed the loop and into the output for initial attack.
  - Use outGain envelope to control duration.
  - Cleanup nodes after decay.
*/
function pluck(freq, { strength = 0.9, damping = 0.95, duration = 3.0 } = {}) {
  const ctx = ctxInit();
  if (!ctx || freq <= 0 || !isFinite(freq)) return;

  const now = ctx.currentTime;

  // Cap the delay time to avoid extremely large values on very low freq inputs
  const delayTime = Math.min(0.5, 1 / freq); // 0.5s max safe cap

  // Create nodes
  const noiseSrc = ctx.createBufferSource();
  // small noise burst (short envelope) to excite the string
  const noiseLength = Math.max(128, Math.floor(ctx.sampleRate * Math.min(0.04, delayTime * 2))); // 40ms or relative
  const noiseBuf = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
  const nb = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) {
    // shape noise envelope so it decays within the burst
    const env = 1 - (i / noiseLength);
    nb[i] = (Math.random() * 2 - 1) * strength * env;
  }
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = false;

  const delay = ctx.createDelay(1.0); // support up to 1s but we cap delayTime
  delay.delayTime.setValueAtTime(delayTime, now);

  const feedbackGain = ctx.createGain();
  feedbackGain.gain.setValueAtTime(Math.max(0.0, Math.min(0.999, damping)), now); // damping <1

  // lowpass in the feedback path to simulate energy loss / body and brightness change
  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  // cutoff increases with frequency so higher strings sound brighter
  toneFilter.frequency.setValueAtTime(Math.max(800, freq * 6), now);
  toneFilter.Q.setValueAtTime(0.6, now);

  // small all-pass for mild inharmonicity (optional)
  const allpass = ctx.createBiquadFilter();
  allpass.type = 'allpass';
  allpass.frequency.setValueAtTime(Math.max(200, freq * 4), now);

  // output gain with exponential decay envelope
  const outGain = ctx.createGain();
  const initialGain = Math.max(0.02, Math.min(1.0, strength));
  outGain.gain.setValueAtTime(initialGain, now);
  // gentle decay to near 0
  outGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.4, duration));

  // route:
  // noiseSrc -> delay (seeding the loop)
  // delay -> toneFilter -> feedbackGain -> delay (loop)
  // delay -> outGain -> destination & analyser & dest
  noiseSrc.connect(delay);
  delay.connect(toneFilter);
  toneFilter.connect(feedbackGain);
  feedbackGain.connect(delay);

  // optional allpass in series for character
  feedbackGain.connect(allpass);
  allpass.connect(delay);

  // tap output from the delay into the outGain
  delay.connect(outGain);

  // connect outGain to destination and recording/analyser if available
  try { outGain.connect(ctx.destination); } catch (e) {}
  if (GUITAR.dest) try { outGain.connect(GUITAR.dest); } catch (e) {}
  if (GUITAR.analyser) try { outGain.connect(GUITAR.analyser); } catch (e) {}

  // start noise
  noiseSrc.start(now);
  // stop noise shortly after (seed only)
  noiseSrc.stop(now + 0.05);

  // schedule cleanup after decay
  const cleanupTime = (duration + 0.5) * 1000;
  const nodes = [noiseSrc, delay, feedbackGain, toneFilter, allpass, outGain];
  setTimeout(() => {
    try {
      nodes.forEach(n => {
        if (n && typeof n.disconnect === 'function') {
          try { n.disconnect(); } catch (e) {}
        }
      });
    } catch (e) { /* swallow */ }
  }, cleanupTime);
}

/* ---------- Visualizer (reuse shared analyser if present) ---------- */
function setupVisualizer() {
  GUITAR.vizCanvas = $('vizCanvas');
  if (!GUITAR.vizCanvas) return;
  GUITAR.vizCtx = GUITAR.vizCanvas.getContext('2d');
  GUITAR.vizBars = new Array(GUITAR.BAR_COUNT).fill(0);

  function resize() {
    const canvas = GUITAR.vizCanvas;
    const ctx = GUITAR.vizCtx;
    if (!canvas || !ctx) return;
    const cw = canvas.clientWidth || 600;
    const ch = canvas.clientHeight || 160;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cw * ratio));
    canvas.height = Math.max(1, Math.floor(ch * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    // ensure analyser exists (lazy init)
    if (!GUITAR.analyser) {
      try { ctxInit(); } catch (e) {}
    }
    const canvas = GUITAR.vizCanvas;
    const ctx = GUITAR.vizCtx;
    if (!canvas || !ctx || !GUITAR.analyser) {
      GUITAR.vizRAF = requestAnimationFrame(render);
      return;
    }

    const bufferLength = GUITAR.analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    GUITAR.analyser.getByteFrequencyData(data);

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const bars = GUITAR.vizBars.length;
    const slot = cw / bars;
    const bw = Math.max(3, slot * 0.68);
    const gap = Math.max(2, slot * 0.32);

    ctx.clearRect(0, 0, cw, ch);

    // update bars (log mapping)
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor(Math.pow(i / bars, 2.2) * (bufferLength - 1));
      const v = (data[idx] || 0) / 255;
      const target = Math.pow(v, 0.9) * ch * 0.9;
      GUITAR.vizBars[i] = Math.max(target, GUITAR.vizBars[i] - ch * 0.02);
    }

    // draw neon bars
    let x = gap * 0.5;
    const palette = ["#ff0080", "#7928ca", "#00f0ff", "#4b0082", "#ff2079"];
    for (let i = 0; i < bars; i++) {
      const h = GUITAR.vizBars[i];
      const y = ch - h;
      const color = palette[i % palette.length];
      ctx.shadowBlur = 12;
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, bw, h);
      ctx.shadowBlur = 0;
      x += bw + gap;
    }

    // reflection (subtle)
    const reflH = ch * 0.2;
    ctx.save();
    ctx.translate(0, ch * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.16;
    x = gap * 0.5;
    for (let i = 0; i < bars; i++) {
      const h = GUITAR.vizBars[i];
      ctx.fillStyle = palette[i % palette.length];
      ctx.fillRect(x, ch - h, bw, h);
      x += bw + gap;
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    GUITAR.vizRAF = requestAnimationFrame(render);
  }

  GUITAR.vizRAF = requestAnimationFrame(render);
}

/* ---------- UI bindings & helpers ---------- */

function activateStringEl(el) {
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 160);
}

function pluckStringElement(el) {
  if (!el) return;
  const freq = parseFloat(el.dataset.freq);
  const strength = parseFloat($('#pickStrength')?.value) || 0.9;
  const damping = parseFloat($('#damping')?.value) || 0.95;
  const duration = 3.0;
  pluck(freq, { strength, damping, duration });
  activateStringEl(el);
}

function strumAll(leftToRight = true) {
  const nodes = Array.from(document.querySelectorAll('.string'));
  if (!leftToRight) nodes.reverse();
  const step = 70; // ms between strings for a natural strum
  nodes.forEach((el, i) => {
    setTimeout(() => pluckStringElement(el), i * step);
  });
}

/* Attach events to strings and controls */
function wireUI() {
  const strings = Array.from(document.querySelectorAll('.string'));
  strings.forEach((btn, idx) => {
    btn.addEventListener('mousedown', () => {
      const strumMode = $('#strumMode')?.checked;
      if (strumMode) {
        // find if clicked string is leftmost or rightmost to determine direction
        const all = Array.from(document.querySelectorAll('.string'));
        const index = all.indexOf(btn);
        // if user clicked near rightmost string (index >= middle), strum right->left; else left->right
        const leftToRight = (index <= Math.floor(all.length / 2));
        strumAll(leftToRight);
      } else {
        pluckStringElement(btn);
      }
    });
  });

  // simple keyboard mapping (z x c v b n)
  const keyMap = { 'z': 0, 'x': 1, 'c': 2, 'v': 3, 'b': 4, 'n': 5 };
  document.addEventListener('keydown', e => {
    if (document.activeElement && ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    const idx = keyMap[e.key];
    if (idx !== undefined) {
      const el = document.querySelectorAll('.string')[idx];
      if (el) pluckStringElement(el);
    }
  });
}

/* ---------- Init on load ---------- */
window.addEventListener('load', () => {
  try { ctxInit(); } catch (e) { /* audio blocked until gesture */ }

  // setup visualizer
  setupVisualizer();

  // wire UI
  wireUI();

  // ensure default slider values
  const ps = $('#pickStrength');
  const dm = $('#damping');
  if (ps && !ps.value) ps.value = 0.9;
  if (dm && !dm.value) dm.value = 0.95;
});
