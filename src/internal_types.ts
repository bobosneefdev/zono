import z from "zod";

type PossibleZodPipe<T extends z.ZodType> = T | z.ZodPipe<T, any>;

type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

export type PathHeadersQuerySchema =
    z.ZodType<any, string, z.core.$ZodTypeInternals<any, string>> |
    PossibleZodPipe<z.coerce.ZodCoercedNumber> |
    PossibleZodPipe<z.coerce.ZodCoercedBoolean> |
    z.coerce.ZodCoercedDate;

export type PossiblyOptionalPathHeadersQuerySchema = PossibleZodOptional<PathHeadersQuerySchema>;

export type OptionalPromise<T> = T | Promise<T>;