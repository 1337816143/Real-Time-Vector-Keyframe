/** Owns one camera session, including requests which finish after replacement/exit. */
export class CameraSession {
  private generation = 0;
  private disposed = false;
  private stream?: MediaStream;
  private video?: HTMLVideoElement;

  private release(stream?: MediaStream) {
    stream?.getTracks().forEach((track) => track.stop());
    if (stream && this.video?.srcObject === stream) this.video.srcObject = null;
    if (this.stream === stream) this.stream = undefined;
  }

  async start(
    video: HTMLVideoElement,
    mode: 'user' | 'environment',
    onStatus: (status: 'loading' | 'ready' | 'error', message: string) => void,
  ) {
    if (this.disposed) return;
    const request = ++this.generation;
    this.release(this.stream);
    this.video = video;
    const current = () => !this.disposed && request === this.generation;
    onStatus('loading', 'Requesting camera access…');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 }, height: { ideal: 720 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
      if (!current()) { this.release(stream); return; }
      this.stream = stream;
      video.srcObject = stream;
      await video.play();
      if (!current()) { this.release(stream); return; }
      onStatus('ready', 'Camera ready');
    } catch (error) {
      this.release(stream);
      if (!current()) return;
      onStatus('error', error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Enable camera access and reload the Studio.'
        : 'Unable to open the camera. It may be unavailable or in use by another app.');
    }
  }

  dispose() {
    this.disposed = true;
    this.generation += 1;
    this.release(this.stream);
    this.video = undefined;
  }
}
