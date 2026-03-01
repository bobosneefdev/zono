import type { ContractResponses } from "~/contract/contract.types.js";

/**
 * Map of middleware names to their possible response contracts.
 * Empty responses indicate side-effect-only middleware (e.g., authentication).
 */
export type MiddlewareContractMap = Record<string, ContractResponses>;

type MiddlewareDefinitionNode<TNode> = (TNode extends { CONTRACT: unknown }
	? { MIDDLEWARE?: MiddlewareContractMap }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? {
				ROUTER?: {
					[K in keyof R]?: MiddlewareDefinitionNode<R[K]>;
				};
			}
		: unknown);

/**
 * Middleware definition structure matching a route definition.
 * Defines which middleware runs at which routes and what responses they can return.
 * @template TRoutes - The route definition type this middleware applies to
 */
export type MiddlewareDefinition<TRoutes> = {
	MIDDLEWARE?: MiddlewareContractMap;
} & (TRoutes extends { ROUTER: infer R extends Record<string, unknown> }
	? {
			ROUTER?: {
				[K in keyof R]?: MiddlewareDefinitionNode<R[K]>;
			};
		}
	: unknown);
