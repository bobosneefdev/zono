import type { Context } from "hono";
import type { ErrorMode } from "~/contract/contract.error.js";
import type { ContractOutput } from "~/contract/contract.io.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
} from "~/contract/contract.types.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import type { PossiblePromise } from "~/internal/util.types.js";
import type { MiddlewareContractMap } from "~/middleware/middleware.types.js";

export type HonoHandler<TContract extends Contract> = (
	input: ContractOutput<TContract>,
	ctx: Context,
) => PossiblePromise<ServerHandlerOutput<TContract>>;

export type HonoHandlerMethodMap<TContractMap extends ContractMethodMap> = {
	[M in ContractMethod as TContractMap[M] extends Contract ? M : never]: HonoHandler<
		Extract<TContractMap[M], Contract>
	>;
};

type HonoRouteHandlerNode<TNode> = (TNode extends {
	CONTRACT: infer C extends ContractMethodMap;
}
	? { HANDLER: HonoHandlerMethodMap<C> }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K]> } }
		: unknown);

export type HonoRouteHandlerTree<TRoutes> = TRoutes extends {
	ROUTER: infer R extends Record<string, unknown>;
}
	? { ROUTER: { [K in keyof R]: HonoRouteHandlerNode<R[K]> } }
	: never;

export type HonoMiddlewareHandler<TResponses extends ContractResponses> =
	| null
	| ((
			ctx: Context,
			next: () => Promise<void>,
	  ) => PossiblePromise<void | HonoMiddlewareReturn<TResponses>>);

export type HonoMiddlewareReturn<TResponses extends ContractResponses> = {
	[S in Extract<keyof TResponses, number>]: {
		status: S;
	} & (TResponses[S] extends { contentType: infer CT; schema: infer _TSchema }
		? { contentType: CT; body: unknown }
		: { contentType?: undefined; body?: undefined });
}[Extract<keyof TResponses, number>];

type HonoMiddlewareHandlersMap<TMap extends MiddlewareContractMap> = {
	[K in keyof TMap]: HonoMiddlewareHandler<TMap[K]>;
};

type HonoMiddlewareHandlerNode<TNode> = (TNode extends {
	MIDDLEWARE: infer M extends MiddlewareContractMap;
}
	? { MIDDLEWARE: HonoMiddlewareHandlersMap<M> }
	: unknown) &
	(TNode extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER?: { [K in keyof R]?: HonoMiddlewareHandlerNode<R[K]> } }
		: unknown);

export type HonoMiddlewareHandlerTree<TMiddleware> = (TMiddleware extends {
	MIDDLEWARE: infer M extends MiddlewareContractMap;
}
	? { MIDDLEWARE: HonoMiddlewareHandlersMap<M> }
	: unknown) &
	(TMiddleware extends { ROUTER: infer R extends Record<string, unknown> }
		? { ROUTER?: { [K in keyof R]?: HonoMiddlewareHandlerNode<R[K]> } }
		: unknown);

export type HonoOptions<TRoutes, TMiddleware = unknown> = {
	routeHandlers: HonoRouteHandlerTree<TRoutes>;
	middleware?: TMiddleware;
	middlewareHandlers?: HonoMiddlewareHandlerTree<TMiddleware>;
	errorMode?: ErrorMode;
	basePath?: string;
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
};
