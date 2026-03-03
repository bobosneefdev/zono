import superjson from "superjson";
import type {
	Contract,
	ContractQuery,
	ContractResponses,
	ErrorMode,
} from "~/contract/contract.types.js";
import { parseResponseBody } from "~/internal/body.util.js";
import { parseContractFields } from "~/internal/parse.js";
import { CONTRACT_METHOD_ORDER, isRecord } from "~/internal/util.js";
import type {
	ClientOptions,
	ClientOptionsDefaultHeaderValue,
	ClientProxy,
} from "./client.types.js";

const HTTP_METHODS = new Set<string>(CONTRACT_METHOD_ORDER);

function resolveContract(routes: unknown, pathSegments: Array<string>, method: string): Contract {
	let node = routes as Record<string, unknown>;
	for (const segment of pathSegments) {
		const router = node.ROUTER as Record<string, unknown> | undefined;
		if (!router || !(segment in router)) {
			throw new Error(`Unknown path segment: ${segment}`);
		}
		node = router[segment] as Record<string, unknown>;
	}
	const contractMap = node.CONTRACT as Record<string, unknown> | undefined;
	if (!contractMap || !(method in contractMap)) {
		throw new Error(`No contract for ${method.toUpperCase()} /${pathSegments.join("/")}`);
	}
	return contractMap[method] as Contract;
}

function collectMiddlewareResponsesFromDef(
	mwDef: unknown,
	pathSegments: Array<string>,
	acc: Record<number, unknown>,
): void {
	if (!isRecord(mwDef)) return;

	if (isRecord(mwDef.MIDDLEWARE)) {
		for (const responses of Object.values(mwDef.MIDDLEWARE)) {
			if (isRecord(responses)) {
				Object.assign(acc, responses);
			}
		}
	}

	let current: Record<string, unknown> = mwDef;
	for (const segment of pathSegments) {
		const router = current.ROUTER as Record<string, unknown> | undefined;
		if (!router || !(segment in router)) break;
		current = router[segment] as Record<string, unknown>;
		if (isRecord(current.MIDDLEWARE)) {
			for (const responses of Object.values(current.MIDDLEWARE as Record<string, unknown>)) {
				if (isRecord(responses)) {
					Object.assign(acc, responses);
				}
			}
		}
	}
}

function collectAllMiddlewareResponses(
	middlewares: ReadonlyArray<unknown>,
	pathSegments: Array<string>,
): ContractResponses {
	const acc: Record<number, unknown> = {};
	for (const mw of middlewares) {
		collectMiddlewareResponsesFromDef(mw, pathSegments, acc);
	}
	return acc as ContractResponses;
}

function buildPathWithParams(
	pathSegments: Array<string>,
	pathParams?: Record<string, string>,
): string {
	const mapped = pathSegments.map((segment) => {
		if (!segment.startsWith("$")) return segment;
		const paramName = segment.slice(1);
		const paramValue = pathParams?.[paramName];
		if (typeof paramValue !== "string") {
			throw new Error(`Missing required path param: ${paramName}`);
		}
		return encodeURIComponent(paramValue);
	});
	return `/${mapped.join("/")}`;
}

function buildQueryStringStandard(
	query?: Record<string, string | Array<string> | undefined>,
): string {
	if (!query) return "";
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
	if (!queryContract || query === undefined) return "";
	if (queryContract.type === "SuperJSON") {
		return `?${new URLSearchParams({ superjson: superjson.stringify(query) }).toString()}`;
	}
	return buildQueryStringStandard(query as Record<string, string | Array<string> | undefined>);
}

async function resolveHeaderValue(value: ClientOptionsDefaultHeaderValue): Promise<string> {
	return typeof value === "string" ? value : await value();
}

async function resolveDefaultHeaders(
	defaultHeaders: ClientOptions["defaultHeaders"],
): Promise<Headers> {
	const headers = new Headers();
	if (!defaultHeaders) return headers;
	for (const [key, value] of Object.entries(defaultHeaders)) {
		headers.set(key, await resolveHeaderValue(value));
	}
	return headers;
}

async function parseIncomingResponse(
	contract: Contract,
	response: Response,
	serverErrorMode: ErrorMode | undefined,
	additionalResponses: ContractResponses | undefined,
): Promise<{
	status: number;
	body: unknown;
	headers: unknown;
	response: Response;
}> {
	if (
		serverErrorMode &&
		(response.status === 400 || response.status === 404 || response.status === 500)
	) {
		const body = await response.clone().json();
		return { status: response.status, body, headers: undefined, response };
	}

	const statusDefinition =
		contract.responses[response.status] ?? additionalResponses?.[response.status];
	if (!statusDefinition) {
		throw new Error(`Unexpected response status: ${response.status}`);
	}

	const body = await parseResponseBody(statusDefinition, response);

	let headers: unknown;
	if (statusDefinition.headers) {
		if (statusDefinition.headers.type === "SuperJSON") {
			const encoded = response.headers.get("x-zono-superjson-headers");
			headers = encoded ? superjson.parse(encoded) : undefined;
		} else {
			const rawHeaders = Object.fromEntries(response.headers.entries());
			headers = await statusDefinition.headers.schema.parseAsync(rawHeaders);
		}
	}

	return { status: response.status, body, headers, response };
}

/**
 * Creates a type-safe HTTP client from contract definitions.
 * Provides autocomplete for routes, methods, and validates request/response types.
 * @param contracts - Contract definition from createContracts()
 * @param options - Client configuration options
 * @returns Type-safe client proxy for making HTTP requests
 */
export function createClient<
	const TContracts,
	const TMiddlewares extends ReadonlyArray<unknown> = [],
	TErrorMode extends ErrorMode | undefined = undefined,
>(
	contracts: TContracts,
	options: ClientOptions<TMiddlewares, TErrorMode>,
): ClientProxy<TContracts, TMiddlewares, TErrorMode> {
	const middlewares = (options.middleware ?? []) as ReadonlyArray<unknown>;

	async function executeRequest(
		pathSegments: Array<string>,
		method: string,
		input: Record<string, unknown>,
	): Promise<unknown> {
		const contract = resolveContract(contracts, pathSegments, method);

		const rawInput = {
			pathParams: input.pathParams,
			body: input.body,
			query: input.query,
			headers: input.headers,
		};
		const parseResult = await parseContractFields(contract, rawInput, "client");
		if (!parseResult.success) {
			const message = parseResult.issues.map((i) => i.message).join("; ");
			throw new Error(`Contract validation failed: ${message}`);
		}
		const parsed = parseResult.data as unknown as Record<string, unknown>;

		const resolvedHeaders = await resolveDefaultHeaders(options.defaultHeaders);

		// Apply typed headers to request headers
		if (parsed.headers && typeof parsed.headers === "object") {
			if (contract.headers?.type === "SuperJSON") {
				resolvedHeaders.set(
					"x-zono-superjson-headers",
					superjson.stringify(parsed.headers),
				);
			} else {
				for (const [headerKey, headerValue] of Object.entries(
					parsed.headers as Record<string, unknown>,
				)) {
					if (typeof headerValue === "string") {
						resolvedHeaders.set(headerKey, headerValue);
					}
				}
			}
		}

		const fullPath = buildPathWithParams(
			pathSegments,
			parsed.pathParams as Record<string, string> | undefined,
		);
		const queryString = buildQueryString(contract.query, parsed.query);
		const normalizedBaseUrl = options.baseUrl.endsWith("/")
			? options.baseUrl.slice(0, -1)
			: options.baseUrl;

		const init: RequestInit = {
			method: method.toUpperCase(),
			headers: resolvedHeaders,
		};

		// Encode request body based on contract body type
		if (contract.body && parsed.body !== undefined) {
			switch (contract.body.type) {
				case "JSON":
					init.body = JSON.stringify(parsed.body);
					if (!resolvedHeaders.has("content-type")) {
						resolvedHeaders.set("content-type", "application/json");
					}
					break;
				case "SuperJSON":
					init.body = JSON.stringify(superjson.serialize(parsed.body));
					if (!resolvedHeaders.has("content-type")) {
						resolvedHeaders.set("content-type", "application/json");
					}
					break;
				case "String":
					init.body = String(parsed.body);
					if (!resolvedHeaders.has("content-type")) {
						resolvedHeaders.set("content-type", "text/plain");
					}
					break;
				case "URLSearchParams":
					init.body = parsed.body as URLSearchParams;
					break;
				case "FormData":
					init.body = parsed.body as FormData;
					break;
				case "Blob":
					init.body = parsed.body as Blob;
					break;
				case "Uint8Array":
					init.body = (parsed.body as Uint8Array).buffer as ArrayBuffer;
					break;
			}
		}

		const response = await fetch(`${normalizedBaseUrl}${fullPath}${queryString}`, init);
		const additionalResponses = collectAllMiddlewareResponses(middlewares, pathSegments);

		return parseIncomingResponse(
			contract,
			response,
			options.serverErrorMode,
			Object.keys(additionalResponses).length > 0 ? additionalResponses : undefined,
		);
	}

	function createProxy(pathSegments: Array<string>): unknown {
		return new Proxy(() => {}, {
			get(_target, prop) {
				if (typeof prop !== "string") return undefined;
				if (HTTP_METHODS.has(prop)) {
					return async (input: Record<string, unknown> = {}) => {
						return executeRequest(pathSegments, prop, input);
					};
				}
				return createProxy([...pathSegments, prop]);
			},
		});
	}

	return createProxy([]) as ClientProxy<TContracts, TMiddlewares, TErrorMode>;
}
