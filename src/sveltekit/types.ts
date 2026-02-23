import type { RequestEvent, RequestHandler } from "@sveltejs/kit";
import type { Contract } from "~/contract/types.js";
import type { ContractForRoutePath, RouterRoutePath } from "~/internal/route_types.js";
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

export type SvelteKitImplementer<TRouter> = <TRoute extends RouterRoutePath<TRouter>>(
	route: TRoute,
	handler: SvelteKitServerHandler<ContractForRoutePath<TRouter, TRoute>>,
) => RequestHandler;
