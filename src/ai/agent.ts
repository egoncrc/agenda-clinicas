import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { PatientRow } from "../directus.js";
import { getToolHandler, toolSpecs, type ToolContext } from "./tools.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

/** Tope de idas y vueltas de tool_use en un solo turno, para no colgarse en un loop si el modelo insiste. */
const MAX_TOOL_ITERATIONS = 6;

const FALLBACK_REPLY =
  "Disculpa, estoy teniendo dificultades para procesar tu solicitud en este momento. Un miembro del equipo te contactará pronto.";

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Ejecuta un turno completo del agente: llama a Claude con el historial dado,
 * resuelve cualquier tool_use ejecutando el handler correspondiente, y repite
 * hasta obtener una respuesta de texto final (o agotar MAX_TOOL_ITERATIONS).
 */
export async function runAgentTurn(
  messages: Anthropic.MessageParam[],
  ctx: ToolContext,
  household: PatientRow[] = [],
): Promise<string> {
  const conversation = [...messages];
  const system = buildSystemPrompt(household, ctx.clinic);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages: conversation,
      tools: toolSpecs,
    });

    if (response.stop_reason !== "tool_use") {
      const text = extractText(response.content);
      return text || FALLBACK_REPLY;
    }

    conversation.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const handler = getToolHandler(block.name);
      if (!handler) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Herramienta desconocida: ${block.name}`,
          is_error: true,
        });
        continue;
      }

      try {
        const result = await handler(block.input as never, ctx);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (error) {
        console.error(`Error ejecutando tool "${block.name}":`, error);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Ocurrió un error interno procesando esta acción.",
          is_error: true,
        });
      }
    }

    conversation.push({ role: "user", content: toolResults });
  }

  return FALLBACK_REPLY;
}
