import { EVENT_STORE, STORE } from '../dataStore';
import type { Event, UnresolvedInterval } from '../schema';
import type { ValidatedAtomicWriteTransaction } from '../writes/executeAtomicWrite';

/** 普通计时写入口不得绕过 pending UnresolvedInterval 的恢复流程。 */
export async function assertSessionHasNoPendingRecovery(
  transaction: ValidatedAtomicWriteTransaction,
  sessionId: string,
): Promise<void> {
  const [events, intervals] = await Promise.all([
    transaction.getAll<Event>(EVENT_STORE),
    transaction.getAll<UnresolvedInterval>(STORE.unresolvedIntervals),
  ]);
  const pendingIds = new Set(
    intervals.filter(({ status }) => status === 'pending').map(({ id }) => id),
  );
  const recoveryPending = events.some(
    (event) =>
      event.type === 'interval.detected'
      && event.sessionId === sessionId
      && event.unresolvedIntervalId !== null
      && pendingIds.has(event.unresolvedIntervalId),
  );
  if (recoveryPending) {
    throw new Error('该 Session 已进入恢复流程，普通计时写入口不可继续');
  }
}
