import type { ModelMessage, SystemModelMessage } from "ai";

export function openRouterProviderPreferences() {
  return {
    allow_fallbacks: true,
    require_parameters: true,
    ignore: ["AkashML"],
  };
}

export function openRouterProviderOptions() {
  return {
    openrouter: {
      provider: openRouterProviderPreferences(),
    },
  };
}

export function openRouterCacheablePrompt(prompt: string): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: prompt,
          providerOptions: {
            openrouter: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
      ],
    },
  ];
}

export function openRouterCacheableSystemMessage(content: string): SystemModelMessage {
  return {
    role: "system",
    content,
    providerOptions: {
      openrouter: {
        cacheControl: { type: "ephemeral" },
      },
    },
  };
}
