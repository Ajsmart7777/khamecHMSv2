/**
 * True when running in a mobile WebView that supports getUserMedia.
 * Used to trigger the in-app camera dialog and avoid OS camera handoff,
 * which reloads the tab and destroys React state on Android WebView.
 */
export function isMobileWithCamera(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * True when the browser (mobile OR desktop) exposes a camera we can open
 * in-tab via getUserMedia. Snap flows use this to always prefer the
 * in-app camera over a file upload picker.
 */
export function hasInAppCamera(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !!navigator.mediaDevices?.getUserMedia;
}