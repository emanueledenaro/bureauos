import type { CoordinatorMessageRecord } from "./api";

export function lastOwnerMessage(
  messages: CoordinatorMessageRecord[],
): CoordinatorMessageRecord | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "owner") return messages[i];
  }
  return undefined;
}

/** Messages strictly before `id` — used by Edit (drop the edited turn and all replies after it). */
export function truncateBefore(
  messages: CoordinatorMessageRecord[],
  id: string,
): CoordinatorMessageRecord[] {
  const index = messages.findIndex((m) => m.id === id);
  return index === -1 ? messages : messages.slice(0, index);
}

/** Messages up to and including the last owner turn — used by Regenerate (drop trailing coordinator replies). */
export function truncateToLastOwnerInclusive(
  messages: CoordinatorMessageRecord[],
): CoordinatorMessageRecord[] {
  let lastOwner = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "owner") {
      lastOwner = i;
      break;
    }
  }
  return lastOwner === -1 ? [] : messages.slice(0, lastOwner + 1);
}
