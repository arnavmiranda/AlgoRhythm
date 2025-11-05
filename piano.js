/* ----------------------
   Application logic
   - robust, defensive
   ---------------------- */

/* ---------- App State & Utilities ---------- */
const app = {
  ctx: null,
  dest: null,
  analyser: null,
  mediaRecorder: null,
  recordingChunks: [],
  recordings: [], // {id, name, dataUrl, created, duration, samples (Float32Array for waveform preview)}
  deque: [],
  redoStack: [],
  isRecording: false,
  recorderTimer: null,
  recorderStartAt: 0,
  persist: true
};

function $(id){ return document.getElementById(id); }
function now(){ return Date.now(); }
function uid(prefix='id'){ return prefix + '-' + Math.random().toString(36).slice(2,9); }
function formatTime(ms){
  const s = Math.floor(ms/1000);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

/* ---------- Audio Context + Destination ---------- */
function ensureAudioContext(){
  if (app.ctx) return app.ctx;
  const C = window.AudioContext || window.webkitAudioContext;
  app.ctx = new C();
  app.dest = app.ctx.createMediaStreamDestination(); // capture node
  app.analyser = app.ctx.createAnalyser();
  app.analyser.fftSize = 1024;
  // connect analyser to destination for visualization:
  app.analyser.connect(app.ctx.destination);
  // note: when we play sample nodes, we will connect them both to ctx.destination and app.dest (so recorder picks up)
  return app.ctx;
}

/* ---------- Visualizer ---------- */
const vizCanvas = $('vizCanvas');
const vctx = vizCanvas.getContext('2d');
function resizeViz(){
  vizCanvas.width = vizCanvas.clientWidth * devicePixelRatio;
  vizCanvas.height = vizCanvas.clientHeight * devicePixelRatio;
}
window.addEventListener('resize', resizeViz);
resizeViz();

function drawVisualizer(){
  requestAnimationFrame(drawVisualizer);
  if (!app.analyser) return;
  const bufferLength = app.analyser.frequencyBinCount;
  const data = new Uint8Array(bufferLength);
  app.analyser.getByteTimeDomainData(data);

  vctx.clearRect(0,0,vizCanvas.width,vizCanvas.height);
  vctx.lineWidth = 2 * devicePixelRatio;
  vctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2dd4bf';
  vctx.beginPath();
  const sliceWidth = vizCanvas.width / bufferLength;
  let x = 0;
  for (let i=0;i<bufferLength;i++){
    const v = (data[i] / 128.0) - 1.0;
    const y = (vizCanvas.height / 2) + v * (vizCanvas.height / 2) * 0.9;
    if (i === 0) vctx.moveTo(x,y); else vctx.lineTo(x,y);
    x += sliceWidth;
  }
  vctx.stroke();
}
drawVisualizer();

/* ---------- Recording controls (capture app audio) ---------- */
const recIndicator = $('recIndicator');
const recTimer = $('recTimer');
const recordBtn = $('recordBtn'), stopBtn = $('stopBtn'), playbackBtn = $('playbackBtn');

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
playbackBtn.addEventListener('click', playDequeAsSequence);

function updateRecorderTimer(){
  if (!app.isRecording) return;
  const elapsed = Date.now() - app.recorderStartAt;
  recTimer.textContent = formatTime(elapsed);
  app.recorderTimer = setTimeout(updateRecorderTimer, 200);
}

function startRecording(){
  try {
    ensureAudioContext();
    // create MediaRecorder from destination stream (captures nodes routed into app.dest.stream)
    const stream = app.dest.stream;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const mr = new MediaRecorder(stream, { mimeType: mime });
    app.recordingChunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) app.recordingChunks.push(e.data); };
    mr.onstop = onRecordingStop;
    mr.start();
    app.mediaRecorder = mr;
    app.isRecording = true;
    recIndicator.style.visibility = 'visible';
    $('recordBtn').disabled = true;
    $('stopBtn').disabled = false;
    app.recorderStartAt = Date.now();
    updateRecorderTimer();
  } catch (err) {
    console.error('startRecording error', err);
    alert('Could not start recording — check browser permissions and try again.');
  }
}

function stopRecording(){
  if (app.mediaRecorder && app.mediaRecorder.state === 'recording') app.mediaRecorder.stop();
  app.isRecording = false;
  recIndicator.style.visibility = 'hidden';
  $('recordBtn').disabled = false;
  $('stopBtn').disabled = true;
  if (app.recorderTimer) clearTimeout(app.recorderTimer);
}

/* called when mediaRecorder stops */
async function onRecordingStop(){
  try {
    const blob = new Blob(app.recordingChunks, { type: app.recordingChunks[0]?.type || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    // decode for waveform preview and duration
    const arrayBuffer = await blob.arrayBuffer();
    const decodeCtx = ensureAudioContext();
    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0)); // copy safety
    // derive a small sample array for waveform drawing (mono mix)
    const raw = audioBuffer.getChannelData(0);
    // downsample to ~512 samples for preview
    const preview = downsampleTo(raw, Math.min(512, raw.length));
    const rec = {
      id: uid('rec'),
      name: `Recording ${new Date().toLocaleString()}`,
      dataUrl: await blobToDataURL(blob),
      created: Date.now(),
      duration: Math.round((audioBuffer.duration || 0) * 1000),
      samples: preview
    };
    app.recordings.unshift(rec);
    renderRecordings();
    persistRecordingsIfNeeded();
  } catch (err) {
    console.error('onRecordingStop error', err);
  }
}

/* helpers */
function blobToDataURL(blob){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}
function downsampleTo(float32Array, targetLen){
  if (float32Array.length <= targetLen) return Float32Array.from(float32Array);
  const out = new Float32Array(targetLen);
  const step = float32Array.length / targetLen;
  for (let i=0;i<targetLen;i++){
    out[i] = float32Array[Math.floor(i * step)];
  }
  return out;
}

/* ---------- Persistence (localStorage) ---------- */
const PERSIST_KEY = 'algorhythm_recordings_v1';
const persistToggle = $('persistToggle');
persistToggle.addEventListener('change', e => { app.persist = persistToggle.checked; if (!app.persist) localStorage.removeItem(PERSIST_KEY); });

function persistRecordingsIfNeeded(){
  if (!app.persist) return;
  try {
    const small = app.recordings.map(r => ({
      id: r.id, name: r.name, dataUrl: r.dataUrl, created: r.created, duration: r.duration, samples: Array.from(r.samples)
    }));
    localStorage.setItem(PERSIST_KEY, JSON.stringify(small));
    $('savedCount').textContent = app.recordings.length;
  } catch (err) {
    console.warn('Persist failed', err);
  }
}
function loadPersistedRecordings(){
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    app.recordings = arr.map(r => ({...r, samples: Float32Array.from(r.samples)}));
    $('savedCount').textContent = app.recordings.length;
  } catch (err) { console.warn('load persisted', err) }
}
loadPersistedRecordings();

/* ---------- Recordings UI ---------- */
const recordingsList = $('recordingsList');
function renderRecordings(){
  recordingsList.innerHTML = '';
  app.recordings.forEach((rec, idx) => {
    const li = document.createElement('li');
    li.className = 'recording-item';
    li.draggable = true;
    li.dataset.id = rec.id;

    // left waveform canvas
    const wave = document.createElement('canvas');
    wave.className = 'record-wave';
    wave.width = 150 * devicePixelRatio;
    wave.height = 48 * devicePixelRatio;
    wave.style.width = '150px'; wave.style.height = '48px';
    drawWaveformOnCanvas(rec.samples, wave.getContext('2d'));

    const meta = document.createElement('div'); meta.className='recording-meta';
    const title = document.createElement('div'); title.className='record-title'; title.textContent = rec.name;
    const sub = document.createElement('div'); sub.className='hint'; sub.textContent = `${formatTime(rec.duration)} • ${new Date(rec.created).toLocaleString()}`;
    meta.appendChild(title); meta.appendChild(sub);

    const actions = document.createElement('div'); actions.className='record-actions';
    // play button (audio element)
    const audio = document.createElement('audio'); audio.controls = true; audio.src = rec.dataUrl; audio.style.width='180px';
    // rename
    const renameBtn = document.createElement('button'); renameBtn.className='small-btn'; renameBtn.textContent='Rename';
    renameBtn.onclick = ()=> {
      const newName = prompt('Rename recording', rec.name);
      if (newName) { rec.name = newName; persistRecordingsIfNeeded(); renderRecordings(); }
    };
    // download link
    const dl = document.createElement('a'); dl.className='small-btn'; dl.textContent='Download';
    dl.href = rec.dataUrl; dl.download = `${rec.name.replace(/\s+/g,'_')}.webm`;
    // delete
    const del = document.createElement('button'); del.className='small-btn'; del.textContent='Delete';
    del.onclick = ()=> {
      if (!confirm('Delete this recording?')) return;
      app.recordings = app.recordings.filter(r=> r.id !== rec.id);
      persistRecordingsIfNeeded(); renderRecordings();
    };
    actions.appendChild(renameBtn); actions.appendChild(dl); actions.appendChild(del);

    li.appendChild(wave);
    const rightCol = document.createElement('div'); rightCol.style.display='flex'; rightCol.style.flexDirection='column'; rightCol.style.gap='8px';
    rightCol.appendChild(meta); rightCol.appendChild(audio);
    li.appendChild(rightCol);
    li.appendChild(actions);

    // drag handlers for reorder
    li.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', rec.id);
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', e => { li.classList.remove('dragging') });

    li.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    li.addEventListener('drop', e => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetId = rec.id;
      reorderRecordings(draggedId, targetId);
    });

    recordingsList.appendChild(li);
  });
  $('savedCount').textContent = app.recordings.length;
}

/* waveform render */
function drawWaveformOnCanvas(samples, ctx){
  // samples: Float32Array [-1..1]
  ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2dd4bf';
  ctx.beginPath();
  const w = ctx.canvas.width; const h = ctx.canvas.height;
  const len = samples.length;
  for (let i=0;i<len;i++){
    const x = (i/len) * w;
    const y = (0.5 + samples[i] * 0.45) * h;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}

/* reorder helper */
function reorderRecordings(draggedId, targetId){
  const draggedIdx = app.recordings.findIndex(r => r.id === draggedId);
  const targetIdx = app.recordings.findIndex(r => r.id === targetId);
  if (draggedIdx < 0 || targetIdx < 0) return;
  const [moved] = app.recordings.splice(draggedIdx,1);
  app.recordings.splice(targetIdx,0,moved);
  persistRecordingsIfNeeded();
  renderRecordings();
}

/* clear all */
$('clearAllBtn').addEventListener('click', ()=> {
  if (!confirm('Clear all recordings?')) return;
  app.recordings = [];
  persistRecordingsIfNeeded();
  renderRecordings();
});

/* ---------- Piano Rendering & Playback ---------- */
const whiteSequence = ['C','D','E','F','G','A','B'];
const octaves = [4,5,6]; // 3 octaves
const whiteKeysEl = $('whiteKeys'), blackKeysEl = $('blackKeys');
const whiteKeyWidth = 60;

/* black offsets relative to the first white key in an octave (in white-key units) */
const blackOffsets = {'C#':0.65,'D#':1.65,'F#':3.65,'G#':4.65,'A#':5.65};

let whiteKeyElems = [];

function buildPiano(){
  whiteKeysEl.innerHTML = '';
  blackKeysEl.innerHTML = '';
  whiteKeyElems = [];

  octaves.forEach((oct, oi) => {
    whiteSequence.forEach(n => {
      const note = `${n}${oct}`;
      const w = document.createElement('div'); w.className='white-key'; w.dataset.note = note;
      const lbl = document.createElement('div'); lbl.className='label'; lbl.textContent = note;
      const vel = document.createElement('div'); vel.className='vel-bar';
      w.appendChild(lbl); w.appendChild(vel);
      whiteKeysEl.appendChild(w);
      whiteKeyElems.push({el:w,note});
      // pointer events
      w.addEventListener('mousedown', async e => { e.preventDefault(); await playNote(note); activateKey(w,true); });
      w.addEventListener('mouseup', ()=> activateKey(w,false));
      w.addEventListener('mouseleave', ()=> activateKey(w,false));
    });
  });

  // black keys (absolute positioning)
  octaves.forEach((oct, octaveIdx) => {
    const base = octaveIdx * 7;
    ['C#','D#','F#','G#','A#'].forEach(bkName => {
      const leftPx = (base + (blackOffsets[bkName] || 0)) * whiteKeyWidth + 12; // 12px padding
      const bk = document.createElement('div'); bk.className='black-key'; bk.dataset.note = `${bkName}${oct}`; bk.style.left = leftPx + 'px';
      const lbl = document.createElement('div'); lbl.className='label'; lbl.textContent = `${bkName}${oct}`;
      bk.appendChild(lbl);
      blackKeysEl.appendChild(bk);
      bk.addEventListener('mousedown', async e => { e.preventDefault(); await playNote(bk.dataset.note); activateKey(bk,true); });
      bk.addEventListener('mouseup', ()=> activateKey(bk,false));
      bk.addEventListener('mouseleave', ()=> activateKey(bk,false));
    });
  });
}
buildPiano();

/* key activation */
function activateKey(elem,on){
  elem.classList.toggle('active', !!on);
  // velocity effect: animate vel-bar if present
  const vel = elem.querySelector('.vel-bar');
  if (vel){
    if (on){
      vel.style.height = (20 + Math.random()*80) + 'px';
      setTimeout(()=> vel.style.height = '0px', 220);
    } else {
      vel.style.height = '0px';
    }
  }
}

/* keyboard mapping (z s x d ...) - common layout */
const keyMap = [
  {k:'z',n:'C4'},{k:'s',n:'C#4'},{k:'x',n:'D4'},{k:'d',n:'D#4'},{k:'c',n:'E4'},{k:'v',n:'F4'},{k:'g',n:'F#4'},{k:'b',n:'G4'},{k:'h',n:'G#4'},{k:'n',n:'A4'},{k:'j',n:'A#4'},{k:'m',n:'B4'},
  {k:'q',n:'C5'},{k:'2',n:'C#5'},{k:'w',n:'D5'},{k:'3',n:'D#5'},{k:'e',n:'E5'},{k:'r',n:'F5'},{k:'5',n:'F#5'},{k:'t',n:'G5'},{k:'6',n:'G#5'},{k:'y',n:'A5'},{k:'7',n:'A#5'},{k:'u',n:'B5'},
  {k:'i',n:'C6'},{k:'9',n:'C#6'},{k:'o',n:'D6'},{k:'0',n:'D#6'},{k:'p',n:'E6'}
];
const keyToNote = {}; keyMap.forEach(x=> keyToNote[x.k] = x.n);
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (!keyToNote[k]) return;
  const note = keyToNote[k];
  playNote(note);
  // highlight
  const matchWhite = whiteKeyElems.find(w => w.note === note);
  if (matchWhite) activateKey(matchWhite.el,true);
  const matchBlack = document.querySelector(`.black-key[data-note="${note}"]`);
  if (matchBlack) activateKey(matchBlack,true);
});
document.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (!keyToNote[k]) return;
  const note = keyToNote[k];
  const matchWhite = whiteKeyElems.find(w => w.note === note);
  if (matchWhite) activateKey(matchWhite.el,false);
  const matchBlack = document.querySelector(`.black-key[data-note="${note}"]`);
  if (matchBlack) activateKey(matchBlack,false);
});

/* playback: attempt to load sample from assets/piano/<NOTE>.mp3 (if not, oscillator) */
async function playNote(note){
  const ctx = ensureAudioContext();
  const dest = app.dest;
  const analyser = app.analyser;
  // try sample
  const sampleUrl = `assets/piano/${note}.mp3`;
  try {
    const resp = await fetch(sampleUrl, {method:'GET', cache:'force-cache'});
    if (!resp.ok) throw new Error('no sample');
    const arrayBuf = await resp.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.value = 1.0;
    src.connect(gain); gain.connect(ctx.destination); gain.connect(dest); // hear + record
    // also connect a splitter to analyser for visualization
    gain.connect(analyser);
    src.start();
  } catch (err) {
    // oscillator fallback (short pluck)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = noteToFrequency(note);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.value = 0.0001;
    osc.connect(gain); gain.connect(ctx.destination); gain.connect(dest);
    gain.connect(analyser);
    const nowt = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.6, nowt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, nowt + 0.6);
    osc.start(nowt);
    osc.stop(nowt + 1.0);
  }

  // record note in deque
  app.deque.push({note, t: Date.now()});
  $('dequeSize').textContent = app.deque.length;
  // clear redo stack when new input
  app.redoStack = [];
}

/* helper: note to frequency (A4=440) */
function noteToFrequency(note){
  const m = note.match(/^([A-G])(#?)(\d)$/);
  if (!m) return 440;
  const [, p, sharp, oct] = m;
  const octave = parseInt(oct,10);
  const semitoneMap = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  let semis = semitoneMap[p];
  if (sharp) semis += 1;
  const noteNumber = semis + (octave * 12);
  const A4 = 57;
  const diff = noteNumber - A4;
  return 440 * Math.pow(2, diff/12);
}

/* ---------- Playback from deque ---------- */
function playDequeAsSequence(){
  if (!app.deque.length) return;
  // disable button while playing
  playbackBtn.disabled = true;
  const spacing = 320; // ms between notes
  let i = 0;
  const playNext = async () => {
    if (i >= app.deque.length) { playbackBtn.disabled = false; return; }
    const item = app.deque[i];
    await playNote(item.note);
    i++;
    setTimeout(playNext, spacing);
  };
  playNext();
}

/* undo/redo */
$('undoBtn').addEventListener('click', () => {
  const item = app.deque.pop();
  if (item) app.redoStack.push(item);
  $('dequeSize').textContent = app.deque.length;
});
$('redoBtn').addEventListener('click', () => {
  const item = app.redoStack.pop();
  if (item) app.deque.push(item);
  $('dequeSize').textContent = app.deque.length;
});

/* ---------- Theme switch ---------- */
$('themeSelect').addEventListener('change', e => {
  const v = e.target.value;
  if (v === 'purple') document.documentElement.style.setProperty('--accent', '#a78bfa');
  else if (v === 'orange') document.documentElement.style.setProperty('--accent', '#fb923c');
  else document.documentElement.style.setProperty('--accent', '#2dd4bf');
});

/* ---------- Show notes toggle ---------- */
$('showLabels').addEventListener('change', (e) => {
  const show = e.target.checked;
  document.querySelectorAll('.white-key .label, .black-key .label').forEach(el => el.style.display = show ? 'block' : 'none');
});
document.querySelectorAll('.white-key .label, .black-key .label').forEach(el => el.style.display = $('showLabels').checked ? 'block' : 'none');

/* ---------- Velocity toggle (for aesthetics) ---------- */
$('showVelocity').addEventListener('change', e => {
  const show = e.target.checked;
  document.querySelectorAll('.vel-bar').forEach(v => v.style.display = show ? 'block' : 'none');
});
document.querySelectorAll('.vel-bar').forEach(v => v.style.display = $('showVelocity').checked ? 'block' : 'none');

/* ---------- Load persisted recordings UI on startup ---------- */
renderRecordings();

/* ---------- Load sample note labels display initially ---------- */
document.querySelectorAll('.black-key .label').forEach(l => l.style.display = $('showLabels').checked ? 'block' : 'none');

/* ---------- Auto-save toggle handler (persistToggle already wired earlier) ---------- */

/* ---------- Utility: Draw initial empty recordings area if none ---------- */
if (!app.recordings.length) {
  recordingsList.innerHTML = `<div style="color:var(--muted);padding:10px">No recordings yet — hit Record to start.</div>`;
}

/* ensure we render persisted list after loaded */
renderRecordings();
