import type { ContractResponses } from "~/contract/contract.types.js";

/** Each middleware name maps to its possible response status codes/schemas, or empty for side-effect-only middleware */
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

export type MiddlewareDefinition<TRoutes> = {
	MIDDLEWARE?: MiddlewareContractMap;
} & (TRoutes extends { ROUTER: infer R extends Record<string, unknown> }
	? {
			ROUTER?: {
				[K in keyof R]?: MiddlewareDefinitionNode<R[K]>;
			};
		}
	: unknown);
