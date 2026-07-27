import type pino from 'pino';
import { z } from 'zod';
import type { CostOperation, CostProvider } from '@fabrica/shared';

// Proveedor LLM encapsulado. `op` identifica la operación tanto para el
// ledger como para el modo mock (cada pipeline registra sus generadores
// mock con registerMockOp, así el pipeline entero corre sin claves).

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteJsonOptions<S extends z.ZodType> {
  op: CostOperation;
  system: string;
  user: string;
  schema: S;
  maxOutputTokens?: number;
  // contexto arbitrario que los mocks usan para derivar salidas deterministas
  mockContext?: Record<string, unknown>;
}

export interface LlmProvider {
  readonly name: 'openai' | 'openrouter' | 'mock';
  readonly model: string;
  // proveedor que se anota en cost_ledger (mock registra como openai a coste 0)
  readonly ledgerProvider: CostProvider;
  completeJson<S extends z.ZodType>(
    opts: CompleteJsonOptions<S>,
  ): Promise<{ data: z.infer<S>; usage: LlmUsage }>;
  captionImage(imageUrl: string, prompt: string): Promise<{ caption: string; usage: LlmUsage }>;
}

type MockGenerator = (opts: {
  system: string;
  user: string;
  mockContext: Record<string, unknown>;
}) => unknown;

const mockOps = new Map<string, MockGenerator>();

export function registerMockOp(op: CostOperation, generator: MockGenerator): void {
  mockOps.set(op, generator);
}

class MockLlm implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';
  readonly ledgerProvider = 'openai' as const;

  async completeJson<S extends z.ZodType>(opts: CompleteJsonOptions<S>) {
    const generator = mockOps.get(opts.op);
    if (!generator) {
      throw new Error(
        `Modo mock sin generador para la operación '${opts.op}'. Regístralo con registerMockOp.`,
      );
    }
    const raw = generator({
      system: opts.system,
      user: opts.user,
      mockContext: opts.mockContext ?? {},
    });
    const data = opts.schema.parse(raw);
    return { data, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async captionImage(_imageUrl: string, prompt: string) {
    return { caption: `caption mock: ${prompt.slice(0, 60)}`, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

class OpenAiLlm implements LlmProvider {
  readonly name: 'openai' | 'openrouter';
  readonly model: string;
  readonly ledgerProvider: CostProvider;
  private clientPromise: Promise<import('openai').default> | null = null;

  constructor(
    private logger: pino.Logger,
    model: string,
    opts: { name?: 'openai' | 'openrouter'; baseURL?: string; apiKey?: string } = {},
  ) {
    this.model = model;
    this.name = opts.name ?? 'openai';
    this.ledgerProvider = this.name;
    this.baseURL = opts.baseURL;
    this.apiKey = opts.apiKey;
  }

  private readonly baseURL: string | undefined;
  private readonly apiKey: string | undefined;

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = import('openai').then(
        (m) =>
          new m.default({
            ...(this.baseURL ? { baseURL: this.baseURL } : {}),
            ...(this.apiKey ? { apiKey: this.apiKey } : {}),
          }),
      );
    }
    return this.clientPromise;
  }

  async completeJson<S extends z.ZodType>(opts: CompleteJsonOptions<S>) {
    const client = await this.client();
    // la familia gpt-5 razona antes de responder: el razonamiento consume
    // presupuesto de salida, así que se fija un suelo y esfuerzo bajo (las
    // tareas del pipeline son estructuradas, no de razonamiento profundo)
    const reasoningFamily = /gpt-5|(^|\/)o\d/.test(this.model);
    const attempt = async (extraSystem = ''): Promise<{ data: z.infer<S>; usage: LlmUsage }> => {
      const response = await client.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        max_completion_tokens: Math.max(opts.maxOutputTokens ?? 8_000, 2_000),
        ...(reasoningFamily ? { reasoning_effort: 'low' as const } : {}),
        messages: [
          {
            role: 'system',
            content:
              opts.system +
              '\nResponde EXCLUSIVAMENTE con un objeto JSON válido que cumpla el esquema descrito.' +
              extraSystem,
          },
          { role: 'user', content: opts.user },
        ],
      });
      const choice = response.choices[0];
      const text = choice?.message?.content ?? '';
      const usage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
      if (text.trim() === '') {
        throw new Error(
          `El modelo devolvió contenido vacío (finish_reason: ${choice?.finish_reason ?? 'desconocido'})`,
        );
      }
      const data = opts.schema.parse(JSON.parse(text));
      return { data, usage };
    };
    try {
      return await attempt();
    } catch (err) {
      this.logger.warn({ err, op: opts.op }, 'Salida LLM inválida; reintento con aviso');
      return attempt(
        '\nTu respuesta anterior no cumplió el esquema. Corrige y devuelve SOLO el JSON.',
      );
    }
  }

  async captionImage(imageUrl: string, prompt: string) {
    const client = await this.client();
    const response = await client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 120,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    return {
      caption: response.choices[0]?.message?.content?.trim() ?? '',
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}

export function createLlm(logger: pino.Logger): LlmProvider {
  const provider = process.env.LLM_PROVIDER ?? 'mock';
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return new OpenAiLlm(logger, process.env.LLM_MODEL ?? 'gpt-5-mini');
  }
  if (provider === 'openrouter' && process.env.OPENROUTER_API_KEY) {
    // OpenRouter es compatible con el SDK de OpenAI; los modelos llevan
    // prefijo de vendor (openai/gpt-5-mini). Sin prefijo se asume openai/.
    const raw = process.env.LLM_MODEL ?? 'openai/gpt-5-mini';
    const model = raw.includes('/') ? raw : `openai/${raw}`;
    return new OpenAiLlm(logger, model, {
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });
  }
  if (provider !== 'mock') {
    logger.warn({ provider }, 'Proveedor LLM sin clave o desconocido; usando modo mock');
  }
  return new MockLlm();
}

// hash determinista compartido por los mocks (misma entrada → misma salida)
export function mockHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
