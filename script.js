/* script.js — shared logic: Deque + recording that captures audioContext output */
class Deque {
  constructor(){ this.items = []; }
  pushBack(item){ this.items.push(item); }
  pushFront(item){ this.items.unshift(item); }
  popBack(){ return this.items.pop(); }
  popFront(){ return this.items.shift(); }
  peekBack(){ return this.items[this.items.length-1]; }
  peekFront(){ return this.items[0]; }
  clear(){ this.items = []; }
  getAll(){ return this.items.slice(); }
  size(){ return this.items.length; }
}

window.appState = {
  deque: new Deque(),
  recordings: [],
  audioContext: null,
  dest: null,
  mediaRecorder: null
};

/* Initialize AudioContext and destination for recording app output */
exportAsyncAudioContext();

function exportAsyncAudioContext(){
  if (!window.appState.audioContext){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    window.appState.audioContext = new Ctx();
    window.appState.dest = window.appState.audioContext.createMediaStreamDestination();
    // connect destination to context.destination only if you want both playback and audible output,
    // we will connect per-source nodes to BOTH context.destination and dest as needed in piano.js
  }
}

/* recording controls */
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const recordingsList = document.getElementById('recordingsList');

if (recordBtn && stopBtn && recordingsList) {
  recordBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
}

function startRecording(){
  exportAsyncAudioContext();
  const ctx = window.appState.audioContext;
  const dest = window.appState.dest;

  if (!dest) {
    console.error('No recording destination available');
    return;
  }

  // create MediaRecorder from the dest stream (captures anything routed into dest)
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const mr = new MediaRecorder(dest.stream, { mimeType: mime });

  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const entry = { url, blob, created: Date.now() };
    window.appState.recordings.push(entry);
    addRecordingToList(entry);
  };

  mr.start();
  window.appState.mediaRecorder = mr;
  recordBtn.disabled = true;
  stopBtn.disabled = false;
}

function stopRecording(){
  const mr = window.appState.mediaRecorder;
  if (mr && mr.state === 'recording') mr.stop();
  window.appState.mediaRecorder = null;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
}

/* UI helper to append a saved recording */
function addRecordingToList(entry){
  const li = document.createElement('li');
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = entry.url;
  const actions = document.createElement('div');
  actions.className = 'recording-actions';
  const dl = document.createElement('a');
  dl.href = entry.url;
  dl.download = `AlgoRhythms-recording-${new Date(entry.created).toISOString()}.webm`;
  dl.textContent = 'Download';
  actions.appendChild(dl);

  li.appendChild(audio);
  li.appendChild(actions);
  recordingsList.appendChild(li);
}
