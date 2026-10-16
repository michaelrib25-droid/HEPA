const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export function isBarcodeDetectionSupported() {
  return 'BarcodeDetector' in window;
}

export async function startScanning(videoEl, onDetected, onError) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    onError(e);
    return () => {};
  }

  let detector;
  try {
    videoEl.srcObject = stream;
    await videoEl.play();
    detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
  } catch (e) {
    // The stream opened successfully but something after it failed — without
    // this, the camera stays on with no stop() ever handed back to release it.
    stream.getTracks().forEach((t) => t.stop());
    onError(e);
    return () => {};
  }

  let stopped = false;
  let rafId = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    stream.getTracks().forEach((t) => t.stop());
  }

  async function tick() {
    if (stopped) return;
    try {
      const barcodes = await detector.detect(videoEl);
      if (barcodes.length > 0) {
        stop();
        onDetected(barcodes[0].rawValue);
        return;
      }
    } catch (e) {
      // Transient per-frame detection errors are expected (e.g. a frame not
      // ready yet) — keep scanning rather than treating them as fatal.
    }
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
  return stop;
}
