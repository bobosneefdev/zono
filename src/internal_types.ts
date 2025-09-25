import z from "zod";

export type StringNumberBooleanSchema =
    z.ZodString |
    z.ZodEnum<Record<string, string>> |
    z.ZodLiteral<string> |
    z.ZodNumber |
    z.ZodEnum<Record<any, number>> |
    z.ZodLiteral<number> |
    z.ZodBoolean;

export type PossiblyOptionalStringOrNumberSchema =
    StringNumberBooleanSchema |
    z.ZodOptional<StringNumberBooleanSchema>;

export type OptionalPromise<T> = T | Promise<T>;