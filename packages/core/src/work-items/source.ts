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

/** Work-item type stamped on a run authorized by an explicit owner build request. */
export const OWNER_BUILD_WORK_ITEM_TYPE = "owner_build";

/**
 * Synthetic, recorded work item for a run the OWNER explicitly asked the
 * Coordinator to build (the chat `dispatch_build` path, AB-U5). The explicit
 * owner request both authorizes the work AND is the tracked item, so this gives
 * the run a real `source_work_item_*` reference — satisfying the `linked_issue`
 * capability gate by a recorded artifact, NOT by removing the gate. Derived from
 * the project (and, when present, the opportunity) the build belongs to so the
 * run/audit stays traceable to what authorized the code edit.
 *
 * This is created ONLY for explicit owner builds; autonomous/scheduler runs
 * never carry it and therefore still fail-close on `linked_issue` + approval.
 */
export function ownerBuildSourceWorkItem(args: {
  projectId: string;
  opportunityId?: string;
}): SourceWorkItemInput {
  const projectId = args.projectId.trim();
  const opportunityId = args.opportunityId?.trim();
  const identifier = opportunityId
    ? `owner-build/${projectId}/${opportunityId}`
    : `owner-build/${projectId}`;
  return {
    type: OWNER_BUILD_WORK_ITEM_TYPE,
    identifier,
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
