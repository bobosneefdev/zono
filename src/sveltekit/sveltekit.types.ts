import type { RequestEvent, RequestHandler } from "@sveltejs/kit";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type { ContractMapForRoutePath, RouterRoutePath } from "~/lib/route.types.js";
import type { ServerHandler } from "~/lib/server.types.js";

export type InitSvelteKitOptions<TParams extends Array<unknown>> = {
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
	getHandlerParams: (event: RequestEvent) => [...TParams];
};

export type SvelteKitServerHandler<
	TContract extends Contract,
	TParams extends Array<unknown>,
> = ServerHandler<TContract, TParams>;

type SvelteKitHandlerMapForContractMap<
	TContractMap extends ContractMethodMap,
	TParams extends Array<unknown>,
> = {
	[TMethod in ContractMethod as TContractMap[TMethod] extends Contract
		? TMethod
		: never]: SvelteKitServerHandler<Extract<TContractMap[TMethod], Contract>, TParams>;
};

type SvelteKitExportMapForContractMap<TContractMap extends ContractMethodMap> = {
	[TMethod in keyof TContractMap & ContractMethod as Uppercase<TMethod>]-?: RequestHandler;
};

export type SvelteKitImplementer<TRouter, TParams extends Array<unknown>> = <
	TRoute extends RouterRoutePath<TRouter>,
>(
	route: TRoute,
	handlersByMethod: SvelteKitHandlerMapForContractMap<
		ContractMapForRoutePath<TRouter, TRoute>,
		TParams
	>,
) => SvelteKitExportMapForContractMap<ContractMapForRoutePath<TRouter, TRoute>>;
