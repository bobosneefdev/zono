import type {
	Client,
	ClientOptions,
	ClientOptionsDefaultHeaderValue,
	ClientOutputGivenPathAndMethod,
	ClientPathsAvailableGivenMethod,
	ClientRequestInputGivenMethodAndPath,
} from "~/client/client.types.js";
import { type Contract, type ContractMethod } from "~/contract/contract.types.js";
import { BYTES_CONTENT_TYPES, JSON_CONTENT_TYPES, TEXT_CONTENT_TYPES } from "~/lib/util.js";
import { resolveRouteMethodContract } from "~/router/router.resolve.js";

function routeToSegments(route: string): Array<string> {
	const withoutLeadingSlash = route.startsWith("/") ? route.slice(1) : route;
	return withoutLeadingSlash.split("/").filter(Boolean);
}

function getContractForRouteMethod<
	TRouter,
	TMethod extends ContractMethod,
	TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
>(router: TRouter, method: TMethod, route: TPath): Contract {
	return resolveRouteMethodContract(router, route, method) as Contract;
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

async function resolveHeaderValue(value: ClientOptionsDefaultHeaderValue): Promise<string> {
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

function isFormDataBody(value: unknown): value is FormData {
	return typeof FormData !== "undefined" && value instanceof FormData;
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
	if (statusDefinition.contentType === null) {
		// Do nothing
	} else if (JSON_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const rawBody = await response.clone().json();
		body = bypassIncomingParse ? rawBody : await statusDefinition.body.parseAsync(rawBody);
	} else if (TEXT_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const rawBody = await response.clone().text();
		body = bypassIncomingParse ? rawBody : await statusDefinition.body.parseAsync(rawBody);
	} else if (BYTES_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const rawBody = await response.clone().bytes();
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
		TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
	>(
		method: TMethod,
		path: TPath,
		request: Record<string, unknown>,
	): Promise<[string, RequestInit]> {
		const contract = getContractForRouteMethod(router, method, path);

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

		if (
			parsedRequest.body !== undefined &&
			!isFormDataBody(parsedRequest.body) &&
			!resolvedHeaders.has("content-type")
		) {
			resolvedHeaders.set("content-type", "application/json");
		}

		const routePath = String(path);
		const fullpath = buildPathWithParams(
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
			init.body = isFormDataBody(parsedRequest.body)
				? parsedRequest.body
				: JSON.stringify(parsedRequest.body);
		}

		return [`${normalizedBaseUrl}${fullpath}${query}`, init];
	}

	async function executeMethod<
		TMethod extends ContractMethod,
		TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
	>(
		method: TMethod,
		path: TPath,
		request: Record<string, unknown>,
	): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, TMethod>> {
		const [url, requestInit] = await fetchConfigForMethod(method, path, request);
		const response = await fetch(url, requestInit);
		return await client.parseResponse(method, path, response);
	}

	const client: Client<TRouter> = {
		async get<TPath extends ClientPathsAvailableGivenMethod<TRouter, "get">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<TRouter, "get", TPath> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "get", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "get", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "get">> {
			return await executeMethod("get", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async post<TPath extends ClientPathsAvailableGivenMethod<TRouter, "post">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<
				TRouter,
				"post",
				TPath
			> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "post", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "post", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "post">> {
			return await executeMethod("post", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async put<TPath extends ClientPathsAvailableGivenMethod<TRouter, "put">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<TRouter, "put", TPath> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "put", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "put", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "put">> {
			return await executeMethod("put", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async delete<TPath extends ClientPathsAvailableGivenMethod<TRouter, "delete">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<
				TRouter,
				"delete",
				TPath
			> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "delete", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "delete", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "delete">> {
			return await executeMethod("delete", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async patch<TPath extends ClientPathsAvailableGivenMethod<TRouter, "patch">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<
				TRouter,
				"patch",
				TPath
			> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "patch", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "patch", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "patch">> {
			return await executeMethod("patch", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async options<TPath extends ClientPathsAvailableGivenMethod<TRouter, "options">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<
				TRouter,
				"options",
				TPath
			> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "options", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "options", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "options">> {
			return await executeMethod("options", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async head<TPath extends ClientPathsAvailableGivenMethod<TRouter, "head">>(
			path: TPath,
			...args: keyof ClientRequestInputGivenMethodAndPath<
				TRouter,
				"head",
				TPath
			> extends never
				? [request?: ClientRequestInputGivenMethodAndPath<TRouter, "head", TPath>]
				: [request: ClientRequestInputGivenMethodAndPath<TRouter, "head", TPath>]
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, "head">> {
			return await executeMethod("head", path, (args[0] ?? {}) as Record<string, unknown>);
		},

		async parseResponse<
			TMethod extends ContractMethod,
			TPath extends ClientPathsAvailableGivenMethod<TRouter, TMethod>,
		>(
			method: TMethod,
			path: TPath,
			response: Response,
		): Promise<ClientOutputGivenPathAndMethod<TRouter, TPath, TMethod>> {
			const contract = getContractForRouteMethod(router, method, path);
			const parsed = await parseIncomingResponse(
				contract,
				response,
				options.bypassIncomingParse ?? false,
			);

			return parsed as ClientOutputGivenPathAndMethod<TRouter, TPath, TMethod>;
		},
	};

	return client;
}
