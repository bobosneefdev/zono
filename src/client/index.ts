import type {
	Client,
	ClientMethodRoute,
	ClientOptions,
	ClientRequestForRouteMethod,
	HeaderFactoryValue,
	ParsedResponseForRouteMethod,
} from "~/client/types.js";
import type { Contract, ContractMethod } from "~/contract/types.js";
import { getContractForRoutePathMethod } from "~/internal/router_runtime.js";

function routeToSegments(route: string): Array<string> {
	const withoutLeadingSlash = route.startsWith("/") ? route.slice(1) : route;
	return withoutLeadingSlash.split("/").filter(Boolean);
}

function getContractForRouteMethod<
	TRouter,
	TMethod extends ContractMethod,
	TRoute extends ClientMethodRoute<TRouter, TMethod>,
>(router: TRouter, method: TMethod, route: TRoute): Contract {
	return getContractForRoutePathMethod(router, route, method) as Contract;
}

function buildPathWithParams(pathTemplate: string, pathParams?: Record<string, string>): string {
	const segments = routeToSegments(pathTemplate);
	const mappedSegments = segments.map((segment) => {
		if (!segment.startsWith("$")) {
			return segment;
		}

		const paramName = segment.slice(1);
		const paramValue = pathParams?.[paramName];

		if (typeof paramValue !== "string") {
			throw new Error(`Missing required path param: ${paramName}`);
		}

		return encodeURIComponent(paramValue);
	});

	return `/${mappedSegments.join("/")}`;
}

function buildQueryString(query?: Record<string, string | undefined>): string {
	if (!query) {
		return "";
	}

	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (typeof value === "string") {
			searchParams.append(key, value);
		}
	}

	const serialized = searchParams.toString();
	return serialized.length > 0 ? `?${serialized}` : "";
}

async function resolveHeaderValue(value: HeaderFactoryValue): Promise<string> {
	if (typeof value === "string") {
		return value;
	}

	return await value();
}

async function resolveDefaultHeaders(
	defaultHeaders: ClientOptions["defaultHeaders"],
): Promise<Headers> {
	const headers = new Headers();
	if (!defaultHeaders) {
		return headers;
	}

	for (const [key, value] of Object.entries(defaultHeaders)) {
		headers.set(key, await resolveHeaderValue(value));
	}

	return headers;
}

async function parseOutgoingRequest(
	contract: Contract,
	rawRequest: Record<string, unknown>,
	bypassOutgoingParse: boolean,
): Promise<Record<string, unknown>> {
	if (bypassOutgoingParse) {
		return rawRequest;
	}

	const parsed: Record<string, unknown> = {};

	if (contract.pathParams) {
		parsed.pathParams = await contract.pathParams.parseAsync(rawRequest.pathParams);
	}

	if (contract.body) {
		parsed.body = await contract.body.parseAsync(rawRequest.body);
	}

	if (contract.query) {
		parsed.query = await contract.query.parseAsync(rawRequest.query);
	}

	if (contract.headers) {
		parsed.headers = await contract.headers.parseAsync(rawRequest.headers);
	}

	return parsed;
}

async function parseIncomingResponse<TContract extends Contract>(
	contract: TContract,
	response: Response,
	bypassIncomingParse: boolean,
): Promise<{
	status: number;
	body: unknown;
	headers: unknown;
	response: Response;
}> {
	const statusDefinition = contract.responses[response.status];
	if (!statusDefinition) {
		throw new Error(`Unexpected response status: ${response.status}`);
	}

	let body: unknown;
	if (statusDefinition.body) {
		const rawBody = await response.clone().json();
		body = bypassIncomingParse ? rawBody : await statusDefinition.body.parseAsync(rawBody);
	}

	let headers: unknown;
	if (statusDefinition.headers) {
		const rawHeaders = Object.fromEntries(response.headers.entries());
		headers = bypassIncomingParse
			? rawHeaders
			: await statusDefinition.headers.parseAsync(rawHeaders);
	}

	return {
		status: response.status,
		body,
		headers,
		response,
	};
}

export function createClient<TRouter>(router: TRouter, options: ClientOptions): Client<TRouter> {
	async function fetchConfigForMethod<
		TMethod extends ContractMethod,
		TRoute extends ClientMethodRoute<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TRoute,
		request: Record<string, unknown>,
	): Promise<[string, RequestInit]> {
		const contract = getContractForRouteMethod(router, method, route);

		const parsedRequest = await parseOutgoingRequest(
			contract,
			request,
			options.bypassOutgoingParse ?? false,
		);

		const resolvedHeaders = await resolveDefaultHeaders(options.defaultHeaders);

		if (parsedRequest.headers && typeof parsedRequest.headers === "object") {
			for (const [headerKey, headerValue] of Object.entries(parsedRequest.headers)) {
				if (typeof headerValue === "string") {
					resolvedHeaders.set(headerKey, headerValue);
				}
			}
		}

		if (parsedRequest.body !== undefined && !resolvedHeaders.has("content-type")) {
			resolvedHeaders.set("content-type", "application/json");
		}

		const routePath = String(route);
		const path = buildPathWithParams(
			routePath,
			parsedRequest.pathParams as Record<string, string>,
		);
		const query = buildQueryString(parsedRequest.query as Record<string, string | undefined>);
		const normalizedBaseUrl = options.baseUrl.endsWith("/")
			? options.baseUrl.slice(0, -1)
			: options.baseUrl;

		const init: RequestInit = {
			method: method.toUpperCase(),
			headers: resolvedHeaders,
		};

		if (parsedRequest.body !== undefined) {
			init.body = JSON.stringify(parsedRequest.body);
		}

		return [`${normalizedBaseUrl}${path}${query}`, init];
	}

	async function executeMethod<
		TMethod extends ContractMethod,
		TRoute extends ClientMethodRoute<TRouter, TMethod>,
	>(
		method: TMethod,
		route: TRoute,
		request: Record<string, unknown>,
	): Promise<ParsedResponseForRouteMethod<TRouter, TMethod, TRoute>> {
		const [url, requestInit] = await fetchConfigForMethod(method, route, request);
		const response = await fetch(url, requestInit);
		return await client.parseResponse(method, route, response);
	}

	const client: Client<TRouter> = {
		async get<TRoute extends ClientMethodRoute<TRouter, "get">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "get", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "get", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "get", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "get", TRoute>> {
			return await executeMethod("get", route, (args[0] ?? {}) as Record<string, unknown>);
		},

		async post<TRoute extends ClientMethodRoute<TRouter, "post">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "post", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "post", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "post", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "post", TRoute>> {
			return await executeMethod("post", route, (args[0] ?? {}) as Record<string, unknown>);
		},

		async put<TRoute extends ClientMethodRoute<TRouter, "put">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "put", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "put", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "put", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "put", TRoute>> {
			return await executeMethod("put", route, (args[0] ?? {}) as Record<string, unknown>);
		},

		async delete<TRoute extends ClientMethodRoute<TRouter, "delete">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "delete", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "delete", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "delete", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "delete", TRoute>> {
			return await executeMethod("delete", route, (args[0] ?? {}) as Record<string, unknown>);
		},

		async patch<TRoute extends ClientMethodRoute<TRouter, "patch">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "patch", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "patch", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "patch", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "patch", TRoute>> {
			return await executeMethod("patch", route, (args[0] ?? {}) as Record<string, unknown>);
		},

		async options<TRoute extends ClientMethodRoute<TRouter, "options">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "options", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "options", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "options", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "options", TRoute>> {
			return await executeMethod(
				"options",
				route,
				(args[0] ?? {}) as Record<string, unknown>,
			);
		},

		async head<TRoute extends ClientMethodRoute<TRouter, "head">>(
			route: TRoute,
			...args: keyof ClientRequestForRouteMethod<TRouter, "head", TRoute> extends never
				? [request?: ClientRequestForRouteMethod<TRouter, "head", TRoute>]
				: [request: ClientRequestForRouteMethod<TRouter, "head", TRoute>]
		): Promise<ParsedResponseForRouteMethod<TRouter, "head", TRoute>> {
			return await executeMethod("head", route, (args[0] ?? {}) as Record<string, unknown>);
		},

		async parseResponse<
			TMethod extends ContractMethod,
			TRoute extends ClientMethodRoute<TRouter, TMethod>,
		>(
			method: TMethod,
			route: TRoute,
			response: Response,
		): Promise<ParsedResponseForRouteMethod<TRouter, TMethod, TRoute>> {
			const contract = getContractForRouteMethod(router, method, route);
			const parsed = await parseIncomingResponse(
				contract,
				response,
				options.bypassIncomingParse ?? false,
			);

			return parsed as ParsedResponseForRouteMethod<TRouter, TMethod, TRoute>;
		},
	};

	return client;
}

export * from "~/client/types.js";
