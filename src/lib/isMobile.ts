
/**
 * True when the browser (mobile OR desktop) exposes a camera we can open
 * in-tab via getUserMedia. Snap flows use this to always prefer the
 * in-app camera over a file upload picker.
 */
export function hasInAppCamera(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !!navigator.mediaDevices?.getUserMedia;
}