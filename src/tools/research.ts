import type { StructuredAiClient } from "../ai.ts";
import {
  ResearchReportSchema,
  type ResearchEvidence,
  type ResearchReport,
  type SourcePost,
  type Thesis,
} from "../schemas.ts";
import { researchSynthesisPrompt } from "../prompts.ts";

export type ResearchAngle = "balanced" | "critic" | "counter";

export interface SearchLaneResult {
  lane: "openai_search" | "x_search";
  evidence: ResearchEvidence[];
  warnings: string[];
}

export interface ResearchSearchLanes {
  runOpenAiWebSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult>;
  runGrokXSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult>;
}

export interface ResearchQueryPlan {
  normalizedClaim: string;
  assets: string[];
  topics: string[];
  sourceHandle: string | null;
  sourceName: string | null;
  openAiQueries: string[];
  xQueries: string[];
  sourceReputationQueries: string[];
  entityResolutionQueries: string[];
  personDossierQueries: string[];
  projectDossierQueries: string[];
  socialGraphQueries: string[];
  ecosystemQueries: string[];
  contradictionQueries: string[];
}

export async function researchThesis(input: {
  ai: StructuredAiClient;
  lanes: ResearchSearchLanes;
  sourcePost: SourcePost;
  userCommand: string;
  thesis: Thesis;
  researchAngle: ResearchAngle;
}): Promise<ResearchReport> {
  const queryPlan = buildResearchQueryPlan(input.thesis, input.sourcePost);

  const [openAiResult, xResult] = await Promise.allSettled([
    input.lanes.runOpenAiWebSearch(queryPlan),
    input.lanes.runGrokXSearch(queryPlan),
  ]);

  return input.ai.generateObject({
    schema: ResearchReportSchema,
    name: "cassie_research_report",
    prompt: researchSynthesisPrompt({
      sourcePost: input.sourcePost,
      userCommand: input.userCommand,
      extractedThesis: input.thesis,
      mode: "deep",
      researchAngle: input.researchAngle,
      queryPlan,
      laneResults: {
        openAiResult: settledPayload(openAiResult),
        xResult: settledPayload(xResult),
      },
    }),
  });
}

export function buildResearchQueryPlan(thesis: Thesis, sourcePost?: SourcePost): ResearchQueryPlan {
  const assets = thesis.mentionedAssets;
  const topicText = thesis.topics.join(" ");
  const assetText = assets.join(" ");
  const claim = thesis.claim;
  const sourceHandle = sourcePost?.authorHandle ?? null;
  const sourceName = sourcePost?.authorName ?? null;
  const sourceIdentity = [sourceHandle ? `@${sourceHandle}` : "", sourceName ?? ""].filter(Boolean).join(" ");
  const entityText = assets.length > 0 ? assets.join(" ") : claim;

  return {
    normalizedClaim: claim,
    assets,
    topics: thesis.topics,
    sourceHandle,
    sourceName,
    openAiQueries: [
      `${claim} official source ${assetText}`,
      `${claim} reputable news ${topicText}`,
      `${claim} regulatory filing exchange announcement ${assetText}`,
      `${entityText} founder team product`,
      `${entityText} project app protocol product`,
    ],
    xQueries: [
      `${claim} ${assetText}`,
      `${claim} refuted rumor ${assetText}`,
      `${claim} source screenshot ${topicText}`,
      `${entityText} founder team project`,
      `${entityText} app protocol product ecosystem`,
    ],
    sourceReputationQueries: [
      sourceIdentity ? `${sourceIdentity} reputation founder operator builder product` : `${claim} source reputation`,
      sourceHandle ? `@${sourceHandle} prior work products credibility` : `${claim} author credibility`,
    ],
    entityResolutionQueries: [
      `${entityText} official website`,
      `${entityText} founder team official`,
      `${entityText} Twitter X social profile`,
    ],
    personDossierQueries: [
      `${entityText} founder profile prior work`,
      `${entityText} team founder social posts`,
      `${entityText} founder X profile`,
    ],
    projectDossierQueries: [
      `${entityText} docs GitHub contracts demo`,
      `${entityText} product launch users traction`,
      `${entityText} official app protocol`,
    ],
    socialGraphQueries: [
      sourcePost?.url ? `${sourcePost.url} replies likes reposts notable accounts` : `${claim} notable replies likes reposts`,
      `${entityText} smart followers investors builders replies`,
    ],
    ecosystemQueries: [
      `${entityText} ecosystem community app`,
      `${entityText} social profile community posts`,
      `${entityText} mini app ecosystem profile`,
    ],
    contradictionQueries: [
      `${claim} false refuted`,
      `${claim} no primary source`,
      `${claim} old news recirculated`,
    ],
  };
}

function settledPayload<T>(result: PromiseSettledResult<T>) {
  if (result.status === "fulfilled") {
    return { status: "fulfilled", value: result.value };
  }

  return {
    status: "rejected",
    reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}
