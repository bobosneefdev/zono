import z from "zod";

export type PossiblePromise<T> = T | Promise<T>;

export type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

export type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? TSegment
	: `${TPrefix}.${TSegment}`;

export type EnumValues<T extends Record<string, string>> = `${T[keyof T]}`;
