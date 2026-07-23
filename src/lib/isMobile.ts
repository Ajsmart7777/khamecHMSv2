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