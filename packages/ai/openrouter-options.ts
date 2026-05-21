import type { ModelMessage, SystemModelMessage } from "ai";

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
