import { z } from "zod";
import { isDate, todayStockholm, addDays, dayCount } from "./dates";
export const sizeSchema = z.enum(["small", "medium", "large"]);
const requirements = z.array(z.enum(["medication", "puppy", "senior"])).max(3);
const preferences = z.array(z.enum(["quiet", "active", "garden"])).max(3);
export const dogSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    size: sizeSchema,
    ageYears: z.number().int().min(0).max(30),
    breed: z.string().trim().max(100).default(""),
    social: z.boolean(),
    requirements,
    preferences,
    careNotes: z.string().trim().max(2000).default(""),
  })
  .strict();
export const sitterSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    area: z.string().trim().min(1).max(100),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusKm: z.number().int().min(1).max(100),
    description: z.string().trim().max(2000),
    sizes: z.array(sizeSchema).min(1).max(3),
    experienceYears: z.number().int().min(0).max(80),
    dailyPrice: z.number().int().min(100).max(1000000),
    capacity: z.number().int().min(1).max(10),
    residentDogs: z.boolean(),
    services: requirements,
    preferences,
  })
  .strict();
export const rangeSchema = z
  .object({
    startDate: z.string().refine(isDate),
    endDate: z.string().refine(isDate),
  })
  .refine(
    (v) =>
      v.startDate >= todayStockholm() &&
      v.endDate >= v.startDate &&
      dayCount(v.startDate, v.endDate) <= 31 &&
      v.endDate <= addDays(todayStockholm(), 365),
    "Välj 1–31 dagar inom ett år.",
  );
export const searchSchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    dogIds: z
      .array(z.uuid())
      .min(1)
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!rangeSchema.safeParse(v).success)
      ctx.addIssue({ code: "custom", message: "Välj 1–31 dagar inom ett år." });
  });
export const bookingSchema = searchSchema.safeExtend({
  sitterId: z.uuid(),
  requestKey: z.uuid(),
  expectedDailyPrice: z.number().int().min(100).max(1000000),
});
export const decisionSchema = z
  .object({
    id: z.uuid(),
    decision: z.enum(["confirmed", "declined", "cancelled"]),
    revision: z.number().int().min(0),
  })
  .strict();
export type DogInput = z.infer<typeof dogSchema>;
export type SitterInput = z.infer<typeof sitterSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
