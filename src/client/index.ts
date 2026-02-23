import type {
	Client,
	ClientOptions,
	ClientRequestForRoute,
	ClientRoute,
	ContractForRoute,
	HeaderFactoryValue,
	ParsedResponseForRoute,
} from "~/client/types.js";
import type { Contract } from "~/contract/types.js";
import { getContractForRoutePath } from "~/internal/router_runtime.js";

function routeToSegments(route: string): Array<string> {
	const withoutLeadingSlash = route.startsWith("/") ? route.slice(1) : route;
	return withoutLeadingSlash.split("/").filter(Boolean);
}

function getContractForRoute<TRouter, TRoute extends ClientRoute<TRouter>>(
	router: TRouter,
	route: TRoute,
): ContractForRoute<TRouter, TRoute> {
	return getContractForRoutePath(router, route) as ContractForRoute<TRouter, TRoute>;
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
	const client: Client<TRouter> = {
		async fetch<TRoute extends ClientRoute<TRouter>>(
			route: TRoute,
			...args: keyof ClientRequestForRoute<TRouter, TRoute> extends never
				? [request?: ClientRequestForRoute<TRouter, TRoute>]
				: [request: ClientRequestForRoute<TRouter, TRoute>]
		): Promise<ParsedResponseForRoute<TRouter, TRoute>> {
			const [url, requestInit] = await this.fetchConfig(
				route,
				...(args as [ClientRequestForRoute<TRouter, TRoute>]),
			);
			const response = await fetch(url, requestInit);
			return await this.parseResponse(route, response);
		},

		async fetchConfig<TRoute extends ClientRoute<TRouter>>(
			route: TRoute,
			...args: keyof ClientRequestForRoute<TRouter, TRoute> extends never
				? [request?: ClientRequestForRoute<TRouter, TRoute>]
				: [request: ClientRequestForRoute<TRouter, TRoute>]
		): Promise<[string, RequestInit]> {
			const contract = getContractForRoute(router, route) as Contract;
			const request = (args[0] ?? {}) as Record<string, unknown>;

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
			const query = buildQueryString(
				parsedRequest.query as Record<string, string | undefined>,
			);
			const normalizedBaseUrl = options.baseUrl.endsWith("/")
				? options.baseUrl.slice(0, -1)
				: options.baseUrl;

			const init: RequestInit = {
				method: contract.method.toUpperCase(),
				headers: resolvedHeaders,
			};

			if (parsedRequest.body !== undefined) {
				init.body = JSON.stringify(parsedRequest.body);
			}

			return [`${normalizedBaseUrl}${path}${query}`, init];
		},

		async parseResponse<TRoute extends ClientRoute<TRouter>>(
			route: TRoute,
			response: Response,
		): Promise<ParsedResponseForRoute<TRouter, TRoute>> {
			const contract = getContractForRoute(router, route) as Contract;
			const parsed = await parseIncomingResponse(
				contract,
				response,
				options.bypassIncomingParse ?? false,
			);

			return parsed as ParsedResponseForRoute<TRouter, TRoute>;
		},
	};

	return client;
}

export * from "~/client/types.js";
