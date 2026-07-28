import catalog0 from "./quixotic.snapshot.json";
import catalog1 from "./broker-rules.snapshot.json";
import type {
  RemoteRuleSetSourceOverrideTarget,
  RuleSetBehavior,
  RuleSetCatalog,
  RuleSetCatalogSnapshot,
  RuleSetFormat,
  UnmatchedTrafficPolicy,
} from "@uni-conf/types";

type CompactRuleSetCatalog = {
  id: string;
  name: string;
  repository: {
    url: string;
    branch: string;
    commit?: string;
  };
  syncedAt: string;
  sourceProfiles: Record<
    string,
    {
      urlTemplate: string;
      format: RuleSetFormat;
      behavior: RuleSetBehavior;
      nativeTargets: RemoteRuleSetSourceOverrideTarget[];
    }
  >;
  defaultSourceSet: string;
  sourceSets: Record<
    string,
    {
      defaultSource: string;
      sources: string[];
    }
  >;
  routingGroups: Array<{
    sourceSet?: string;
    routing: {
      category?: string;
      target?: string;
      provisioning?: "foundation" | "scenario" | "optional";
      order?: number;
      activeForUnmatchedPolicies?: UnmatchedTrafficPolicy[];
    };
    rules: Array<
      | string
      | {
          id: string;
          name?: string;
          sourceSet?: string;
        }
    >;
  }>;
};

export const bundledRuleSetCatalogSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-07-28T08:22:52.796Z",
  catalogs: [
    expandRuleSetCatalog(catalog0 as CompactRuleSetCatalog),
    expandRuleSetCatalog(catalog1 as CompactRuleSetCatalog),
  ],
} as RuleSetCatalogSnapshot;

function expandRuleSetCatalog(catalog: CompactRuleSetCatalog): RuleSetCatalog {
  return {
    id: catalog.id,
    name: catalog.name,
    repositoryUrl: catalog.repository.url,
    branch: catalog.repository.branch,
    commitSha: catalog.repository.commit,
    syncedAt: catalog.syncedAt,
    items: catalog.routingGroups.flatMap((group) =>
      group.rules.map((rule) => {
        const ruleSet = typeof rule === "string" ? { id: rule } : rule;
        const sourceSetId =
          ruleSet.sourceSet ?? group.sourceSet ?? catalog.defaultSourceSet;
        const sourceSet = catalog.sourceSets[sourceSetId]!;
        return {
          id: ruleSet.id,
          name: ruleSet.name ?? ruleSet.id,
          category: group.routing.category,
          suggestedTarget: group.routing.target,
          provisioning: group.routing.provisioning,
          sortOrder: group.routing.order,
          activeForUnmatchedPolicies: group.routing.activeForUnmatchedPolicies,
          sources: sourceSet.sources.map((sourceId) => {
            const { urlTemplate, nativeTargets, ...profile } =
              catalog.sourceProfiles[sourceId]!;
            return {
              ...profile,
              sourceId,
              url: urlTemplate.replace("{id}", encodeURIComponent(ruleSet.id)),
              default: sourceId === sourceSet.defaultSource,
              nativeFor: nativeTargets,
            };
          }),
        };
      }),
    ),
  };
}
