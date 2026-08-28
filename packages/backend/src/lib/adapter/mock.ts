import type { ToolDefinition, ToolCall } from "@platform/shared";
import type { AdapterMessage, CompletionResult, ModelAdapter } from "./types.js";

export type ScriptedStep =
  | { text: string }
  | { toolCalls: ToolCall[] }
  | { throws: string };

export class MockAdapter implements ModelAdapter {
  private steps: ScriptedStep[];
  private index = 0;
  public calls: AdapterMessage[][] = [];

  constructor(steps: ScriptedStep[]) {
    this.steps = steps;
  }

  async complete(
    messages: AdapterMessage[],
    _tools: ToolDefinition[]
  ): Promise<CompletionResult> {
    this.calls.push(messages);
    const step = this.steps[this.index++];
    if (!step) throw new Error("MockAdapter: no scripted step remaining");
    if ("throws" in step) throw new Error(step.throws);
    if ("toolCalls" in step) {
      return { text: "", toolCalls: step.toolCalls, tokensIn: 10, tokensOut: 5 };
    }
    return { text: step.text, toolCalls: [], tokensIn: 10, tokensOut: 8 };
  }
}
