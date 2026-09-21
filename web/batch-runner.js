// Independent slide jobs may execute in parallel while preserving their original
// order and reporting each start/completion. One failure does not cancel siblings.
// Browser-facing and Node-testable: no DOM or network dependencies.
export async function runConcurrent(items, capacity, work, callbacks = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Provider capacity must be a positive integer.');
  const results = new Array(items.length);
  let next = 0, active = 0, completed = 0, peak = 0;
  const runners = Math.min(capacity, items.length);
  await Promise.all(Array.from({ length: runners }, async () => {
    while (next < items.length && (!callbacks.shouldContinue || callbacks.shouldContinue())) {
      const index = next++, item = items[index];
      active++;
      peak = Math.max(peak, active);
      callbacks.onStart?.({ index, item, active, completed, total: items.length, peak });
      try {
        results[index] = { status: 'fulfilled', value: await work(item, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      } finally {
        active--;
        completed++;
        callbacks.onComplete?.({ index, item, result: results[index], active, completed, total: items.length, peak });
      }
    }
  }));
  return { results, completed, peak };
}
