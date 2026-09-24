/*
 * Live session messages between screens. For now this is a BroadcastChannel,
 * so tabs and windows in the same browser stay in sync (a monitor window on a
 * second display, a producer-remote tab). The server will carry the same
 * messages over a WebSocket to other devices.
 *
 * Word indexes refer to the episode script flattened into words
 * (see scriptWords in data/mock.ts).
 */

export type SessionMessage =
  | { type: 'hello' }
  | { type: 'rec'; recording: boolean; startedAt: number; device: string; take?: string }
  | { type: 'word'; index: number; device: string }
  | { type: 'follow'; state: 'read' | 'lost' }
  | { type: 'control'; action: 'pause' | 'resume' | 'prev' | 'next' | 'goto'; word?: number };

export class Session extends EventTarget {
  private channel: BroadcastChannel;

  constructor(episodeId: string) {
    super();
    this.channel = new BroadcastChannel(`podstudio:episode:${episodeId}`);
    this.channel.onmessage = (e: MessageEvent<SessionMessage>) =>
      this.dispatchEvent(new CustomEvent<SessionMessage>(e.data.type, { detail: e.data }));
  }

  send(msg: SessionMessage) {
    this.channel.postMessage(msg);
  }

  on<T extends SessionMessage['type']>(type: T, fn: (msg: Extract<SessionMessage, { type: T }>) => void) {
    this.addEventListener(type, (e) => fn((e as CustomEvent).detail));
  }

  /**
   * Ask whether a recorder is live. Resolves with its latest status, or null
   * if nothing answers within `wait` ms.
   */
  findRecorder(wait = 600): Promise<Extract<SessionMessage, { type: 'rec' }> | null> {
    return new Promise((resolve) => {
      const done = (msg: Extract<SessionMessage, { type: 'rec' }> | null) => {
        clearTimeout(timer);
        this.removeEventListener('rec', handler);
        resolve(msg);
      };
      const handler = (e: Event) => {
        const msg = (e as CustomEvent).detail;
        if (msg.recording) done(msg);
      };
      const timer = setTimeout(() => done(null), wait);
      this.addEventListener('rec', handler);
      this.send({ type: 'hello' });
    });
  }

  close() {
    this.channel.close();
  }
}
