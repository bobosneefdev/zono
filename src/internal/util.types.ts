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

export type ResponseHeadersForStatus<
	TContract extends Contract,
	TStatus extends ContractResponseStatuses<TContract>,
> = TContract["responses"][TStatus]["headers"] extends { schema: infer TSchema extends z.ZodType }
	? SchemaInput<TSchema>
	: undefined;

/** Extracts the body type for a given status from a ContractResponses map */
export type ResponseBodyForStatusInResponses<
	TResponses,
	TStatus extends number,
> = TStatus extends keyof TResponses
	? TResponses[TStatus] extends { schema: infer TSchema extends z.ZodType }
		? SchemaOutput<TSchema>
		: undefined
	: undefined;

/** Extracts the headers type for a given status from a ContractResponses map */
export type ResponseHeadersForStatusInResponses<
	TResponses,
	TStatus extends number,
> = TStatus extends keyof TResponses
	? TResponses[TStatus] extends { headers: { schema: infer TSchema extends z.ZodType } }
		? SchemaOutput<TSchema>
		: undefined
	: undefined;

export type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? TSegment
	: `${TPrefix}.${TSegment}`;

/** Basically just the same as the standard Record type, but with the iterator symbol prohibited. */
export type RecordNotArray<K extends string, V> = Record<K, V> & { [Symbol.iterator]?: never };

type ExtractRecord<T> = Extract<T, Record<string, unknown>>;

/**
 * Recursively rejects object keys that are not present in the expected shape.
 * Useful for public builder APIs where generic inference would otherwise allow extra keys.
 */
export type ExactObjectDeep<TInput, TExpected> = TInput extends TExpected
	? TInput extends Record<string, unknown>
		? [ExtractRecord<TExpected>] extends [never]
			? TInput
			: {
					[K in keyof TInput]: K extends keyof ExtractRecord<TExpected>
						? ExactObjectDeep<TInput[K], ExtractRecord<TExpected>[K]>
						: never;
				}
		: TInput
	: never;

/**
 * Strict builder input that preserves contextual typing from the expected shape
 * while still rejecting unknown keys recursively.
 */
export type StrictBuilderInput<TExpected, TInput extends TExpected> = TInput &
	TExpected &
	ExactObjectDeep<TInput, TExpected>;
