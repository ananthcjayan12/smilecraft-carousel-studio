// Track every job in one user action, including jobs whose creation response
// arrives after Stop. Never abort creation fetches: that would lose their IDs.
export function createGenerationRun(cancelJob) {
  const active = new Set(), cancelling = new Map();
  const cancel = id => {
    if (!cancelling.has(id)) {
      cancelling.set(id, Promise.resolve().then(() => cancelJob(id)).finally(() => cancelling.delete(id)));
    }
    return cancelling.get(id);
  };
  return {
    stopped: false,
    stopping: false,
    async track(id) {
      active.add(id);
      if (this.stopped) await cancel(id);
    },
    finish(id) { active.delete(id); },
    async stop() {
      this.stopped = true;
      this.stopping = true;
      try {
        const results = await Promise.allSettled([...active].map(cancel));
        if (results.some(result => result.status === 'rejected')) throw Error('Could not stop every job. Click Stop again to retry.');
      } finally { this.stopping = false; }
    },
  };
}
