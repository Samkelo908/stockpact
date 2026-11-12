import { z } from 'zod';
import { MarketplaceError } from './access';

export const id = z.string().trim().min(1).max(120);
export const quantity = z.number().int().min(1).max(100_000);
export const cents = z.number().int().min(0).max(100_000_000);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');
export const rating = z.number().int().min(1).max(5);
export const draft = z.object({
  product: z.string().trim().min(2).max(180), quantity, unit: z.string().trim().min(1).max(40),
  location: z.string().trim().max(220), requiredDate: date, budgetCents: cents.nullable(), notes: z.string().trim().max(2500),
  category: z.string().trim().max(90), substitutions: z.boolean(), mode: z.enum(['manual', 'demo', 'cloudflare']),
  shareBudget: z.boolean().optional(), collection: z.boolean().optional(), packSize: quantity.optional(),
}).refine((value) => value.collection || value.location.length > 0, 'Enter a delivery location or choose collection.');

export const listingFields = z.object({
  id: id.optional(), name: z.string().trim().min(2).max(180), category: z.string().trim().min(1).max(90),
  description: z.string().trim().max(2000), unit: z.string().trim().min(1).max(40),
  priceCents: cents.nullable(), available: z.number().int().min(0).max(1_000_000), minimum: quantity.default(1),
  packSize: quantity.default(1), deliveryAreas: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  leadDays: z.number().int().min(0).max(365).default(1), deliveryFeeCents: cents.default(0),
  collection: z.boolean().default(true), archived: z.boolean().default(false),
  brand: z.string().trim().max(100).optional(), surplus: z.boolean().optional(),
});

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new MarketplaceError(`${issue.path.length ? `${issue.path.join('.')} · ` : ''}${issue.message}`, 422);
}
