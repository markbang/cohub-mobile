import type { AppDomainListResponse, AppDomainRecord } from "@neta-art/cohub";

export function withAppDomainResult(list: AppDomainListResponse, result: { domain: AppDomainRecord } | { removedId: string }): AppDomainListResponse {
  if ("removedId" in result) return { ...list, domains: list.domains.filter((item) => item.id !== result.removedId) };
  return { ...list, domains: [result.domain] };
}

export function appDomainParentZone(input: string): string | null {
  const labels = input.trim().toLowerCase().split(".").filter(Boolean);
  return labels.length >= 3 ? labels.slice(1).join(".") : null;
}
