import type z from "zod";
import type { Contract } from "~/contract/contract.types.js";
import type { SchemaInput, SchemaOutput } from "~/internal/util.types.js";

type SchemaDir = "input" | "output";

type SchemaForDir<TSchema, TDir extends SchemaDir> = TDir extends "input"
	? SchemaInput<TSchema>
	: SchemaOutput<TSchema>;

type IncludePathParams<
	TContract extends Contract,
	TDir extends SchemaDir,
> = TContract["pathParams"] extends z.ZodType
	? { pathParams: SchemaForDir<TContract["pathParams"], TDir> }
	: object;

type IncludeBody<TContract extends Contract, TDir extends SchemaDir> = TContract["body"] extends {
	schema: infer TSchema extends z.ZodType;
}
	? { body: SchemaForDir<TSchema, TDir> }
	: object;

type IncludeQuery<TContract extends Contract, TDir extends SchemaDir> = TContract["query"] extends {
	schema: infer TSchema extends z.ZodType;
}
	? { query: SchemaForDir<TSchema, TDir> }
	: object;

type IncludeHeaders<
	TContract extends Contract,
	TDir extends SchemaDir,
> = TContract["headers"] extends { schema: infer TSchema extends z.ZodType }
	? { headers: SchemaForDir<TSchema, TDir> }
	: object;

/**
 * Input type for a contract — the shape of data the client provides (z.input of each schema).
 * @template TContract - The contract to extract input type from
 */
export type ContractInput<TContract extends Contract> = IncludePathParams<TContract, "input"> &
	IncludeBody<TContract, "input"> &
	IncludeQuery<TContract, "input"> &
	IncludeHeaders<TContract, "input">;

/**
 * Output type for a contract — the shape the server handler receives after parsing/transforms
 * (z.output of each schema).
 * @template TContract - The contract to extract output type from
 */
export type ContractOutput<TContract extends Contract> = IncludePathParams<TContract, "output"> &
	IncludeBody<TContract, "output"> &
	IncludeQuery<TContract, "output"> &
	IncludeHeaders<TContract, "output">;
