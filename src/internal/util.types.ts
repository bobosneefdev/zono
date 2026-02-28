import z from "zod";
import type { Contract, ContractResponseStatuses } from "~/contract/contract.types.js";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| Array<JsonValue>
	| { [key: string]: JsonValue };

export type PossiblePromise<T> = T | Promise<T>;

export type SchemaInput<TSchema> = TSchema extends z.ZodType ? z.input<TSchema> : never;

export type SchemaOutput<TSchema> = TSchema extends z.ZodType ? z.output<TSchema> : never;

export type HttpSafeBaseSchema<TSchema extends z.ZodType> = TSchema &
	z.ZodType<SchemaInput<TSchema>, SchemaInput<TSchema>>;

export type TopLevelTransformChainSchema<TBase extends z.ZodType> =
	| TBase
	| z.ZodPipe<z.ZodType, z.ZodTransform>;

export type RouteContractSchema<TBase extends z.ZodType> = TopLevelTransformChainSchema<
	HttpSafeBaseSchema<TBase>
>;

export type SchemaHttpSafeInput<TSchema> = TSchema extends z.ZodType ? SchemaInput<TSchema> : never;

export type SchemaTransformedOutput<TSchema> = TSchema extends z.ZodType
	? SchemaOutput<TSchema>
	: never;

export type ResponseBodyForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { schema: infer TSchema extends z.ZodType }
	? SchemaHttpSafeInput<TSchema>
	: undefined;

export type ResponseHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaHttpSafeInput<TContract["responses"][TStatus]["headers"]>
	: undefined;

export type ResponseBodyForStatusTransformed<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { schema: infer TSchema extends z.ZodType }
	? SchemaTransformedOutput<TSchema>
	: undefined;

export type ResponseHeadersForStatusTransformed<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaTransformedOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

export type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? TSegment
	: `${TPrefix}.${TSegment}`;
