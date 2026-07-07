import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-opus-4-8";

export interface Verdict {
  correct: boolean;
  reasoning: string;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    correct: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: ["correct", "reasoning"],
  additionalProperties: false,
} as const;

export async function judge(
  symptom: string,
  rubric: string,
  expectedRootCause: string,
  agentAnswer: string,
): Promise<Verdict> {
  // cast: installed SDK types lag output_config
  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    system:
      "You are a strict grader for an incident-investigation agent. Decide whether the agent's answer correctly identifies the root cause per the rubric. Be precise: a vague answer that does not name the specific root cause is INCORRECT.",
    output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          `Incident symptom: ${symptom}`,
          ``,
          `Grading rubric: ${rubric}`,
          ``,
          `Reference root cause: ${expectedRootCause}`,
          ``,
          `--- Agent's answer ---`,
          agentAnswer,
          `--- end ---`,
          ``,
          `Return {"correct": boolean, "reasoning": string}.`,
        ].join("\n"),
      },
    ],
  } as Anthropic.Messages.MessageCreateParamsNonStreaming);

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    return { correct: false, reasoning: "Judge returned no text output." };
  }
  try {
    const parsed = JSON.parse(text.text) as Verdict;
    return { correct: Boolean(parsed.correct), reasoning: String(parsed.reasoning) };
  } catch {
    return { correct: false, reasoning: `Unparseable judge output: ${text.text}` };
  }
}
