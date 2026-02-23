import type { RequestHandler } from "@sveltejs/kit";
import { getContractForRoutePath } from "~/internal/router_runtime.js";
import { buildContractResponse, parseContractInput } from "~/internal/server_runtime.js";
import type { InitSvelteKitOptions, SvelteKitImplementer } from "~/sveltekit/types.js";

function getRequestQuery(event: Parameters<RequestHandler>[0]): Record<string, string> {
	return Object.fromEntries(event.url.searchParams.entries());
}

function getRequestHeaders(event: Parameters<RequestHandler>[0]): Record<string, string> {
	return Object.fromEntries(event.request.headers.entries());
}

export function initSvelteKit<TRouter>(
	router: TRouter,
	options?: InitSvelteKitOptions,
): SvelteKitImplementer<TRouter> {
	const defaultBypassIncomingParse = options?.bypassIncomingParse ?? false;
	const defaultBypassOutgoingParse = options?.bypassOutgoingParse ?? false;

	const implementer: SvelteKitImplementer<TRouter> = (route, handler): RequestHandler => {
		const contract = getContractForRoutePath(router, route);

		return async (event) => {
			const input = await parseContractInput(
				contract,
				{
					pathParams: event.params,
					query: getRequestQuery(event),
					headers: getRequestHeaders(event),
					body: contract.body ? await event.request.json() : undefined,
				},
				defaultBypassIncomingParse,
			);

			const output = await handler(input, event);
			return await buildContractResponse(contract, output, defaultBypassOutgoingParse);
		};
	};

	return implementer;
}

export * from "~/sveltekit/types.js";
