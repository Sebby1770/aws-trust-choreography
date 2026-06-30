/**
 * AI / LLM building blocks for Flow Studio.
 *
 * These extend the official AWS icon catalog with provider and pattern nodes
 * (Claude, ChatGPT, vector stores, guardrails, …) so an architecture can model
 * a modern AI workload. They share the catalog item shape
 * ({ id, type, category, name, path, search }) and use the dedicated "ai" type
 * so they get their own library tab, while still being resolvable by name from
 * templates.
 */

const CATEGORY = "AI & LLM";

function aiIcon(slug, name, search) {
  const path = `assets/ai-icons/${slug}.svg`;
  return {
    id: `ai:${path}`,
    type: "ai",
    category: CATEGORY,
    name,
    path,
    search: `${name} ${search} ai llm`.toLowerCase(),
  };
}

export const AI_ICONS = [
  aiIcon("claude", "Claude", "anthropic model assistant reasoning"),
  aiIcon("chatgpt", "ChatGPT", "openai gpt model assistant"),
  aiIcon("foundation-model", "Foundation Model", "llm model inference bedrock self-hosted"),
  aiIcon("ai-agent", "AI Agent", "agent orchestrator tools planner autonomous"),
  aiIcon("vector-db", "Vector Database", "vector store embeddings retrieval rag pinecone"),
  aiIcon("embeddings", "Embeddings Model", "embeddings encode vectorize retrieval"),
  aiIcon("ai-guardrails", "AI Guardrails", "safety moderation filter policy guardrail"),
];
