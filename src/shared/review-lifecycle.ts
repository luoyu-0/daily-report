type LifecycleOptions = {closeGraceMs: number; heartbeatTtlMs: number; startupGraceMs: number};

export class ReviewLifecycle {
  private readonly sessions = new Map<string, number>();
  private readonly startedAt = Date.now();
  private closeAt: number | undefined;
  private everConnected = false;
  private stopping = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly stop: () => void, private readonly options: LifecycleOptions = {
    closeGraceMs: 8000, heartbeatTtlMs: 90000, startupGraceMs: 120000,
  }) {
    this.timer = setInterval(() => this.check(), 1000);
    this.timer.unref?.();
  }

  ping(id: string): void {
    if (this.stopping) return;
    this.everConnected = true;
    this.sessions.set(id, Date.now());
    this.closeAt = undefined;
  }

  leave(id: string): void {
    this.sessions.delete(id);
    if (!this.sessions.size) this.closeAt = Date.now() + this.options.closeGraceMs;
  }

  private check(): void {
    const now = Date.now();
    for (const [id, lastSeen] of this.sessions) {
      if (now - lastSeen >= this.options.heartbeatTtlMs) this.sessions.delete(id);
    }
    if (!this.sessions.size) {
      this.closeAt ??= (this.everConnected ? now : Math.max(now, this.startedAt + this.options.startupGraceMs)) + this.options.closeGraceMs;
      if (now >= this.closeAt && !this.stopping) {
        this.stopping = true;
        this.stop();
      }
    }
  }

  dispose(): void { clearInterval(this.timer); }
}
