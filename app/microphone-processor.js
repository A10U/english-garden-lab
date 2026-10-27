/* Capture microphone PCM without a compressed recording container. */
class EGLMicrophoneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.collecting = false;
    this.ready = false;
    this.frames = 0;
    this.limit = Math.floor(sampleRate * 14.5);
    this.batch = new Float32Array(2048);
    this.used = 0;
    this.port.onmessage = event => {
      if (event.data && event.data.type === 'start' && !this.collecting) {
        this.frames = 0;
        this.used = 0;
        this.ready = false;
        this.collecting = true;
      } else if (event.data && event.data.type === 'stop') this.stop();
    };
  }

  flush() {
    if (!this.used) return;
    const samples = this.used === this.batch.length ? this.batch : this.batch.slice(0, this.used);
    this.batch = new Float32Array(2048);
    this.used = 0;
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
  }

  stop() {
    if (!this.collecting) return;
    this.collecting = false;
    this.flush();
    this.port.postMessage({ type: 'stopped' });
  }

  process(inputs, outputs) {
    // Keep the graph running, but never play the microphone through speakers.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!this.collecting || !channels || !channels.length) return true;
    const frames = channels[0].length;
    if (frames && !this.ready) {
      this.ready = true;
      this.port.postMessage({ type: 'started' });
    }
    for (let frame = 0; frame < frames && this.collecting; frame++) {
      if (this.frames >= this.limit) { this.stop(); break; }
      let sample = 0;
      for (const channel of channels) sample += channel[frame] / channels.length;
      this.batch[this.used++] = sample;
      this.frames++;
      if (this.used === this.batch.length) this.flush();
      if (this.frames === this.limit) this.stop();
    }
    return true;
  }
}

registerProcessor('egl-microphone', EGLMicrophoneProcessor);
