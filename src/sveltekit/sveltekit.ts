import type { RequestHandler } from "@sveltejs/kit";
import type { Contract, ContractMethod } from "~/contract/contract.types.js";
import {
	buildContractResponse,
	buildValidationErrorResponse,
	parseContractInput,
} from "~/internal/server.js";
import type { ServerHandler } from "~/internal/server.types.js";
import { CONTRACT_METHOD_ORDER } from "~/internal/util.js";
import { resolveRouteMethodContract } from "~/router/router.resolve.js";
import type { SvelteKitImplementer, SvelteKitOptions } from "~/sveltekit/sveltekit.types.js";

function getRequestQuery(event: Parameters<RequestHandler>[0]): Record<string, string> {
	return Object.fromEntries(event.url.searchParams.entries());
}

function getRequestHeaders(event: Parameters<RequestHandler>[0]): Record<string, string> {
	return Object.fromEntries(event.request.headers.entries());
}

type SvelteKitMethodExport = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

function toSvelteKitMethodExport(method: ContractMethod): SvelteKitMethodExport {
	return method.toUpperCase() as SvelteKitMethodExport;
}

async function parseRequestBody(event: Parameters<RequestHandler>[0]): Promise<unknown> {
	const contentType = event.request.headers.get("content-type") ?? "";
	if (contentType.toLowerCase().includes("application/json")) {
		return await event.request.json();
	}

	return await event.request.formData();
}

export function initSvelteKit<TRouter, TParams extends Array<unknown>>(
	router: TRouter,
	options: SvelteKitOptions<TParams>,
): SvelteKitImplementer<TRouter, TParams> {
	const defaultBypassIncomingParse = options.bypassIncomingParse ?? false;
	const defaultBypassOutgoingParse = options.bypassOutgoingParse ?? false;
	const errorMode = options.errorMode ?? "hidden";
	const transformParams = options.transformParams ?? ((...args) => args);

	const implementer: SvelteKitImplementer<TRouter, TParams> = (route, handlersByMethod) => {
		const routeExports: Partial<Record<SvelteKitMethodExport, RequestHandler>> = {};
		const handlerMap = handlersByMethod as unknown as Record<
			string,
			ServerHandler<Contract, Array<unknown>> | undefined
		>;

		for (const method of CONTRACT_METHOD_ORDER) {
			const handler = handlerMap[method];
			if (!handler) {
				continue;
			}

			const contract: Contract = resolveRouteMethodContract(router, route, method);
			routeExports[toSvelteKitMethodExport(method)] = async (event) => {
				const parseResult = await parseContractInput(
					contract,
					{
						pathParams: event.params,
						query: getRequestQuery(event),
						headers: getRequestHeaders(event),
						payload: contract.payload ? await parseRequestBody(event) : undefined,
					},
					defaultBypassIncomingParse,
				);

				if (!parseResult.success) {
					return buildValidationErrorResponse(parseResult.issues, errorMode);
				}

				const handlerParams = transformParams(event);
				const result = await handler(parseResult.data, ...handlerParams);
				return await buildContractResponse(contract, result, defaultBypassOutgoingParse);
			};
		}

		return routeExports as ReturnType<SvelteKitImplementer<TRouter, TParams>>;
	};

	return implementer;
}
