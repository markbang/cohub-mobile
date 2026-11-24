import type { PaletteOverviewResponse, SpaceRecord } from "@neta-art/cohub";
import type { SpaceSessionCount } from "@/src/data/space-session-counts";

const HOUR_MS = 3_600_000;
const FIXTURE_OWNER_UUID = "1f0e0000-0000-4000-8000-000000000001";

export type FixtureSpaceKey = "finance" | "product" | "research" | "chief";

type FixtureSpaceSpec = {
  id: string;
  name: string;
  slug: string;
  /** A Space with a description shows it instead of its chat count, so most seeds leave it empty. */
  description: string | null;
  isPinned: boolean;
  /** Hours since the Space last had activity; orders the Spaces on the Spaces tab. */
  activeHours: number;
};

export const FIXTURE_SPACE_SPECS: Record<FixtureSpaceKey, FixtureSpaceSpec> = {
  finance: { id: "5a7e0000-0000-4000-8000-000000000001", name: "Finance Ops", slug: "finance-ops", description: null, isPinned: false, activeHours: 13 },
  product: { id: "5a7e0000-0000-4000-8000-000000000002", name: "Product Launch", slug: "product-launch", description: "Release checklist, copy and the sheet fixes for 2.4.", isPinned: false, activeHours: 16 },
  research: { id: "5a7e0000-0000-4000-8000-000000000003", name: "Research Notes", slug: "research-notes", description: null, isPinned: false, activeHours: 26 },
  chief: { id: "5a7e0000-0000-4000-8000-000000000004", name: "Chief of staff", slug: "cohubbot", description: null, isPinned: true, activeHours: 19 },
};

export function fixtureSpaces(now: number): SpaceRecord[] {
  return Object.values(FIXTURE_SPACE_SPECS).map((spec) => {
    const activeAt = new Date(now - spec.activeHours * HOUR_MS).toISOString();
    return {
      id: spec.id,
      userUuid: FIXTURE_OWNER_UUID,
      name: spec.name,
      slug: spec.slug,
      description: spec.description,
      title: spec.name,
      status: "active",
      meta: null,
      publicProfile: { avatarUrl: null },
      createdAt: new Date(now - 120 * 24 * HOUR_MS).toISOString(),
      updatedAt: activeAt,
      lastActivityAt: activeAt,
      isPinned: spec.isPinned,
      isArchived: false,
      relation: "owner",
    };
  });
}

export function fixtureOverview(spaces: readonly SpaceRecord[], now: number): PaletteOverviewResponse {
  return {
    generatedAt: new Date(now).toISOString(),
    spaces: spaces.map((space) => ({
      id: space.id,
      name: space.name,
      description: space.description,
      ownerProfile: null,
      spaceProfile: space.publicProfile ?? null,
      isPinned: space.isPinned === true,
      isArchived: false,
      relation: "owner",
      lastParticipatedAt: space.lastActivityAt ?? null,
      updatedAt: space.updatedAt,
    })),
  };
}

export function fixtureSpaceSessionCounts(sessionSpaceIds: readonly string[]): Record<string, SpaceSessionCount> {
  const counts: Record<string, SpaceSessionCount> = {};
  for (const spaceId of sessionSpaceIds) counts[spaceId] = { count: (counts[spaceId]?.count ?? 0) + 1, hasMore: false };
  return counts;
}
