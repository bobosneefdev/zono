import type { RequestEvent, RequestHandler } from "@sveltejs/kit";
import type { ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type { ServerHandlerMethodMap, ServerOptionsBase } from "~/internal/handler.types.js";
import type { RouterPath, RouterPathContractMap } from "~/router/router.resolve.types.js";

export type SvelteKitOptions<TParams extends Array<unknown>> = ServerOptionsBase<
	[RequestEvent],
	TParams
>;

type SvelteKitExportMapForContractMap<TContractMap extends ContractMethodMap> = {
	[TMethod in keyof TContractMap & ContractMethod as Uppercase<TMethod>]-?: RequestHandler;
};

export type SvelteKitImplementer<TRouter, TParams extends Array<unknown>> = <
	TPath extends RouterPath<TRouter>,
>(
	path: TPath,
	handlersByMethod: ServerHandlerMethodMap<RouterPathContractMap<TRouter, TPath>, TParams>,
) => SvelteKitExportMapForContractMap<RouterPathContractMap<TRouter, TPath>>;
