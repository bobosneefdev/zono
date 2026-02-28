import type {
	Client,
	ClientOptions,
	ClientOptionsDefaultHeaderValue,
	ClientPathsAvailableGivenMethod,
} from "~/client/client.types.js";
import type { ErrorMode } from "~/contract/contract.error.js";
import { parseContractFields } from "~/contract/contract.parse.js";
import { mergeContractResponses } from "~/contract/contract.responses.js";
import {
	type Contract,
	type ContractMethod,
	type ContractQuery,
	type ContractResponses,
} from "~/contract/contract.types.js";
import {
	BYTES_CONTENT_TYPES,
	CONTRACT_METHOD_ORDER,
	JSON_CONTENT_TYPES,
	TEXT_CONTENT_TYPES,
} from "~/internal/util.js";
import {
	resolveRouteMethodContract,
	resolveRouteMiddlewareResponses,
	routeToSegments,
} from "~/router/router.resolve.js";

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

function buildQueryStringStandard(
	query?: Record<string, string | Array<string> | undefined>,
): string {
	if (!query) {
		return "";
	}

	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (typeof value === "string") {
			searchParams.append(key, value);
		}

		if (Array.isArray(value)) {
			for (const inner of value) {
				if (typeof inner === "string") {
					searchParams.append(key, inner);
				}
			}
		}
	}

	const serialized = searchParams.toString();
	return serialized.length > 0 ? `?${serialized}` : "";
}

function buildQueryString(queryContract: ContractQuery | undefined, query: unknown): string {
	if (!queryContract || query === undefined) {
		return "";
	}

	if (queryContract.type === "json") {
		return `?${new URLSearchParams({ json: JSON.stringify(query) }).toString()}`;
	}

	return buildQueryStringStandard(query as Record<string, string | Array<string> | undefined>);
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
	const rawInput = {
		pathParams: rawRequest.pathParams,
		payload: rawRequest.payload,
		query: rawRequest.query,
		headers: rawRequest.headers,
	};
	const result = await parseContractFields(contract, rawInput, bypassOutgoingParse);
	if (!result.success) {
		const message = result.issues.map((i) => i.message).join("; ");
		throw new Error(`Contract validation failed: ${message}`);
	}
	return result.data as Record<string, unknown>;
}

async function parseIncomingResponse<TContract extends Contract>(
	contract: TContract,
	response: Response,
	bypassIncomingParse: boolean,
	serverErrorMode: ErrorMode | undefined,
	additionalResponses: ContractResponses | undefined,
): Promise<{
	status: number;
	body: unknown;
	headers: unknown;
	response: Response;
}> {
	if (serverErrorMode && response.status === 400) {
		const body = await response.clone().json();
		return { status: 400, body, headers: undefined, response };
	}

	const statusDefinition =
		contract.responses[response.status] ?? additionalResponses?.[response.status];
	if (!statusDefinition) {
		throw new Error(`Unexpected response status: ${response.status}`);
	}

	let body: unknown;
	if (statusDefinition.contentType === null) {
		// Do nothing
	} else if (JSON_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const rawBody = await response.clone().json();
		body = bypassIncomingParse ? rawBody : await statusDefinition.schema.parseAsync(rawBody);
	} else if (TEXT_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const rawBody = await response.clone().text();
		body = bypassIncomingParse ? rawBody : await statusDefinition.schema.parseAsync(rawBody);
	} else if (BYTES_CONTENT_TYPES.has(statusDefinition.contentType)) {
		const rawBody = await response.clone().bytes();
		body = bypassIncomingParse ? rawBody : await statusDefinition.schema.parseAsync(rawBody);
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

export function createClient<
	TRouter,
	TErrorMode extends ErrorMode | undefined = undefined,
	TAdditionalResponses extends ContractResponses = Record<never, never>,
>(
	router: TRouter,
	options: ClientOptions<TErrorMode, TAdditionalResponses>,
): Client<TRouter, TErrorMode, TAdditionalResponses> {
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
			parsedRequest.payload !== undefined &&
			!isFormDataBody(parsedRequest.payload) &&
			!resolvedHeaders.has("content-type")
		) {
			resolvedHeaders.set("content-type", "application/json");
		}

		const routePath = String(path);
		const fullpath = buildPathWithParams(
			routePath,
			parsedRequest.pathParams as Record<string, string>,
		);
		const query = buildQueryString(contract.query, parsedRequest.query);
		const normalizedBaseUrl = options.baseUrl.endsWith("/")
			? options.baseUrl.slice(0, -1)
			: options.baseUrl;

		const init: RequestInit = {
			method: method.toUpperCase(),
			headers: resolvedHeaders,
		};

		if (parsedRequest.payload !== undefined) {
			init.body = isFormDataBody(parsedRequest.payload)
				? parsedRequest.payload
				: JSON.stringify(parsedRequest.payload);
		}

		return [`${normalizedBaseUrl}${fullpath}${query}`, init];
	}

	async function executeMethod(
		method: ContractMethod,
		path: string,
		request: Record<string, unknown>,
	): Promise<unknown> {
		const [url, requestInit] = await fetchConfigForMethod(
			method,
			path as ClientPathsAvailableGivenMethod<TRouter, typeof method>,
			request,
		);
		const response = await fetch(url, requestInit);
		const contract = getContractForRouteMethod(
			router,
			method,
			path as ClientPathsAvailableGivenMethod<TRouter, typeof method>,
		);
		const middlewareResponses = resolveRouteMiddlewareResponses(router, path);
		const additionalResponses =
			options.additionalResponses && Object.keys(options.additionalResponses).length > 0
				? mergeContractResponses(middlewareResponses, options.additionalResponses)
				: Object.keys(middlewareResponses).length > 0
					? middlewareResponses
					: options.additionalResponses;
		return await parseIncomingResponse(
			contract,
			response,
			options.bypassIncomingParse ?? false,
			options.serverErrorMode,
			additionalResponses,
		);
	}

	function makeMethodHandler(method: ContractMethod) {
		return async (path: string, ...args: Array<unknown>) => {
			return await executeMethod(method, path, (args[0] ?? {}) as Record<string, unknown>);
		};
	}

	const client = {
		...Object.fromEntries(
			CONTRACT_METHOD_ORDER.map((method) => [method, makeMethodHandler(method)]),
		),
		async parseResponse(
			method: ContractMethod,
			path: string,
			response: Response,
		): Promise<unknown> {
			const contract = getContractForRouteMethod(
				router,
				method,
				path as ClientPathsAvailableGivenMethod<TRouter, typeof method>,
			);
			const middlewareResponses = resolveRouteMiddlewareResponses(router, path);
			const additionalResponses =
				options.additionalResponses && Object.keys(options.additionalResponses).length > 0
					? mergeContractResponses(middlewareResponses, options.additionalResponses)
					: Object.keys(middlewareResponses).length > 0
						? middlewareResponses
						: options.additionalResponses;
			return await parseIncomingResponse(
				contract,
				response,
				options.bypassIncomingParse ?? false,
				options.serverErrorMode,
				additionalResponses,
			);
		},
	} as Client<TRouter, TErrorMode, TAdditionalResponses>;

	return client;
}
