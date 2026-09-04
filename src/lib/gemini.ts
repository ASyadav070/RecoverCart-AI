import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const GeminiProposalSchema = z.object({
  action: z.enum(['CART_REMINDER', 'PAYMENT_RETRY', 'PAYMENT_ASSISTANCE', 'INCENTIVE_RECOVERY', 'ESCALATE', 'STOP_RECOVERY']),
  strategy: z.string().min(1),
  merchant_rationale: z.string().min(1),
  proposed_channel: z.string().min(1),
  proposed_message: z.string().min(1),
  discount: z.object({
    recommended: z.boolean(),
    type: z.literal('percentage').nullable(),
    value: z.number().positive().nullable(),
  }),
}).superRefine((data, ctx) => {
  if (!data.discount.recommended) {
    if (data.discount.type !== null || data.discount.value !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Discount fields must be null when recommended is false', path: ['discount'] });
    }
  } else {
    if (data.action !== 'INCENTIVE_RECOVERY' || data.discount.type !== 'percentage' || !data.discount.value || data.discount.value <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid discount configuration for action', path: ['discount'] });
    }
  }
  if (data.action !== 'INCENTIVE_RECOVERY' && (data.discount.recommended || data.discount.type !== null || data.discount.value !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Discount must be null/false for non-incentive actions', path: ['discount'] });
  }
});

export type GeminiProposal = z.infer<typeof GeminiProposalSchema>;

export async function generateRecoveryProposal(context: Record<string, unknown>): Promise<{
  proposal: GeminiProposal;
  model: string;
  attempt: number;
} | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const models = (process.env.GEMINI_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) throw new Error('GEMINI_MODELS not configured');

  const ai = new GoogleGenAI({
    apiKey,
  });

  try {
    for (let i = 0; i < models.length; i++) {
      const modelName = models[i];
      try {
        const prompt = `You are a recovery assistant.
        Allowed actions: ${context.allowed_actions}.
        Inventory status: ${context.inventory_status}.
        
        Given the following business context, propose a recovery strategy.
        Context: ${JSON.stringify(context)}
        
        Output ONLY valid JSON matching this schema:
        {
          "action": "string",
          "strategy": "string",
          "merchant_rationale": "string",
          "proposed_channel": "string",
          "proposed_message": "string",
          "discount": {
            "recommended": boolean,
            "type": "percentage" | null,
            "value": number | null
          }
        }

        Instructions:
        1. Choose exactly one action from the allowed_actions list.
        2. If inventory_status is NORMAL or UNKNOWN, DO NOT mention stock or scarcity.
        3. Do not invent payment facts, discounts, coupon/promo codes, or delivery guarantees.
        4. If action is INCENTIVE_RECOVERY, discount must be percentage, recommended true, and value > 0.
        5. If action is NOT INCENTIVE_RECOVERY, discount must be recommended false, type null, value null.
        6. Merchant approval happens later, so do not assume the strategy is already active.
        `;

        let timeoutId: NodeJS.Timeout;
        const timer = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('timeout')), 15000);
        });

        try {
          const response = await Promise.race([
            ai.models.generateContent({
              model: modelName,
              contents: prompt,
            }),
            timer
          ]) as { text: string };

          const text = response.text || '';
          const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(jsonStr);
          const validated = GeminiProposalSchema.parse(parsed);

          return { proposal: validated, model: modelName, attempt: i + 1 };
        } finally {
          clearTimeout(timeoutId!);
        }
      } catch (error: unknown) {
        if (isTransientError(error)) {
          console.warn(`Model ${modelName} failed (attempt ${i + 1}), trying next...`);
          continue;
        }
        throw error;
      }
    }
  } catch {
    console.error('Gemini generation failed', {
      category: 'generation_failure',
    });
  }

  return null;
}

function isTransientError(error: unknown): boolean {
  const err = error as { status?: number; response?: { status?: number }; message?: string };
  const status = err.status || err.response?.status;
  if (status !== undefined && [429, 502, 503, 504].includes(status)) return true;
  if (err.message?.includes('timeout') || err.message?.includes('network')) return true;
  return false;
}
