import { useCallback } from "react";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";

// The offline showcase uses the renderer's local tokenizer instead of a daemon.
export function useRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
  contract: PluginRpcContract<InputSchema, OutputSchema>,
): (input: ZodInput<InputSchema>) => Promise<ZodOutput<OutputSchema>> {
  return useCallback(async (input: ZodInput<InputSchema>) => {
    if (contract.name !== "highlight.tokens") throw new Error("No daemon in the offline showcase");
    const request = input as { code: string; diffBodyCode?: string };
    const plainLines = (code: string) => code.trimEnd().split("\n").map((text) => [{ text, color: null }]);
    return {
      lines: plainLines(request.code),
      diffLines: request.diffBodyCode ? plainLines(request.diffBodyCode) : undefined,
      language: null,
      theme: "showcase",
    } as ZodOutput<OutputSchema>;
  }, [contract]);
}
