import z from "zod";
import type { Contract, ContractResponseStatuses } from "~/contract/contract.types.js";

// biome-ignore lint/complexity/noBannedTypes: intentional Function check to preserve callable types
export type Prettify<Type> = Type extends Function
	? Type
	: {
			[Key in keyof Type]: Type[Key];
		};

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

export type ResponseBodyForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { schema: infer TSchema extends z.ZodType }
	? SchemaInput<TSchema>
	: undefined;

export type ResponseHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaInput<TContract["responses"][TStatus]["headers"]>
	: undefined;

export type ResponseBodyForStatusTransformed<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus] extends { schema: infer TSchema extends z.ZodType }
	? SchemaOutput<TSchema>
	: undefined;

export type ResponseHeadersForStatusTransformed<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends z.ZodType
	? SchemaOutput<TContract["responses"][TStatus]["headers"]>
	: undefined;

/** Like ResponseBodyForStatus but operates on a ContractResponses map directly rather than a full Contract */
export type ResponseBodyForStatusInResponses<
	TResponses,
	TStatus extends number,
> = TStatus extends keyof TResponses
	? TResponses[TStatus] extends { schema: infer TSchema extends z.ZodType }
		? SchemaOutput<TSchema>
		: undefined
	: undefined;

/** Like ResponseHeadersForStatus but operates on a ContractResponses map directly rather than a full Contract */
export type ResponseHeadersForStatusInResponses<
	TResponses,
	TStatus extends number,
> = TStatus extends keyof TResponses
	? TResponses[TStatus] extends { headers: infer THeaders extends z.ZodType }
		? SchemaOutput<THeaders>
		: undefined
	: undefined;

export type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? TSegment
	: `${TPrefix}.${TSegment}`;
