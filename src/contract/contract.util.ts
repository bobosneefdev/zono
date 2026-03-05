import type z from "zod";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
	RouterShape,
	ShapeNode,
} from "~/contract/contract.types.js";
import type { Prettify, SchemaInput, SchemaOutput } from "~/internal/util.types.js";

type RoutePathParamKey<TSegment extends string> = TSegment extends `$${infer TPathParamKey}`
	? TPathParamKey
	: never;

type AccumulateRoutePathParamKeys<TPathParamKeys extends string, TSegment extends string> =
	| TPathParamKeys
	| RoutePathParamKey<TSegment>;

type RoutePathParamRecord<TPathParamKeys extends string> = {
	[K in TPathParamKeys]: string;
};

type ContractWithRoutePathParams<TPathParamKeys extends string> = Omit<Contract, "pathParams"> &
	([TPathParamKeys] extends [never]
		? { pathParams?: never }
		: {
				pathParams: z.ZodType<
					RoutePathParamRecord<TPathParamKeys>,
					RoutePathParamRecord<TPathParamKeys>
				>;
			});

type ContractMethodMapForPathParams<TPathParamKeys extends string> = Partial<
	Record<ContractMethod, ContractWithRoutePathParams<TPathParamKeys>>
>;

type ContractDefinitionNode<
	TNode extends ShapeNode,
	TPathParamKeys extends string,
> = (TNode extends {
	CONTRACT: true;
}
	? { CONTRACT: ContractMethodMapForPathParams<TPathParamKeys> }
	: unknown) &
	(TNode extends { ROUTER: infer TRouter extends Record<string, ShapeNode> }
		? {
				ROUTER: {
					[K in keyof TRouter & string]: ContractDefinitionNode<
						TRouter[K],
						AccumulateRoutePathParamKeys<TPathParamKeys, K>
					>;
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
		[K in keyof TShape["ROUTER"] & string]: ContractDefinitionNode<
			TShape["ROUTER"][K],
			RoutePathParamKey<K>
		>;
	};
};

type IsExactType<TType, TExpected> = [TType] extends [TExpected]
	? [TExpected] extends [TType]
		? true
		: false
	: false;

type IsExactRoutePathParamSchema<
	TSchema extends z.ZodType,
	TPathParamKeys extends string,
> = IsExactType<SchemaInput<TSchema>, RoutePathParamRecord<TPathParamKeys>> extends true
	? IsExactType<SchemaOutput<TSchema>, RoutePathParamRecord<TPathParamKeys>>
	: false;

type ValidateContractPathParams<TContract extends Contract, TPathParamKeys extends string> = [
	TPathParamKeys,
] extends [never]
	? TContract extends { pathParams: unknown }
		? never
		: TContract
	: TContract extends { pathParams: infer TPathParamsSchema extends z.ZodType }
		? IsExactRoutePathParamSchema<TPathParamsSchema, TPathParamKeys> extends true
			? TContract
			: never
		: never;

type ValidateMethodContract<
	TMethodContract,
	TPathParamKeys extends string,
> = TMethodContract extends Contract
	? ValidateContractPathParams<TMethodContract, TPathParamKeys>
	: TMethodContract extends undefined
		? undefined
		: never;

type ValidateContractMethodMap<
	TMethodMap extends ContractMethodMap,
	TPathParamKeys extends string,
> = {
	[TMethod in keyof TMethodMap]: ValidateMethodContract<TMethodMap[TMethod], TPathParamKeys>;
};

type ValidateContractDefinitionNode<
	TNode extends ShapeNode,
	TDefNode,
	TPathParamKeys extends string,
> = (TNode extends { CONTRACT: true }
	? TDefNode extends { CONTRACT: infer TMethodMap extends ContractMethodMap }
		? { CONTRACT: ValidateContractMethodMap<TMethodMap, TPathParamKeys> }
		: never
	: unknown) &
	(TNode extends { ROUTER: infer TRouter extends Record<string, ShapeNode> }
		? TDefNode extends { ROUTER: infer TDefRouter extends Record<string, unknown> }
			? {
					ROUTER: {
						[TKey in keyof TRouter & string]: ValidateContractDefinitionNode<
							TRouter[TKey],
							TDefRouter[TKey],
							AccumulateRoutePathParamKeys<TPathParamKeys, TKey>
						>;
					};
				}
			: never
		: unknown);

export type ValidateContractDefinition<
	TShape extends RouterShape,
	TDef extends ContractDefinition<TShape>,
> = TDef extends { ROUTER: infer TDefRouter extends Record<string, unknown> }
	? {
			ROUTER: {
				[TKey in keyof TShape["ROUTER"] & string]: ValidateContractDefinitionNode<
					TShape["ROUTER"][TKey],
					TDefRouter[TKey],
					RoutePathParamKey<TKey>
				>;
			};
		}
	: never;

type ContractPickSelectorNode<TNode> =
	| true
	| (TNode extends { ROUTER: infer TRouter extends Record<string, unknown> }
			? { [TKey in keyof TRouter & string]?: ContractPickSelectorNode<TRouter[TKey]> }
			: never);

/**
 * Selector map for recursively picking contracts by route path.
 * - `true` includes a node and its full subtree
 * - object values continue selection into child routes
 */
export type ContractPickSelector<TContracts extends { ROUTER: Record<string, unknown> }> = {
	[TKey in keyof TContracts["ROUTER"] & string]?: ContractPickSelectorNode<
		TContracts["ROUTER"][TKey]
	>;
};

type PickContractNode<TNode, TSelector> = TSelector extends true
	? TNode
	: TSelector extends Record<string, unknown>
		? TNode extends { ROUTER: infer TRouter extends Record<string, unknown> }
			? PickContractRouter<TRouter, TSelector> extends infer TPickedRouter extends Record<
					string,
					unknown
				>
				? keyof TPickedRouter extends never
					? never
					: { ROUTER: TPickedRouter }
				: never
			: never
		: never;

type PickContractRouter<
	TRouter extends Record<string, unknown>,
	TSelector extends Record<string, unknown>,
> = {
	[TKey in keyof TRouter & keyof TSelector & string as PickContractNode<
		TRouter[TKey],
		TSelector[TKey]
	> extends never
		? never
		: TKey]: PickContractNode<TRouter[TKey], TSelector[TKey]>;
};

/**
 * Resulting contract tree for a given pick selector.
 */
export type PickContracts<
	TContracts extends { ROUTER: Record<string, unknown> },
	TSelector extends ContractPickSelector<TContracts>,
> = {
	ROUTER: PickContractRouter<TContracts["ROUTER"], TSelector>;
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
