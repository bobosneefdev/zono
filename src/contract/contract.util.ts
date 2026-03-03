import type z from "zod";
import type {
	Contract,
	ContractMethodMap,
	ContractResponses,
	RouterShape,
	ShapeNode,
} from "~/contract/contract.types.js";
import type { JoinPath, Prettify, SchemaInput, SchemaOutput } from "~/internal/util.types.js";

type ContractDefinitionNode<TNode extends ShapeNode, TPath extends string> = (TNode extends {
	CONTRACT: true;
}
	? { CONTRACT: ContractMethodMap }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, ShapeNode> }
		? {
				ROUTER: {
					[K in keyof R & string]: ContractDefinitionNode<R[K], JoinPath<TPath, K>>;
				};
			}
		: unknown);

/**
 * Type-safe contract definition matching a router shape.
 * Provides autocomplete for paths and methods based on the shape structure.
 * @template TShape - The router shape to define contracts for
 */
export type ContractDefinition<TShape extends RouterShape> = {
	ROUTER: {
		[K in keyof TShape["ROUTER"] & string]: ContractDefinitionNode<TShape["ROUTER"][K], K>;
	};
};

/**
 * Merges two contract response maps, combining responses for the same status code into a union.
 * @template TBaseResponses - Base response map
 * @template TAdditionalResponses - Additional responses to merge
 */
export type MergeContractResponses<
	TBaseResponses extends ContractResponses,
	TAdditionalResponses extends ContractResponses,
> = {
	[TStatus in Extract<keyof TBaseResponses | keyof TAdditionalResponses, number>]:
		| (TStatus extends keyof TBaseResponses ? TBaseResponses[TStatus] : never)
		| (TStatus extends keyof TAdditionalResponses ? TAdditionalResponses[TStatus] : never);
};

/**
 * Recursively merges multiple contract response maps.
 * @template TResponses - Array of response maps to merge
 */
export type MergeContractResponsesMany<TResponses extends ReadonlyArray<ContractResponses>> =
	TResponses extends readonly [
		infer THead extends ContractResponses,
		...infer TTail extends ReadonlyArray<ContractResponses>,
	]
		? MergeContractResponses<THead, MergeContractResponsesMany<TTail>>
		: Record<never, never>;

type SchemaDirection = "input" | "output";

type SchemaForDirection<
	TSchema extends z.ZodType,
	TDirection extends SchemaDirection,
> = TDirection extends "input" ? SchemaInput<TSchema> : SchemaOutput<TSchema>;

type IncludePathParams<
	TContract extends Contract,
	TDirection extends SchemaDirection,
> = TContract["pathParams"] extends infer TPathParamsSchema extends z.ZodType
	? { pathParams: SchemaForDirection<TPathParamsSchema, TDirection> }
	: object;

type IncludeContractSchemaField<
	TContract extends Contract,
	TDirection extends SchemaDirection,
	TField extends "body" | "query" | "headers",
> = TContract[TField] extends { schema: infer TSchema extends z.ZodType }
	? { [K in TField]: SchemaForDirection<TSchema, TDirection> }
	: object;

/**
 * Input type for a contract — the shape of data the client provides z.input of each schema.
 * @template TContract - The contract to extract input type from
 */
export type ContractInput<TContract extends Contract> = IncludePathParams<TContract, "input"> &
	IncludeContractSchemaField<TContract, "input", "body"> &
	IncludeContractSchemaField<TContract, "input", "query"> &
	IncludeContractSchemaField<TContract, "input", "headers">;

/**
 * Output type for a contract — the shape the server handler receives after parsing or transforms
 * z.output of each schema.
 * @template TContract - The contract to extract output type from
 */
export type ContractOutput<TContract extends Contract> = Prettify<
	IncludePathParams<TContract, "output"> &
		IncludeContractSchemaField<TContract, "output", "body"> &
		IncludeContractSchemaField<TContract, "output", "query"> &
		IncludeContractSchemaField<TContract, "output", "headers">
>;
