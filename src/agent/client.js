import Anthropic, {
  APIConnectionError,
  APIError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { config } from '../config.js';

export class AgentUnavailable extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AgentUnavailable';
    this.cause = cause;
  }
}

let client = null;

export function agentAvailable() {
  return Boolean(config.apiKey);
}

function getClient() {
  if (!agentAvailable()) throw new AgentUnavailable('no ANTHROPIC_API_KEY configured');
  if (!client) client = new Anthropic({ apiKey: config.apiKey });
  return client;
}

function textOf(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * One JSON-shaped call to Claude. Everything the agent does goes through here,
 * so there is exactly one place that knows about retries, refusals and the
 * structured-output contract.
 *
 * Callers are expected to catch AgentUnavailable and fall back to a template —
 * a model outage should cost Thirdplace its tone of voice, not its function.
 */
export async function askJSON({
  system,
  user,
  schema,
  effort = 'medium',
  maxTokens = 16000,
  model = config.model,
}) {
  const c = getClient();
  const base = {
    model,
    max_tokens: maxTokens,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: user }],
  };

  let message;
  try {
    // Server-side fallbacks: if a safety classifier declines the request, the
    // server reroutes rather than handing us an unusable turn.
    message = await c.beta.messages.create({
      ...base,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      throw new AgentUnavailable(`model not found: ${model}`, err);
    }
    if (err instanceof BadRequestError) {
      // Older gateways reject the fallback beta; the plain call still works.
      try {
        message = await c.messages.create(base);
      } catch (retryErr) {
        throw wrap(retryErr);
      }
    } else {
      throw wrap(err);
    }
  }

  if (message.stop_reason === 'refusal') {
    throw new AgentUnavailable(
      `request declined (${message.stop_details?.category ?? 'unspecified'})`,
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AgentUnavailable('response hit max_tokens before completing');
  }

  const raw = textOf(message);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new AgentUnavailable('model did not return parseable JSON', err);
  }
}

function wrap(err) {
  if (err instanceof RateLimitError) return new AgentUnavailable('rate limited', err);
  if (err instanceof APIConnectionError) return new AgentUnavailable('connection failed', err);
  if (err instanceof APIError) return new AgentUnavailable(`api error ${err.status ?? ''}`.trim(), err);
  return new AgentUnavailable(err?.message || 'unknown agent failure', err);
}
