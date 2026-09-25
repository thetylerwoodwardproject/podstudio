/*
 * Sends a recording to the server as it's made: each finished 5 s segment, in
 * order, retrying with backoff when the network drops. Nothing is lost while
 * offline: the segments stay in this browser and go up when it's back.
 */
export interface UploadStatus {
  uploaded: number;
  /** Segments recorded but not sent yet */
  pending: number;
  /** Last failure, while retrying */
  error: string;
}

export class Uploader {
  uploaded: number;
  private busy = false;
  private error = '';
  private retryAt = 0;
  private failures = 0;
  private available: () => number;
  private send: (n: number) => Promise<void>;
  private onStatus: (s: UploadStatus) => void;

  /**
   * `available()`: how many segments exist; `send(n)`: upload segment n (1-based).
   * `from`: segments already sent (resuming).
   */
  constructor(available: () => number, send: (n: number) => Promise<void>, onStatus: (s: UploadStatus) => void = () => {}, from = 0) {
    this.available = available;
    this.send = send;
    this.onStatus = onStatus;
    this.uploaded = from;
  }

  get status(): UploadStatus {
    return { uploaded: this.uploaded, pending: Math.max(0, this.available() - this.uploaded), error: this.error };
  }

  /** Send whatever is waiting. Safe to call often. */
  async tick(now = Date.now()) {
    if (this.busy || now < this.retryAt) return;
    this.busy = true;
    try {
      while (this.uploaded < this.available()) {
        await this.send(this.uploaded + 1);
        this.uploaded++;
        this.failures = 0;
        this.error = '';
        this.onStatus(this.status);
      }
    } catch (err) {
      this.failures++;
      this.error = (err as Error).message;
      this.retryAt = now + Math.min(30000, 1000 * 2 ** (this.failures - 1));
      this.onStatus(this.status);
    } finally {
      this.busy = false;
    }
  }

  /** Keep trying until everything recorded so far is sent. */
  async flush(timeoutMs = 120000) {
    const until = Date.now() + timeoutMs;
    while (this.uploaded < this.available() && Date.now() < until) {
      this.retryAt = 0;
      await this.tick();
      if (this.uploaded < this.available()) await new Promise((r) => setTimeout(r, 1000));
    }
    return this.uploaded >= this.available();
  }
}
