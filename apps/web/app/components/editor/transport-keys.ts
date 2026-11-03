/**
 * Keyboard guard for audio controls inside the editor: Home/End/PageUp/PageDown belong to the
 * transport (go to start/end) and must never jump a fader or pan to an extreme, and arrow keys
 * that moved the control must not also switch tracks or move the playhead.
 */
export const guardTransportKeys = {
  onKeyDownCapture: (e: React.KeyboardEvent) => {
    if (e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      e.stopPropagation();
      // hand the key to the editor's shortcut handler (it listens on window)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: false }));
    }
  },
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key.startsWith("Arrow")) e.stopPropagation();
  },
};
