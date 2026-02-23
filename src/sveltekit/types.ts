import type { RequestEvent, RequestHandler } from "@sveltejs/kit";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/types.js";
import type { ContractMapForRoutePath, RouterRoutePath } from "~/internal/route_types.js";
import type { ServerHandlerInput, ServerHandlerOutput } from "~/internal/server_types.js";
import type { PossiblePromise } from "~/internal/types.js";

export type InitSvelteKitOptions = {
	bypassIncomingParse?: boolean;
	bypassOutgoingParse?: boolean;
};

export type SvelteKitServerHandler<TContract extends Contract> = (
	data: ServerHandlerInput<TContract>,
	event: RequestEvent,
) => PossiblePromise<ServerHandlerOutput<TContract>>;

type SvelteKitExportMethod = Uppercase<ContractMethod>;

type SvelteKitExportMethodForContractMethod<TMethod extends ContractMethod> =
	Uppercase<TMethod> extends SvelteKitExportMethod ? Uppercase<TMethod> : never;

type ContractMethodsFromMap<TContractMap extends ContractMethodMap> = {
	[TMethod in ContractMethod]-?: TContractMap[TMethod] extends Contract ? TMethod : never;
}[ContractMethod];

type SvelteKitHandlerForMethod<
	TContractMap extends ContractMethodMap,
	TMethod extends ContractMethod,
> = TContractMap[TMethod] extends Contract ? SvelteKitServerHandler<TContractMap[TMethod]> : never;

type SvelteKitHandlerMapForContractMap<TContractMap extends ContractMethodMap> = {
	[TMethod in ContractMethod]: SvelteKitHandlerForMethod<TContractMap, TMethod>;
} extends infer TAllHandlers extends Record<ContractMethod, unknown>
	? {
			[TMethod in ContractMethodsFromMap<TContractMap>]-?: TAllHandlers[TMethod];
		} & {
			[TMethod in Exclude<ContractMethod, ContractMethodsFromMap<TContractMap>>]?: never;
		}
	: never;

type SvelteKitExportMapForContractMap<TContractMap extends ContractMethodMap> = {
	[TMethod in ContractMethodsFromMap<TContractMap> as SvelteKitExportMethodForContractMethod<TMethod>]-?: RequestHandler;
} & {
	[TMethod in Exclude<
		ContractMethod,
		ContractMethodsFromMap<TContractMap>
	> as SvelteKitExportMethodForContractMethod<TMethod>]?: never;
};

export type SvelteKitImplementer<TRouter> = <TRoute extends RouterRoutePath<TRouter>>(
	route: TRoute,
	handlersByMethod: SvelteKitHandlerMapForContractMap<ContractMapForRoutePath<TRouter, TRoute>>,
) => SvelteKitExportMapForContractMap<ContractMapForRoutePath<TRouter, TRoute>>;
