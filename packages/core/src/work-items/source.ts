import type { FrontMatter } from "../registries/base.js";

export interface SourceWorkItemInput {
  type: "linear_issue" | string;
  identifier: string;
  url?: string;
}

export function linearIssueSourceWorkItem(identifier: string, url?: string): SourceWorkItemInput {
  const normalizedIdentifier = identifier.trim().toUpperCase();
  return {
    type: "linear_issue",
    identifier: normalizedIdentifier,
    ...(url ? { url } : {}),
  };
}

export function sourceWorkItemFromTriggerSource(
  triggerSource: string,
): SourceWorkItemInput | undefined {
  const linear = /^linear:\/\/issue\/([A-Z]+-\d+)$/i.exec(triggerSource.trim());
  if (!linear?.[1]) return undefined;
  return linearIssueSourceWorkItem(linear[1].toUpperCase());
}

export function sourceWorkItemFrontMatter(source?: SourceWorkItemInput): FrontMatter {
  if (!source) return {};
  return {
    source_work_item_type: source.type,
    source_work_item_id: source.identifier,
    source_work_item_url: source.url ?? "",
    ...(source.type === "linear_issue"
      ? {
          linear_identifier: source.identifier,
          linear_url: source.url ?? "",
        }
      : {}),
  };
}

export function sourceWorkItemFromFrontMatter(front: FrontMatter): SourceWorkItemInput | undefined {
  const type = front.source_work_item_type;
  const identifier = front.source_work_item_id;
  if (typeof type !== "string" || typeof identifier !== "string" || !type || !identifier) {
    return undefined;
  }
  const url = typeof front.source_work_item_url === "string" ? front.source_work_item_url : "";
  return {
    type,
    identifier,
    ...(url ? { url } : {}),
  };
}

export function sourceWorkItemLabel(front: FrontMatter): string {
  const source = sourceWorkItemFromFrontMatter(front);
  if (!source) return "(none)";
  return source.url
    ? `${source.type}:${source.identifier} (${source.url})`
    : `${source.type}:${source.identifier}`;
}
