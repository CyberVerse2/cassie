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
  openAiQueries: string[];
  xQueries: string[];
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
  const queryPlan = buildResearchQueryPlan(input.thesis);

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

export function buildResearchQueryPlan(thesis: Thesis): ResearchQueryPlan {
  const assets = thesis.mentionedAssets;
  const topicText = thesis.topics.join(" ");
  const assetText = assets.join(" ");
  const claim = thesis.claim;

  return {
    normalizedClaim: claim,
    assets,
    topics: thesis.topics,
    openAiQueries: [
      `${claim} official source ${assetText}`,
      `${claim} reputable news ${topicText}`,
      `${claim} regulatory filing exchange announcement ${assetText}`,
    ],
    xQueries: [
      `${claim} ${assetText}`,
      `${claim} refuted rumor ${assetText}`,
      `${claim} source screenshot ${topicText}`,
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
