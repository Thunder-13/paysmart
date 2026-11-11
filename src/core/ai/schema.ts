import { z } from "zod";

export interface ToolSchema {
  /** JSON Schema with type "object" at the top level (tool input_schema requirement). */
  schema: { type: "object"; [key: string]: unknown };
  /** True when the zod schema was not an object and got wrapped as { value: ... }. */
  wrapped: boolean;
}

/** z.toJSONSchema, adapted for a tool's input_schema. */
export function toToolSchema(schema: z.ZodType): ToolSchema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type === "object") {
    return { schema: json as ToolSchema["schema"], wrapped: false };
  }
  return {
    schema: { type: "object", properties: { value: json }, required: ["value"], additionalProperties: false },
    wrapped: true,
  };
}

export function unwrapToolInput(input: unknown, wrapped: boolean): unknown {
  if (!wrapped) return input;
  return input && typeof input === "object" ? (input as Record<string, unknown>).value : undefined;
}

export function describeZodError(error: z.ZodError): string {
  return z.prettifyError(error);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
