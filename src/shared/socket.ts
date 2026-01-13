import z from "zod";

export type ZonoSocket = {
	/** Schemas of events that are emitted from the server */
	serverEvents: Record<string, z.ZodType>;
	/** Schemas of events that are emitted from the client */
	clientEvents: Record<string, z.ZodType>;
};
