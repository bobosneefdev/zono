import type { MiddlewareHandler } from "hono";
import type { ContractMethodMap } from "~/contract/contract.types.js";
import type { RouterPath } from "~/router/router.resolve.types.js";

export type IncludeShape<TNode> = TNode extends {
	CONTRACT: ContractMethodMap;
	ROUTER: infer R extends Record<string, unknown>;
}
	? true | { [K in keyof R]?: IncludeShape<R[K]> }
	: TNode extends { CONTRACT: ContractMethodMap }
		? true
		: TNode extends Record<string, unknown>
			? { [K in keyof TNode]?: IncludeShape<TNode[K]> }
			: never;

export type FilteredRouter<TNode, TInclude> = TInclude extends true
	? TNode extends { CONTRACT: infer C extends ContractMethodMap }
		? { CONTRACT: C }
		: never
	: TInclude extends Record<string, unknown>
		? TNode extends {
				CONTRACT: infer C extends ContractMethodMap;
				ROUTER: infer R extends Record<string, unknown>;
			}
			? {
					CONTRACT: C;
					ROUTER: {
						[K in keyof TInclude & keyof R]: FilteredRouter<R[K], TInclude[K]>;
					};
				}
			: TNode extends { CONTRACT: infer C extends ContractMethodMap }
				? { CONTRACT: C }
				: {
						[K in keyof TInclude & keyof TNode]: FilteredRouter<TNode[K], TInclude[K]>;
					}
		: never;

export type GatewayRouterServiceOptions<TRouter> = {
	includeOnlyShape: IncludeShape<TRouter>;
};

export type GatewayServiceConfig<TServiceRouter> = {
	baseUrl: string;
	middleware?: Array<MiddlewareHandler>;
	pathMiddleware?: Partial<Record<RouterPath<TServiceRouter>, Array<MiddlewareHandler>>>;
};

export type GatewayOptions<TRouter> = {
	services: { [K in keyof TRouter]: GatewayServiceConfig<TRouter[K]> };
	basePath?: string;
	globalMiddleware?: Array<MiddlewareHandler>;
};
