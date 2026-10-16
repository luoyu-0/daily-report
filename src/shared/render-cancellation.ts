type ActiveTask = {cancel: () => void; canceled: boolean; done: Promise<void>; complete: () => void};

export class RenderCancellation {
  private readonly tasks = new Map<string, ActiveTask>();

  register(id: string, cancel: () => void): {complete: () => void} {
    if (this.tasks.has(id)) throw new Error('渲染任务已经在运行');
    let complete!: () => void;
    const done = new Promise<void>((resolve) => { complete = resolve; });
    this.tasks.set(id, {cancel, canceled: false, done, complete});
    return {complete: () => { this.tasks.delete(id); complete(); }};
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.canceled) return false;
    task.canceled = true;
    task.cancel();
    return true;
  }

  isCanceled(id: string): boolean { return this.tasks.get(id)?.canceled ?? false; }
  cancelAll(): void { for (const id of this.tasks.keys()) this.cancel(id); }
  async waitForAll(): Promise<void> { await Promise.all([...this.tasks.values()].map((task) => task.done)); }
}
