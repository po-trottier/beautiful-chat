import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { View, StyleSheet } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import { TaskList } from "./task-list";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { noteTimelineItem, useIsTimelineTail } from "../timeline-tail";
import type { TaskItemData, TaskListData } from "../../shared/contracts";
import { useEnhancerPreferences } from "../preferences";

/**
 * The newest checklist per agent, drawn as one card under the newest plugin
 * item, the way the OMP TUI keeps its todo list at the bottom.
 *
 * Every OMP `todo` call arrives as new timeline items that each carry the
 * whole list, so drawing each one repeats the list once per update. The todo
 * transformer therefore drops those items: an empty plugin item would still
 * get the host's row gap. This store reads the list from the agent's own
 * timeline instead, so the card also works when the update that set it has
 * scrolled out of the virtualized list.
 */
interface AgentChecklist {
  /** The newest list and when it arrived. */
  checklist: { at: number; data: TaskListData } | null;
  /** When the newest prompt arrived. A finished list is not carried past it. */
  promptAt: number;
}

const EMPTY: AgentChecklist = { checklist: null, promptAt: 0 };
const state = new Map<string, AgentChecklist>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toTaskListData(items: unknown): TaskListData {
  const tasks: TaskItemData[] = (Array.isArray(items) ? items : []).map((raw, idx) => {
    const task = (raw ?? {}) as Record<string, unknown>;
    return {
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      title: typeof task.text === "string" ? task.text : "Untitled task",
      phase: "Execution",
      status: task.completed === true ? "completed" : task.status === "in_progress" ? "in_progress" : "pending",
    };
  });
  return { id: "live-todo", phaseName: "Checklist Progress", tasks };
}

/** Records one timeline item of `agentId`. Older items never replace newer ones. */
function noteItem(agentId: string, item: { type: string; items?: unknown }, timestamp: string): void {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return;
  const current = state.get(agentId) ?? EMPTY;
  let next: AgentChecklist | null = null;
  if (item.type === "todo" && (!current.checklist || at > current.checklist.at)) {
    next = { ...current, checklist: { at, data: toTaskListData(item.items) } };
  } else if (item.type === "user_message" && at > current.promptAt) {
    next = { ...current, promptAt: at };
  }
  if (!next) return;
  state.set(agentId, next);
  for (const listener of listeners) listener();
}

const PAGE = 200;
// ponytail: a list set more than this many pages back is not found; raise it if long sessions lose their card.
const MAX_PAGES = 5;

/** Reads pages back from the tail until a list turns up. */
async function backfill(paseo: PaseoApi, agentId: string, live: () => boolean): Promise<void> {
  const timeline = paseo.agents.ref(agentId).timeline;
  let page = await timeline.refetch({ direction: "tail", limit: PAGE });
  // Stop on a list this scan found. The cache can hold an older list from
  // before the feed was released, and stopping on that would keep it.
  for (let pages = 1, found = false; live(); pages++) {
    for (const entry of page.entries) {
      noteItem(agentId, entry.item, entry.timestamp);
      if (entry.item.type === "todo") found = true;
    }
    if (found || !page.hasOlder || !page.startCursor || pages >= MAX_PAGES) return;
    page = await timeline.refetch({ direction: "before", cursor: page.startCursor, limit: PAGE });
  }
}

interface Feed {
  users: number;
  stop: () => void;
}

const feeds = new Map<string, Feed>();

/** Starts the agent's feed on its first reader and stops it after its last. */
function acquireFeed(paseo: PaseoApi, agentId: string): () => void {
  let feed = feeds.get(agentId);
  if (!feed) {
    let live = true;
    const isLive = () => live;
    const timeline = paseo.agents.ref(agentId).timeline;
    void backfill(paseo, agentId, isLive).catch(() => {});
    const release = timeline.subscribe((event) => {
      if (event.event.type === "replacement") {
        state.delete(agentId);
        void backfill(paseo, agentId, isLive).catch(() => {});
      } else if (event.event.type === "timeline" && "timestamp" in event) {
        noteItem(agentId, event.event.item, event.timestamp);
      }
    });
    const created: Feed = {
      users: 0,
      stop: () => {
        live = false;
        release();
      },
    };
    feed = created;
    feeds.set(agentId, created);
  }
  feed.users += 1;
  const owned = feed;
  return () => {
    owned.users -= 1;
    if (owned.users > 0) return;
    owned.stop();
    feeds.delete(agentId);
  };
}

function useAgentChecklist(agentId: string): AgentChecklist {
  const paseo = usePaseo();
  useEffect(() => acquireFeed(paseo, agentId), [paseo, agentId]);
  const read = useCallback(() => state.get(agentId) ?? EMPTY, [agentId]);
  return useSyncExternalStore(subscribe, read, read);
}

const styles = StyleSheet.create({
  container: { marginTop: 6 },
});

interface TimelineTailChecklistProps {
  agentId: string;
  tokens: ExtendedThemeTokens;
  /** The item drawing this, so only the newest one shows the card. */
  itemKey: string;
  /** That item's own timestamp: the tail is whichever arrived last. */
  at: number;
}

/**
 * The live checklist under the newest plugin item of its agent. A list with
 * open tasks always follows the tail. A finished list stays until the next
 * prompt, so it is not repeated under later turns. With `liveChecklist` off
 * the todo items draw in place instead, and no feed is opened.
 */
export function TimelineTailChecklist(props: TimelineTailChecklistProps) {
  return useEnhancerPreferences().liveChecklist ? <TailChecklist {...props} /> : null;
}

function TailChecklist({ agentId, tokens, itemKey, at }: TimelineTailChecklistProps) {
  useEffect(() => {
    noteTimelineItem(agentId, itemKey, at);
  }, [agentId, itemKey, at]);

  const isTail = useIsTimelineTail(agentId, itemKey);
  const { checklist, promptAt } = useAgentChecklist(agentId);

  if (!isTail || !checklist || checklist.data.tasks.length === 0) return null;
  const finished = checklist.data.tasks.every((task) => task.status === "completed");
  if (finished && promptAt > checklist.at) return null;

  return (
    <View style={styles.container}>
      <TaskList data={checklist.data} tokens={tokens} />
    </View>
  );
}
