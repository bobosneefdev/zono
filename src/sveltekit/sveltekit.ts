import type { RequestHandler } from "@sveltejs/kit";
import type { ContractMethod } from "~/contract/contract.types.js";
import { buildContractResponse, parseContractInput } from "~/internal/server.js";
import { resolveRouteMethodContract } from "~/router/router.resolve.js";
import type { RouterContractGivenPathAndMethod } from "~/router/router.resolve.types.js";
import type {
	InitSvelteKitOptions,
	SvelteKitImplementer,
	SvelteKitServerHandler,
} from "~/sveltekit/sveltekit.types.js";

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
	options: InitSvelteKitOptions<TParams>,
): SvelteKitImplementer<TRouter, TParams> {
	const defaultBypassIncomingParse = options.bypassIncomingParse ?? false;
	const defaultBypassOutgoingParse = options.bypassOutgoingParse ?? false;
	const { getHandlerParams } = options;

	const implementer: SvelteKitImplementer<TRouter, TParams> = (route, handlersByMethod) => {
		const routeExports: Partial<Record<SvelteKitMethodExport, RequestHandler>> = {};

		type MethodContract<TMethod extends ContractMethod> = RouterContractGivenPathAndMethod<
			TRouter,
			typeof route,
			TMethod
		>;

		const registerMethod = <TMethod extends ContractMethod>(
			method: TMethod,
			handler: SvelteKitServerHandler<MethodContract<TMethod>, TParams>,
		): void => {
			if (!handler) {
				return;
			}

			const contract = resolveRouteMethodContract(router, route, method);
			routeExports[toSvelteKitMethodExport(method)] = async (event) => {
				const input = await parseContractInput(
					contract,
					{
						pathParams: event.params,
						query: getRequestQuery(event),
						headers: getRequestHeaders(event),
						payload: contract.payload ? await parseRequestBody(event) : undefined,
					},
					defaultBypassIncomingParse,
				);

				const handlerParams = getHandlerParams(event);
				const output = await handler(input, ...handlerParams);
				return await buildContractResponse(contract, output, defaultBypassOutgoingParse);
			};
		};

		const getHandler = (handlersByMethod as { get?: unknown }).get;
		if (typeof getHandler === "function") {
			registerMethod(
				"get",
				getHandler as SvelteKitServerHandler<MethodContract<"get">, TParams>,
			);
		}

		const postHandler = (handlersByMethod as { post?: unknown }).post;
		if (typeof postHandler === "function") {
			registerMethod(
				"post",
				postHandler as SvelteKitServerHandler<MethodContract<"post">, TParams>,
			);
		}

		const putHandler = (handlersByMethod as { put?: unknown }).put;
		if (typeof putHandler === "function") {
			registerMethod(
				"put",
				putHandler as SvelteKitServerHandler<MethodContract<"put">, TParams>,
			);
		}

		const deleteHandler = (handlersByMethod as { delete?: unknown }).delete;
		if (typeof deleteHandler === "function") {
			registerMethod(
				"delete",
				deleteHandler as SvelteKitServerHandler<MethodContract<"delete">, TParams>,
			);
		}

		const patchHandler = (handlersByMethod as { patch?: unknown }).patch;
		if (typeof patchHandler === "function") {
			registerMethod(
				"patch",
				patchHandler as SvelteKitServerHandler<MethodContract<"patch">, TParams>,
			);
		}

		const optionsHandler = (handlersByMethod as { options?: unknown }).options;
		if (typeof optionsHandler === "function") {
			registerMethod(
				"options",
				optionsHandler as SvelteKitServerHandler<MethodContract<"options">, TParams>,
			);
		}

		const headHandler = (handlersByMethod as { head?: unknown }).head;
		if (typeof headHandler === "function") {
			registerMethod(
				"head",
				headHandler as SvelteKitServerHandler<MethodContract<"head">, TParams>,
			);
		}

		return routeExports as ReturnType<SvelteKitImplementer<TRouter, TParams>>;
	};

	return implementer;
}
