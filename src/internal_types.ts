import z from "zod";

export type PossibleZodPipe<T extends z.ZodType> = T | z.ZodPipe<T>;

export type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

export type PossibleZodArray<T extends z.ZodType> = T | z.ZodArray<T>;

export type PathHeadersQuerySchema =
    z.ZodType<string> |
    PossibleZodPipe<z.ZodCoercedNumber<string>> |
    PossibleZodPipe<z.ZodCoercedBoolean<string>> |
    z.coerce.ZodCoercedDate<string>;

export type OptionalPromise<T> = T | Promise<T>;
