import { config as loadDotenv } from "dotenv";

loadDotenv();

export interface AppConfig {
  apiKey: string;
  model: string;
  workspaceRoot: string;
  maxTokens: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    model: process.env.CODE_AGENT_MODEL ?? "claude-sonnet-4-5-20250929",
    workspaceRoot: process.cwd(),
    maxTokens: Number(process.env.CODE_AGENT_MAX_TOKENS ?? 8192),
  };
}
