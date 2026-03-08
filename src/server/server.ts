import type { Context, Hono } from "hono";
import superjson from "superjson";
import {
	compileContractRoutes,
	getContractRequestParsers,
	getContractResponseSchema,
	getRuntimeResponseSchemaParser,
	validateContractResponseType,
} from "../contract/contract.js";
import type {
	ContractBodySchema,
	ContractHeadersSchema,
	ContractMethodDefinition,
	ContractQuerySchema,
	Contracts,
} from "../contract/contract.types.js";
import { runMiddlewareHandlers } from "../middleware/middleware.js";
import {
	createSerializedResponse,
	getRequestHeadersObject,
	getRequestQueryObject,
} from "../shared/shared.js";
import type { Shape } from "../shared/shared.types.js";
import type {
	BoundContractHandlers,
	ContractHandlersFromContracts,
	ErrorMode,
	InitHonoOptions,
	RuntimeHandlerResponse,
} from "./server.types.js";

const registerHonoRoute = (
	app: Hono,
	method: import("../contract/contract.types.js").HTTPMethod,
	path: string,
	handler: (ctx: Context) => Promise<Response>,
): void => {
	app.on(method.toUpperCase(), path, handler);
};

const parseQueryInput = (querySchema: ContractQuerySchema, requestUrl: URL): unknown => {
	const baseQuery = getRequestQueryObject(requestUrl);
	if (querySchema.type === "Standard") {
		return baseQuery;
	}
	const parsedQuery: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(baseQuery)) {
		if (value === undefined) {
			parsedQuery[key] = undefined;
			continue;
		}
		if (querySchema.type === "SuperJSON") {
			parsedQuery[key] = superjson.parse(value);
			continue;
		}
		parsedQuery[key] = JSON.parse(value);
	}
	return parsedQuery;
};

const parseHeadersInput = (headersSchema: ContractHeadersSchema, headers: Headers): unknown => {
	const rawHeaders = getRequestHeadersObject(headers);
	if (headersSchema.type === "Standard") {
		return rawHeaders;
	}
	const parsedHeaders: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rawHeaders)) {
		if (value === undefined) {
			parsedHeaders[key] = undefined;
			continue;
		}
		if (headersSchema.type === "SuperJSON") {
			parsedHeaders[key] = superjson.parse(value);
			continue;
		}
		parsedHeaders[key] = JSON.parse(value);
	}
	return parsedHeaders;
};

const parseBodyInput = async (
	bodySchema: ContractBodySchema,
	request: Request,
): Promise<unknown> => {
	if (bodySchema.type === "JSON") {
		return request.json();
	}
	if (bodySchema.type === "SuperJSON") {
		return superjson.parse(await request.text());
	}
	if (bodySchema.type === "FormData") {
		return request.formData();
	}
	if (bodySchema.type === "URLSearchParams") {
		return new URLSearchParams(await request.text());
	}
	if (bodySchema.type === "Text") {
		return request.text();
	}
	return request.blob();
};

class RequestValidationError extends Error {
	readonly issues: Array<unknown>;

	constructor(message: string, issues: Array<unknown>) {
		super(message);
		this.name = "RequestValidationError";
		this.issues = issues;
	}
}

const createRequestValidationError = (
	segment: "Path params" | "Query" | "Headers" | "Body",
	issues: Array<unknown>,
): RequestValidationError => {
	return new RequestValidationError(`${segment} validation failed`, issues);
};

const createParseFailureIssue = (error: unknown): unknown => {
	if (error instanceof Error) {
		return { message: error.message };
	}
	return { message: "Failed to parse request input" };
};

const makeNotFoundResponse = (): RuntimeHandlerResponse => {
	return {
		status: 404,
		type: "JSON",
		data: {
			message: "Not Found",
		},
	};
};

const makeErrorResponse = (error: unknown, errorMode: ErrorMode): RuntimeHandlerResponse => {
	if (error instanceof RequestValidationError) {
		if (errorMode === "public") {
			return {
				status: 400,
				type: "JSON",
				data: {
					message: error.message,
					issues: error.issues,
				},
			};
		}
		return {
			status: 400,
			type: "JSON",
			data: {
				message: error.message,
				issueCount: error.issues.length,
			},
		};
	}

	if (errorMode === "public") {
		return {
			status: 500,
			type: "JSON",
			data: {
				message: error instanceof Error ? error.message : "Internal server error",
			},
		};
	}
	return {
		status: 500,
		type: "JSON",
		data: {
			message: error instanceof Error ? error.message : "Internal server error",
			issues: error,
			stack: error instanceof Error ? error.stack : undefined,
		},
	};
};

const validateResponse = (
	methodDefinition: ContractMethodDefinition,
	response: RuntimeHandlerResponse,
): void => {
	const responseSchema = getContractResponseSchema(methodDefinition, response.status);
	if (!responseSchema) {
		throw new Error(`Handler returned undeclared status: ${response.status}`);
	}
	if (!validateContractResponseType(responseSchema, response.type)) {
		throw new Error(
			`Handler returned mismatched response type. Expected ${responseSchema.type}, received ${response.type}`,
		);
	}
	const responseParser = getRuntimeResponseSchemaParser(responseSchema);
	if (responseParser) {
		const parseResult = responseParser.safeParse(response.data);
		if (!parseResult.success) {
			throw new Error("Handler response data validation failed");
		}
	}
};

const getHandlerAtPath = (
	handlersRoot: unknown,
	pathTemplate: string,
	method: string,
): ((...args: Array<unknown>) => unknown) => {
	const segments = pathTemplate.split("/").filter(Boolean);
	let current = handlersRoot as Record<string, unknown>;
	for (const segment of segments) {
		const shapeNode = current.SHAPE;
		if (!shapeNode || typeof shapeNode !== "object") {
			throw new Error(`Missing SHAPE node while resolving handler at ${pathTemplate}`);
		}
		const next = (shapeNode as Record<string, unknown>)[segment];
		if (!next || typeof next !== "object") {
			throw new Error(`Missing handler shape segment '${segment}' at ${pathTemplate}`);
		}
		current = next as Record<string, unknown>;
	}
	const handlerNode = current.HANDLER;
	if (!handlerNode || typeof handlerNode !== "object") {
		throw new Error(`Missing HANDLER node at ${pathTemplate}`);
	}
	const handler = (handlerNode as Record<string, unknown>)[method];
	if (typeof handler !== "function") {
		throw new Error(`Missing ${method} handler at ${pathTemplate}`);
	}
	return handler as (...args: Array<unknown>) => unknown;
};

export const createHonoContractHandlers = <TShape extends Shape, TContext = unknown>(
	contracts: Contracts<TShape>,
	handlers: ContractHandlersFromContracts<typeof contracts, TContext>,
): BoundContractHandlers<TShape, TContext> => {
	return {
		contracts,
		handlers,
	};
};

export const initHono = <TShape extends Shape, TContext = unknown>(
	app: Hono,
	options: InitHonoOptions<TShape, TContext>,
): void => {
	app.notFound(() => {
		const notFoundResponse = makeNotFoundResponse();
		return createSerializedResponse({
			status: notFoundResponse.status,
			type: notFoundResponse.type,
			data: notFoundResponse.data,
			source: "error",
		});
	});

	const compiledRoutes = compileContractRoutes(options.contracts.contracts);

	for (const route of compiledRoutes) {
		registerHonoRoute(app, route.method, route.honoPath, async (ctx): Promise<Response> => {
			const ourContext = await options.createContext(ctx);

			const executeHandler = async (): Promise<Response> => {
				const handler = getHandlerAtPath(
					options.contracts.handlers,
					route.pathTemplate,
					route.method,
				);
				const requestParsers = getContractRequestParsers(route.methodDefinition);
				const inputData: Record<string, unknown> = {};

				if (requestParsers.pathParams) {
					const pathParseResult = await requestParsers.pathParams.safeParseAsync(
						ctx.req.param(),
					);
					if (!pathParseResult.success) {
						throw createRequestValidationError(
							"Path params",
							pathParseResult.error.issues,
						);
					}
					inputData.pathParams = pathParseResult.data;
				}

				if (requestParsers.query) {
					let queryInput: unknown;
					try {
						queryInput = parseQueryInput(requestParsers.query, new URL(ctx.req.url));
					} catch (error) {
						throw createRequestValidationError("Query", [
							createParseFailureIssue(error),
						]);
					}
					const queryParseResult =
						await requestParsers.query.query.safeParseAsync(queryInput);
					if (!queryParseResult.success) {
						throw createRequestValidationError("Query", queryParseResult.error.issues);
					}
					inputData.query = queryParseResult.data;
				}

				if (requestParsers.headers) {
					let headersInput: unknown;
					try {
						headersInput = parseHeadersInput(
							requestParsers.headers,
							ctx.req.raw.headers,
						);
					} catch (error) {
						throw createRequestValidationError("Headers", [
							createParseFailureIssue(error),
						]);
					}
					const headersParseResult =
						await requestParsers.headers.headers.safeParseAsync(headersInput);
					if (!headersParseResult.success) {
						throw createRequestValidationError(
							"Headers",
							headersParseResult.error.issues,
						);
					}
					inputData.headers = headersParseResult.data;
				}

				if (requestParsers.body) {
					let bodyInput: unknown;
					try {
						bodyInput = await parseBodyInput(requestParsers.body, ctx.req.raw);
					} catch (error) {
						throw createRequestValidationError("Body", [
							createParseFailureIssue(error),
						]);
					}
					const bodyParseResult =
						await requestParsers.body.body.safeParseAsync(bodyInput);
					if (!bodyParseResult.success) {
						throw createRequestValidationError("Body", bodyParseResult.error.issues);
					}
					inputData.body = bodyParseResult.data;
				}

				const rawResponse = await handler(inputData, ctx, ourContext);
				const normalizedResponse: RuntimeHandlerResponse = {
					status: (rawResponse as { status: number }).status,
					type: (rawResponse as { type: RuntimeHandlerResponse["type"] }).type,
					data: (rawResponse as { data: unknown }).data,
				};

				validateResponse(route.methodDefinition, normalizedResponse);

				return createSerializedResponse({
					status: normalizedResponse.status,
					type: normalizedResponse.type,
					data: normalizedResponse.data,
					headers: normalizedResponse.headers,
					source: "contract",
				});
			};

			try {
				if (options.middlewares) {
					return await runMiddlewareHandlers(
						ctx,
						ourContext,
						options.middlewares,
						executeHandler,
					);
				}
				return await executeHandler();
			} catch (error) {
				const errorResponse = makeErrorResponse(error, options.errorMode);
				return createSerializedResponse({
					status: errorResponse.status,
					type: errorResponse.type,
					data: errorResponse.data,
					source: "error",
				});
			}
		});
	}
};

export { createHonoMiddlewareHandlers } from "../middleware/middleware.js";
