import type {
  ResearchQueryPlan,
  ResearchSearchLanes,
  SearchLaneResult,
} from "../tools/research.js";
import { MissingConnectorConfigError, readJsonResponse } from "./errors.js";

type ResponsesApiOutput = {
  output_text?: string;
  output?: unknown[];
  citations?: unknown[];
  sources?: unknown[];
};

export class OpenAiWebSearchLane {
  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY,
    private readonly model = process.env.OPENAI_WEB_SEARCH_MODEL ?? "gpt-5",
  ) {}

  async run(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("OpenAI/Web Search lane", "OPENAI_API_KEY");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
        input: [
          {
            role: "user",
            content: buildExternalVerificationPrompt(queryPlan),
          },
        ],
      }),
    });

    const payload = await readJsonResponse<ResponsesApiOutput>("OpenAI/Web Search lane", response);

    return {
      lane: "openai_search",
      evidence: [
        {
          summary: payload.output_text ?? JSON.stringify(payload.output ?? []),
          rawOutput: payload.output,
          sources: payload.sources,
          citations: payload.citations,
        },
      ],
      warnings: [],
    };
  }
}

export class GrokXSearchLane {
  constructor(
    private readonly apiKey = process.env.XAI_API_KEY,
    private readonly model = process.env.GROK_X_SEARCH_MODEL ?? "grok-4.3",
  ) {}

  async run(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    if (!this.apiKey) {
      throw new MissingConnectorConfigError("Grok X Search lane", "XAI_API_KEY");
    }

    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        tools: [
          {
            type: "x_search",
            enable_image_understanding: true,
            enable_video_understanding: false,
          },
        ],
        input: [
          {
            role: "user",
            content: buildXSearchPrompt(queryPlan),
          },
        ],
      }),
    });

    const payload = await readJsonResponse<ResponsesApiOutput>("Grok X Search lane", response);

    return {
      lane: "x_search",
      evidence: [
        {
          summary: payload.output_text ?? JSON.stringify(payload.output ?? []),
          rawOutput: payload.output,
          sources: payload.sources,
          citations: payload.citations,
        },
      ],
      warnings: [],
    };
  }
}

export class LiveResearchSearchLanes implements ResearchSearchLanes {
  constructor(
    private readonly openAiLane = new OpenAiWebSearchLane(),
    private readonly grokLane = new GrokXSearchLane(),
  ) {}

  runOpenAiWebSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.openAiLane.run(queryPlan);
  }

  runGrokXSearch(queryPlan: ResearchQueryPlan): Promise<SearchLaneResult> {
    return this.grokLane.run(queryPlan);
  }
}

function buildExternalVerificationPrompt(queryPlan: ResearchQueryPlan): string {
  return `Verify this market claim using web sources.

Claim: ${queryPlan.normalizedClaim}
Assets: ${queryPlan.assets.join(", ")}
Topics: ${queryPlan.topics.join(", ")}

Search goals:
- Find official, regulatory, company, exchange, and reputable news sources.
- Find contradictions and refutations.
- Identify whether this is old news being recirculated.
- Return concise evidence with citations.`;
}

function buildXSearchPrompt(queryPlan: ResearchQueryPlan): string {
  return `Investigate this market narrative on X.

Claim: ${queryPlan.normalizedClaim}
X queries:
${queryPlan.xQueries.map((query) => `- ${query}`).join("\n")}

Look for:
- origin accounts or posts
- credible accounts discussing it
- refutations
- recycled screenshots or links
- social crowding
- promotional or coordinated language

X social momentum is not proof of truth.`;
}
