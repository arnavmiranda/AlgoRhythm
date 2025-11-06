/* synth-core.js — shared synthesis engine (Karplus–Strong + percussive synths)
   Drop into your project and include before piano.js / drums.js:
   <script src="synth-core.js"></script>
*/
(function(global){
  const SynthCore = {
    ctx: null,
    dest: null,
    analyser: null,
    sampleRate: 44100,
    _inited: false
  };

  SynthCore.ensure = function(){
    if (SynthCore._inited) return SynthCore.ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    SynthCore.ctx = new C();
    SynthCore.sampleRate = SynthCore.ctx.sampleRate || 44100;

    // destination for recording (MediaStreamDestination)
    SynthCore.dest = SynthCore.ctx.createMediaStreamDestination();

    // analyser for visualizer
    SynthCore.analyser = SynthCore.ctx.createAnalyser();
    SynthCore.analyser.fftSize = 1024;

    // route analyser to destination so visualizer sees signal (and sound still goes to output)
    // Note: we won't connect analyser directly to destination (it doesn't output), but we'll ensure we connect source nodes to both ctx.destination and analyser.
    SynthCore._inited = true;
    return SynthCore.ctx;
  };

  /* Utility: create a very short white-noise AudioBuffer */
  SynthCore._createNoiseBuffer = function(durationSec = 0.03){
    const ctx = SynthCore.ensure();
    const len = Math.max(1, Math.floor(durationSec * ctx.sampleRate));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };

  /* Karplus–Strong style pluck using DelayNode + feedback loop + lowpass filter
     freq: target frequency in Hz
     opts: {gain, decay, filterFreq, duration}
  */
  SynthCore.playPluck = function(freq, opts = {}){
    const ctx = SynthCore.ensure();
    opts = Object.assign({gain: 0.9, decay: 0.996, filterFreq: 8000, duration: 2000}, opts);

    const now = ctx.currentTime;

    // nodes
    const inputGain = ctx.createGain(); inputGain.gain.value = 1.0;
    const delay = ctx.createDelay(); // delayTime will be ~1/freq
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = opts.filterFreq;
    const feedback = ctx.createGain(); feedback.gain.value = opts.decay;

    // output gain envelope control
    const outGain = ctx.createGain(); outGain.gain.value = opts.gain;

    // connect feedback loop: delay -> filter -> feedback -> delay
    delay.connect(filter);
    filter.connect(feedback);
    feedback.connect(delay);

    // connect loop to output
    delay.connect(outGain);

    // connect outGain to destination, analyser and audio output
    outGain.connect(ctx.destination);
    outGain.connect(SynthCore.dest);
    outGain.connect(SynthCore.analyser);

    // feed a short noise burst into the delay to excite the loop
    const noiseBuffer = SynthCore._createNoiseBuffer(0.03);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = false;
    src.connect(delay); // excite the loop

    // optionally route inputGain (for external plucks)
    inputGain.connect(delay);

    src.start(now);
    // schedule gentle decay by reducing feedback over time and fading out outGain
    const stopAt = now + ((opts.duration || 2000) / 1000);
    // ramp feedback to 0.0001
    feedback.gain.setValueAtTime(feedback.gain.value, now);
    feedback.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    // fade out output
    outGain.gain.setValueAtTime(outGain.gain.value, now);
    outGain.gain.exponentialRampToValueAtTime(0.0001, stopAt + 0.05);

    // disconnect nodes after finished to avoid leaks
    setTimeout(() => {
      try {
        src.disconnect();
        delay.disconnect();
        filter.disconnect();
        feedback.disconnect();
        outGain.disconnect();
      } catch (e) {}
    }, (opts.duration || 2000) + 200);

    // set delay time to 1/freq (a small pitch-correction factor may be used)
    // clamp delay to valid range
    const maxDelay = Math.max(0.001, Math.min(1.0, 1 / Math.max(1, freq)));
    try { delay.delayTime.setValueAtTime(maxDelay, now); } catch (e) { delay.delayTime.value = maxDelay; }

    // return an object with nodes in case caller wants to tweak or stop early
    return {src, delay, filter, feedback, outGain, stopTime: stopAt};
  };

  /* ---- Enhanced Plucked-Hammer Piano Synthesis ---- */
SynthCore.playPianoLike = function(freq, opts = {}) {
  const ctx = SynthCore.ensure();
  const now = ctx.currentTime;

  // base params
  opts = Object.assign({
    strings: 3,
    detuneCents: 4,       // small detuning per string
    baseGain: 0.4,
    decay: 0.995,
    filterFreq: freq * 12,
    hammerColor: 2000,    // hammer tone brightness
    hammerDur: 0.015,     // hammer strike length
    duration: 2500
  }, opts);

  const gainNode = ctx.createGain();
  gainNode.gain.value = opts.baseGain;

  // slight stereo spread
  const panner = ctx.createStereoPanner();
  panner.pan.value = (Math.random() * 2 - 1) * 0.3;

  gainNode.connect(panner);
  panner.connect(ctx.destination);
  panner.connect(SynthCore.dest);
  panner.connect(SynthCore.analyser);

  // ---- hammer impulse ----
  const hammerBuf = SynthCore._createNoiseBuffer(opts.hammerDur);
  const hammerSrc = ctx.createBufferSource();
  hammerSrc.buffer = hammerBuf;
  const hammerFilter = ctx.createBiquadFilter();
  hammerFilter.type = 'lowpass';
  hammerFilter.frequency.value = opts.hammerColor;
  hammerSrc.connect(hammerFilter);
  hammerFilter.connect(gainNode);
  hammerSrc.start(now);
  hammerSrc.stop(now + opts.hammerDur);

  // ---- create 3 slightly detuned plucks ----
  for (let i = 0; i < opts.strings; i++) {
    const detuneFactor = Math.pow(2, (i - 1) * opts.detuneCents / 1200);
    const f = freq * detuneFactor;
    const filterFreq = Math.min(10000, opts.filterFreq);
    const decay = opts.decay - (i * 0.0005);
    const stringGain = 1.0 / opts.strings;

    const pluck = SynthCore.playPluck(f, {
      gain: stringGain,
      decay: decay,
      filterFreq: filterFreq,
      duration: opts.duration
    });

    // feed each string into our output gain node
    pluck.outGain.connect(gainNode);
  }

  // slow fade-out
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration / 1000);

  return { gainNode };
};


  /* Simple oscillator-based tone (useful for toms / debug) */
  SynthCore.playTone = function(freq, opts = {}){
    const ctx = SynthCore.ensure();
    opts = Object.assign({gain: 0.25, type: 'sine', duration: 0.6}, opts);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(opts.gain, now);
    osc.connect(g);
    g.connect(ctx.destination);
    g.connect(SynthCore.dest);
    g.connect(SynthCore.analyser);
    // envelope
    g.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);
    osc.start(now);
    osc.stop(now + opts.duration + 0.02);
    // cleanup
    setTimeout(()=>{ try{ osc.disconnect(); g.disconnect(); }catch(e){} }, (opts.duration+0.1)*1000);
    return {osc,g};
  };

  /* Kick drum: sine pitch sweep + envelope */
  SynthCore.playKick = function(opts = {}){
    const ctx = SynthCore.ensure();
    opts = Object.assign({gain: 0.9, duration: 0.5, startFreq: 150, endFreq: 40}, opts);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(opts.startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), now + opts.duration * 0.5);

    g.gain.setValueAtTime(opts.gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    osc.connect(g);
    g.connect(ctx.destination);
    g.connect(SynthCore.dest);
    g.connect(SynthCore.analyser);

    osc.start(now);
    osc.stop(now + opts.duration + 0.02);

    setTimeout(()=>{ try{ osc.disconnect(); g.disconnect(); }catch(e){} }, (opts.duration+0.1)*1000);
    return {osc,g};
  };

  /* Snare: noise burst through bandpass + short oscillator body */
  SynthCore.playSnare = function(opts = {}){
    const ctx = SynthCore.ensure();
    opts = Object.assign({noiseGain: 0.6, toneGain: 0.4, duration: 0.25}, opts);
    const now = ctx.currentTime;

    // noise burst
    const noiseBuffer = SynthCore._createNoiseBuffer(0.12);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(opts.noiseGain, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    // band-pass to give snare timbre
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;

    noiseSrc.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseGain.connect(SynthCore.dest);
    noiseGain.connect(SynthCore.analyser);

    // short oscillator body (low tone)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, now);
    oscGain.gain.setValueAtTime(opts.toneGain, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration * 0.6);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    oscGain.connect(SynthCore.dest);
    oscGain.connect(SynthCore.analyser);

    noiseSrc.start(now);
    noiseSrc.stop(now + 0.12);
    osc.start(now);
    osc.stop(now + opts.duration);

    setTimeout(()=>{ try{ noiseSrc.disconnect(); noiseGain.disconnect(); osc.disconnect(); oscGain.disconnect(); bp.disconnect(); }catch(e){} }, (opts.duration+0.2)*1000);
    return {noiseSrc, osc};
  };

  /* Hi-hat: filtered noise (closed/open variants via decay) */
  SynthCore.playHiHat = function(opts = {}){
    const ctx = SynthCore.ensure();
    opts = Object.assign({gain: 0.2, decay: 0.08, highpass: 5000}, opts);
    const now = ctx.currentTime;
    const buffer = SynthCore._createNoiseBuffer(0.06);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = opts.highpass;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 8000; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(opts.gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + opts.decay);

    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    g.connect(SynthCore.dest);
    g.connect(SynthCore.analyser);

    src.start(now);
    src.stop(now + opts.decay + 0.01);

    setTimeout(()=>{ try{ src.disconnect(); hp.disconnect(); bp.disconnect(); g.disconnect(); }catch(e){} }, (opts.decay+0.2)*1000);
    return {src};
  };

  /* Tom (short sine with medium decay) */
  SynthCore.playTom = function(freq = 120, opts = {}){
    opts = Object.assign({gain: 0.6, duration: 0.6}, opts);
    return SynthCore.playTone(freq, {gain: opts.gain, type: 'sine', duration: opts.duration});
  };

  // expose to global
  global.SynthCore = SynthCore;

})(window);
