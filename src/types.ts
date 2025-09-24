import z from "zod";

export type ZodStringLike =
    z.ZodString |
    z.ZodEnum<Record<string, string>> |
    z.ZodLiteral<string> |
    z.coerce.ZodCoercedNumber |
    z.coerce.ZodCoercedBoolean;

export type ZodNumberLike = z.ZodNumber | z.ZodEnum<Record<string, number>> | z.ZodLiteral<number>;

export type ZodPossiblyOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

export type ZonoHeadersDefinition = z.ZodObject<Record<string, ZodPossiblyOptional<ZodStringLike>>>;

export type ZonoQueryDefinition = z.ZodObject<Record<string, ZodPossiblyOptional<ZodStringLike | ZodNumberLike | z.ZodBoolean>>>;

export type OptionalPromise<T> = T | Promise<T>;

export type ZonoSocketDefinition = {
    /** Schemas of events that are emitted from the server */
    serverEvents: Record<string, z.ZodType>;
    /** Schemas of events that are emitted from the client */
    clientEvents: Record<string, z.ZodType>;
};