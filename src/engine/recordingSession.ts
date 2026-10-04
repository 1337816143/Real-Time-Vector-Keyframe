/** Recording owns its capture tracks and callbacks, independently of the camera. */
export class RecordingSession {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private generation = 0;

  start(canvas: HTMLCanvasElement, onComplete: (blob: Blob) => void, onError: (error: unknown) => void) {
    if (this.recorder) return false;
    this.dispose();
    const generation = this.generation;
    let stream: MediaStream | undefined;
    try {
      if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持画布录制');
      stream = canvas.captureStream(30);
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
      this.stream = stream;
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream?.getTracks().forEach((track) => track.stop());
        if (generation !== this.generation) return;
        this.recorder = undefined;
        this.stream = undefined;
        if (chunks.length) onComplete(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }));
        else onError(new Error('录制没有生成有效视频数据'));
      };
      recorder.onerror = (event) => {
        if (generation !== this.generation) return;
        this.dispose();
        onError(event);
      };
      recorder.start(250);
      return true;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      this.dispose();
      onError(error);
      return false;
    }
  }

  isRecording() { return this.recorder?.state === 'recording'; }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  dispose() {
    this.generation += 1;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder) {
      recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
  }
}
