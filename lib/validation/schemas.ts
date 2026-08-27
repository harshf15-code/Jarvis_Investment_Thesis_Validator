import { z } from "zod";

/**
 * zod schemas shared across the Jarvis Decision Cockpit v2 API routes.
 * Route-specific schemas (thesis input, trade plan patch, entry/exit logging,
 * journal entries) live next to the route that uses them — see each task's
 * "Files" section — rather than being centralized here, since this app's v1
 * history showed centralizing every schema in one file just meant every API
 * task touched the same file and fought over it.
 */
export const ExchangeCodeSchema = z.enum(["NSE", "BSE", "US"]);
