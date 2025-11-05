/* piano.js */
(function(){
  const notesOrder = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const octaves = [4,5,6]; // three octaves
  const whiteSequence = ['C','D','E','F','G','A','B']; // order of white keys in an octave
  // for each octave we'll render 7 white keys (3 octaves -> 21 white keys)
  const pianoWrap = document.getElementById('pianoWrap');
  const whiteKeysEl = document.getElementById('whiteKeys');
  const blackKeysEl = document.getElementById('blackKeys');

  /* black-key horizontal offsets relative to a white key width (60px). We'll compute left positions in JS */
  const blackOffsets = {
    // within an octave: black keys sit between white keys. We'll compute left offsets per white key index
    'C#': 0.65,
    'D#': 1.65,
    'F#': 3.65,
    'G#': 4.65,
    'A#': 5.65
  };

  const whiteKeyWidth = 60;
  const whiteKeys = []; // store {el, note}

  // create white keys
  let whiteIndex = 0;
  octaves.forEach(oct => {
    whiteSequence.forEach(n => {
      const note = `${n}${oct}`;
      const w = document.createElement('div');
      w.className = 'white-key';
      w.dataset.note = note;
      w.innerHTML = `<div class="label">${note}</div>`;
      whiteKeysEl.appendChild(w);
      whiteKeys.push({el: w, note});
      whiteIndex++;
      // click
      w.addEventListener('mousedown', () => {
        onPlayNote(note);
        w.classList.add('active');
      });
      w.addEventListener('mouseup', ()=> w.classList.remove('active'));
      w.addEventListener('mouseleave', ()=> w.classList.remove('active'));
    });
  });

  // create black keys and position them absolutely (only where they exist)
  // we must compute left offset per gap from the start of white keys container
  // For sequence inside each octave, the black keys are: C#, D#, (no E#), F#, G#, A#
  let totalWhite = whiteKeys.length;
  // mapping to know where black keys go (index of the first white key in an octave)
  octaves.forEach((oct, octaveIdx) => {
    // base white key index for this octave (each octave has 7 whites)
    const base = octaveIdx * 7;
    // for each black note in this octave
    ['C#','D#','F#','G#','A#'].forEach(blackNote => {
      // the position multiplier relative to the first white key * whiteKeyWidth
      // blackOffsets above use approximate positions in white-key units
      const offsetUnits = blackOffsets[blackNote];
      // convert to pixels
      const leftPx = (base + offsetUnits) * whiteKeyWidth + 12; // 12 is piano-wrap left padding used in CSS
      const bk = document.createElement('div');
      bk.className = 'black-key';
      const note = `${blackNote}${oct}`;
      bk.dataset.note = note;
      bk.style.left = `${leftPx}px`;
      bk.innerHTML = `<div class="label">${note}</div>`;
      blackKeysEl.appendChild(bk);
      bk.addEventListener('mousedown', () => {
        onPlayNote(note);
        bk.classList.add('active');
      });
      bk.addEventListener('mouseup', ()=> bk.classList.remove('active'));
      bk.addEventListener('mouseleave', ()=> bk.classList.remove('active'));
    });
  });

  /* Keyboard mapping (simple, typical mapping) */
  const keyMap = [
    // map physical keys to notes starting from C4; this mapping is typical: z s x d c v g b h n j m , etc
    {key:'z', note:'C4'},{key:'s',note:'C#4'},{key:'x',note:'D4'},{key:'d',note:'D#4'},{key:'c',note:'E4'},{key:'v',note:'F4'},{key:'g',note:'F#4'},{key:'b',note:'G4'},{key:'h',note:'G#4'},{key:'n',note:'A4'},{key:'j',note:'A#4'},{key:'m',note:'B4'},
    // octave 5
    {key:'q', note:'C5'},{key:'2',note:'C#5'},{key:'w',note:'D5'},{key:'3',note:'D#5'},{key:'e',note:'E5'},{key:'r',note:'F5'},{key:'5',note:'F#5'},{key:'t',note:'G5'},{key:'6',note:'G#5'},{key:'y',note:'A5'},{key:'7',note:'A#5'},{key:'u',note:'B5'},
    // octave 6
    {key:'i', note:'C6'},{key:'9',note:'C#6'},{key:'o',note:'D6'},{key:'0',note:'D#6'},{key:'p',note:'E6'}
  ];
  const keyToNote = {};
  keyMap.forEach(k=> keyToNote[k.key] = k.note);

  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (keyToNote[k]) {
      const note = keyToNote[k];
      onPlayNote(note);
      // visual highlight:
      highlightKey(note, true);
    }
  });
  document.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (keyToNote[k]) highlightKey(keyToNote[k], false);
  });

  function highlightKey(note, on){
    // find white or black key with matching dataset.note
    const white = whiteKeys.find(w => w.note === note);
    if (white) {
      white.el.classList.toggle('active', on);
      return;
    }
    // black
    const bk = Array.from(document.querySelectorAll('.black-key')).find(b => b.dataset.note === note);
    if (bk) bk.classList.toggle('active', on);
  }

  /* Sound playback via WebAudio. We will attempt to load a sample from assets/piano/<NOTE>.mp3
     If not found, create an oscillator tone fallback.
  */
  async function onPlayNote(note){
    const ctx = window.appState.audioContext || (window.appState.audioContext = new (window.AudioContext || window.webkitAudioContext)());
    const dest = window.appState.dest || (window.appState.dest = ctx.createMediaStreamDestination());
    const sampleUrl = `assets/piano/${note}.mp3`; // name pattern expected

    try {
      // attempt to fetch and decode sample
      const resp = await fetch(sampleUrl, {cache:'force-cache'});
      if (!resp.ok) throw new Error('sample not found');
      const arrayBuffer = await resp.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      // connect to both destination (for recording) and destination (speakers)
      src.connect(ctx.destination);
      src.connect(dest);
      src.start();
    } catch (err) {
      // fallback oscillator (short plucky sound)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const freq = noteToFrequency(note);
      osc.frequency.value = freq;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(dest);
      osc.start();
      // quick envelope
      gain.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.stop(ctx.currentTime + 1.0);
    }

    // push into deque for later playback/undo functionality
    window.appState.deque.pushBack({note, t: Date.now()});
  }

  // helper convert note name (C4) to freq (A4 = 440)
  function noteToFrequency(note){
    // parse note
    const match = note.match(/^([A-G])(#?)(\d)$/);
    if (!match) return 440;
    const [,p, sharp, octaveStr] = match;
    const octave = parseInt(octaveStr,10);
    const semitoneMap = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
    let semis = semitoneMap[p];
    if (sharp) semis += 1;
    // calculate semitones from C0
    const noteNumber = semis + (octave * 12);
    // A4 is note number 57? Simpler: compute semitone diff from A4
    const A4noteNum = 57; // if C0 = 0, then A4 = 57
    const diff = noteNumber - A4noteNum;
    const freq = 440 * Math.pow(2, diff / 12);
    return freq;
  }

  /* Playback from deque (simple sequential playback) */
  const playbackBtn = document.getElementById('playbackBtn');
  if (playbackBtn){
    playbackBtn.addEventListener('click', async () => {
      const items = window.appState.deque.getAll();
      if (!items.length) return;
      // play them one by one with a fixed note spacing (e.g. 350ms)
      const spacing = 350;
      for (let i=0;i<items.length;i++){
        onPlayNote(items[i].note);
        await sleep(spacing);
      }
    });
  }

  function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

  // Undo / Redo simple implementation using second stack in appState
  const undoBtn = document.getElementById('undoBtn');
  const redoStack = [];
  if (undoBtn){
    undoBtn.addEventListener('click', ()=> {
      const item = window.appState.deque.popBack();
      if (item) {
        redoStack.push(item);
      }
    });
  }
  const redoBtn = document.getElementById('redoBtn');
  if (redoBtn){
    redoBtn.addEventListener('click', ()=> {
      const item = redoStack.pop();
      if (item) window.appState.deque.pushBack(item);
    });
  }
})();
