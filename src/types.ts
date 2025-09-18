import z from "zod";

export type ZodStringLike = z.ZodString | z.ZodEnum<Record<string, string>> | z.ZodLiteral<string>;

export type ZodNumberLike = z.ZodNumber | z.ZodEnum<Record<string, number>> | z.ZodLiteral<number>;

export type ZodPossiblyOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

type LowercaseKeys<T> = {
    [K in keyof T as Lowercase<string & K>]: T[K]
}

export type ZonoHeadersDefinition = z.ZodObject<LowercaseKeys<Record<string, ZodPossiblyOptional<ZodStringLike>>>>;

export type ZonoQueryDefinition = z.ZodObject<Record<string, ZodPossiblyOptional<ZodStringLike | ZodNumberLike | z.ZodBoolean>>>;

export type OptionalPromise<T> = T | Promise<T>;