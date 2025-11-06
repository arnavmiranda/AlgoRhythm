const app={ctx:null,dest:null,an:null,recorder:null,chunks:[],recordings:[]};
const $=id=>document.getElementById(id);
let recStart=0,timer;

/* Audio Setup */
function ctxInit(){
  if(app.ctx)return app.ctx;
  const C=window.AudioContext||window.webkitAudioContext;
  app.ctx=new C();app.dest=app.ctx.createMediaStreamDestination();
  app.an=app.ctx.createAnalyser();app.an.connect(app.ctx.destination);
  return app.ctx;
}

/* Visualizer */
const canvas=$("vizCanvas"), c2d=canvas.getContext("2d");
function resize(){canvas.width=canvas.clientWidth*devicePixelRatio;canvas.height=canvas.clientHeight*devicePixelRatio;}
resize();window.onresize=resize;
let hue=260;
function renderViz(){
  requestAnimationFrame(renderViz);
  if(!app.an)return;
  const data=new Uint8Array(app.an.frequencyBinCount);
  app.an.getByteTimeDomainData(data);
  c2d.clearRect(0,0,canvas.width,canvas.height);
  const avg=data.reduce((a,b)=>a+Math.abs(b-128),0)/data.length;
  hue=(hue+0.5)%360;
  const amp=1.6; // amplify waveform
  c2d.lineWidth=Math.max(1.2,avg/25)*devicePixelRatio;
  const grad=c2d.createLinearGradient(0,0,canvas.width,0);
  grad.addColorStop(0,`hsl(${hue},90%,65%)`);
  grad.addColorStop(1,`hsl(${(hue+80)%360},90%,65%)`);
  c2d.strokeStyle=grad;
  c2d.beginPath();
  const slice=canvas.width/data.length;let x=0;
  for(let i=0;i<data.length;i++){
    const v=(data[i]/128-1)*amp, y=canvas.height/2+v*(canvas.height/2.2);
    i?c2d.lineTo(x,y):c2d.moveTo(x,y);x+=slice;
  }
  c2d.shadowBlur=15;c2d.shadowColor=`hsl(${hue},80%,70%)`;
  c2d.stroke();c2d.shadowBlur=0;
}
renderViz();

/* Piano */
const notes=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],octs=[4,5,6];
const w=$("whiteKeys"),b=$("blackKeys"),offset={"C#":0.65,"D#":1.65,"F#":3.65,"G#":4.65,"A#":5.65};
octs.forEach(o=>notes.forEach(n=>{
  if(!n.includes("#")){const k=document.createElement("div");
    k.className="white-key";k.textContent=n+o;k.dataset.note=n+o;
    k.onmousedown=()=>play(n+o,k);w.append(k);}
}));
octs.forEach((o,i)=>["C#","D#","F#","G#","A#"].forEach(n=>{
  const k=document.createElement("div");
  k.className="black-key";k.style.left=(12+(i*7+offset[n])*75)+"px";
  k.textContent=n+o;k.dataset.note=n+o;
  k.onmousedown=()=>play(n+o,k);b.append(k);
}));

async function play(note,el){
  const ctx=ctxInit(),dest=app.dest,an=app.an;
  try{
    const r=await fetch(`assets/piano/${note}.mp3`);if(!r.ok)throw 0;
    const a=await r.arrayBuffer(),buf=await ctx.decodeAudioData(a);
    const src=ctx.createBufferSource();src.buffer=buf;
    const g=ctx.createGain();src.connect(g);g.connect(ctx.destination);g.connect(dest);g.connect(an);
    src.start();
  }catch{
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.frequency.value=freq(note);o.connect(g);g.connect(ctx.destination);g.connect(dest);g.connect(an);
    g.gain.setValueAtTime(.25,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+.5);
    o.start();o.stop(ctx.currentTime+.6);
  }
  el.classList.add("active");setTimeout(()=>el.classList.remove("active"),150);
}
function freq(n){const m=n.match(/^([A-G])(#?)(\d)$/);if(!m)return 440;
const map={C:0,D:2,E:4,F:5,G:7,A:9,B:11};let s=map[m[1]]+(m[2]?1:0);
return 440*Math.pow(2,(s+m[3]*12-57)/12);}

/* Recording */
const recBtn=$("recordBtn"),stopBtn=$("stopBtn"),recInd=$("recIndicator"),
recTime=$("recTimer"),topbar=$("topbar");
recBtn.onclick=startRec;stopBtn.onclick=stopRec;
function startRec(){
  ctxInit();app.recorder=new MediaRecorder(app.dest.stream,{mimeType:"audio/webm"});
  app.chunks=[];app.recorder.ondataavailable=e=>app.chunks.push(e.data);
  app.recorder.onstop=saveRec;
  app.recorder.start();recStart=Date.now();
  recBtn.classList.add("recording");topbar.classList.add("recording");
  stopBtn.disabled=false;recInd.style.visibility="visible";tick();
}
function tick(){
  if(!app.recorder||app.recorder.state!=="recording")return;
  const t=Math.floor((Date.now()-recStart)/1000);
  recTime.textContent=`${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;
  timer=setTimeout(tick,500);
}
function stopRec(){
  if(app.recorder&&app.recorder.state==="recording")app.recorder.stop();
  recBtn.classList.remove("recording");topbar.classList.remove("recording");
  stopBtn.disabled=true;recInd.style.visibility="hidden";clearTimeout(timer);
}
async function saveRec(){
  const blob=new Blob(app.chunks,{type:"audio/webm"}),url=URL.createObjectURL(blob);
  const name=`Recording ${new Date().toLocaleTimeString()}`;
  app.recordings.unshift({name,url});
  renderRecs();
}

/* Render Recordings */
function renderRecs(){
  const list=$("recordingsList");list.innerHTML="";
  app.recordings.forEach((r,i)=>{
    const div=document.createElement("div");
    div.className="recording-item";
    const nameInput=document.createElement("input");
    nameInput.value=r.name;
    nameInput.onchange=()=>{r.name=nameInput.value;};
    const aud=document.createElement("audio");aud.src=r.url;aud.controls=true;
    const del=document.createElement("button");
    del.className="small-btn";del.textContent="Delete";
    del.onclick=()=>{app.recordings.splice(i,1);renderRecs();};
    div.append(nameInput,aud,del);list.append(div);
  });
}
$("clearAllBtn").onclick=()=>{if(confirm("Clear all recordings?")){app.recordings=[];renderRecs();}};

/* Collapsible Dock */
const dock=$("bottomDock"),dockHeader=$("dockHeader");
dockHeader.onclick=()=>{
  dock.classList.toggle("expanded");
  const main=$("mainSection");
  if(dock.classList.contains("expanded")) main.scrollTo({top:0,behavior:"smooth"});
};
/* --- Toggle Note Labels --- */
const toggleBtn = $("toggleLabelsBtn");
let labelsVisible = true;

toggleBtn.onclick = () => {
  labelsVisible = !labelsVisible;
  toggleBtn.classList.toggle("active", labelsVisible);

  // Show/hide all text labels on keys
  document.querySelectorAll(".white-key, .black-key").forEach(k => {
    k.textContent = labelsVisible ? k.dataset.note : "";
  });
};


