import { z } from "zod";
export const arrivalTimeSchema = z
  .string()
  .regex(/^(?:(?:0[6-9]|1\d|2[0-2]):(?:00|15|30|45)|23:00)$/)
  .nullable();
export const arrivalChangeSchema = z
  .object({
    arrivalTime: arrivalTimeSchema,
    expectedRevision: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type ArrivalChange = z.infer<typeof arrivalChangeSchema>;

export const bookingTimesChangeSchema = z
  .object({
    arrivalTime: arrivalTimeSchema.optional(),
    pickupTime: arrivalTimeSchema.optional(),
    expectedRevision: z.number().int().min(0).max(2147483646),
  })
  .strict()
  .refine((v) => v.arrivalTime !== undefined || v.pickupTime !== undefined);
export type BookingTimesChange = z.infer<typeof bookingTimesChangeSchema>;
