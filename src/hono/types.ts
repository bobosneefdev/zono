import type { Context, MiddlewareHandler } from "hono";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/types.js";
import type { ServerHandler } from "~/lib/server_types.js";

export type HonoMiddleware = MiddlewareHandler;

export type HonoServerHandler<
	TContract extends Contract,
	TParams extends Array<unknown> = [Context],
> = ServerHandler<TContract, TParams>;

type HonoHandlerMethodMap<
	TContractMap extends ContractMethodMap,
	TParams extends Array<unknown>,
> = {
	[TMethod in ContractMethod as TContractMap[TMethod] extends Contract
		? TMethod
		: never]: ServerHandler<Extract<TContractMap[TMethod], Contract>, TParams>;
};

type HonoHandlerNode<TNode, TParams extends Array<unknown>> = TNode extends {
	contract: infer TContractMap extends ContractMethodMap;
}
	? {
			handler: HonoHandlerMethodMap<TContractMap, TParams>;
			middleware?: Array<HonoMiddleware>;
		} & (TNode extends { router: infer TRouter }
			? { router: HonoServerHandlerTree<TRouter, TParams> }
			: { router?: undefined })
	: TNode extends Record<string, unknown>
		? HonoServerHandlerTree<TNode, TParams>
		: never;

export type HonoServerHandlerTree<TRouter, TParams extends Array<unknown> = [Context]> = {
	[K in keyof TRouter]: HonoHandlerNode<TRouter[K], TParams>;
};

export type InitHonoOptions<TParams extends Array<unknown> = [Context]> = {
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
	getHandlerParams?: (context: Context) => TParams;
	globalMiddleware?: Array<HonoMiddleware>;
};
