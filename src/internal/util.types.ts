import z from "zod";
import type { Contract, ContractResponseStatuses } from "~/contract/contract.types.js";

export type PossiblePromise<T> = T | Promise<T>;

export type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

export type SchemaInput<TSchema> = TSchema extends z.ZodType ? z.input<TSchema> : never;

export type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

export type ResponseBodyForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { schema: infer TSchema extends z.ZodType }
	? SchemaOutput<TSchema>
	: undefined;

export type ResponseHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

export type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? TSegment
	: `${TPrefix}.${TSegment}`;

export type EnumValues<T extends Record<string, string>> = `${T[keyof T]}`;
