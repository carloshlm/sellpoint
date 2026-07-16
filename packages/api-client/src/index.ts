import { HealthSchema } from "@sellpoint/shared";

export const version = "0.0.0" as const;

export const isHealthy = (payload: unknown): boolean => HealthSchema.safeParse(payload).success;
