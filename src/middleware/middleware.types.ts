import type { ContractResponses } from "~/contract/contract.types.js";

/**
 * Map of middleware names to their possible response contracts.
 * Empty responses indicate side-effect-only middleware (e.g., logging).
 */
export type MiddlewareContractMap = Record<string, ContractResponses>;

type MiddlewaresDefinitionNode<TNode> = (TNode extends { CONTRACT: unknown }
	? { MIDDLEWARE?: MiddlewareContractMap }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? {
				ROUTER?: {
					[K in keyof R]?: MiddlewaresDefinitionNode<R[K]>;
				};
			}
		: unknown);

/**
 * Middlewares definition structure matching a contract definition.
 * Defines which middleware runs at which routes and what responses they can return.
 * @template TContracts - The contract definition type this middleware applies to
 */
export type MiddlewaresDefinition<TContracts> = {
	MIDDLEWARE?: MiddlewareContractMap;
} & (TContracts extends { ROUTER: infer R extends Record<string, unknown> }
	? {
			ROUTER?: {
				[K in keyof R]?: MiddlewaresDefinitionNode<R[K]>;
			};
		}
	: unknown);
