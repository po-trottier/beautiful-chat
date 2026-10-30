import { useCallback, useSyncExternalStore } from "react";

/**
 * Which plugin timeline item is currently last, per agent.
 *
 * A running-jobs card or a live checklist belongs under the newest thing on
 * screen, and a plugin renderer knows only its own item — the host hands it
 * no position. So each item reports the moment it was first projected, and
 * the highest moment wins. Projection is cached per source item, so that
 * moment is the item's arrival time and does not move when the list
 * re-renders or a row scrolls back in. Each agent has its own tail, so two
 * chats open side by side each keep their cards.
 */
interface Tail {
  key: string;
  at: number;
}

const tails = new Map<string, Tail>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Records an item's arrival. A later arrival takes the tail; ties keep the incumbent. */
export function noteTimelineItem(agentId: string, key: string, at: number): void {
  const tail = tails.get(agentId);
  if (tail && (at < tail.at || (at === tail.at && key !== tail.key))) return;
  if (tail && tail.key === key && tail.at === at) return;
  tails.set(agentId, { key, at });
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while this item is the newest one the plugin has drawn for `agentId`. */
export function useIsTimelineTail(agentId: string, key: string): boolean {
  const getSnapshot = useCallback(() => tails.get(agentId)?.key === key, [agentId, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
