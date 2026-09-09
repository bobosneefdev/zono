import type { Context, Hono } from "hono";
import type {
	AnyApiDefinition,
	ContractMethod,
	ContractMethods,
	ContractTree,
	InferContractResponseUnion,
	RequestData,
} from "../contract/contract.js";
import { compileContractRoutes, getContractRequestParsers } from "../contract/contract.js";
import type {
	InferAllMiddlewareResponseUnion,
	InferMiddlewareResponseUnion,
	MiddlewareLayer,
	MiddlewareSpec,
	MiddlewareTree,
} from "../middleware/middleware.js";
import { collectMiddlewareLayers } from "../middleware/middleware.js";
import type {
	EmptyObject,
	ErrorMode,
	ErrorResponse,
	HTTPMethod,
	MaybePromise,
	RuntimeResponseLike,
} from "../shared/shared.js";
import {
	collectShapePathNodes,
	findExactShapePathNode,
	isRecordObject,
	makeErrorRuntimeResponse,
	makeNotFoundRuntimeResponse,
	mediaTypeSatisfies,
	parseBodyInput,
	parseHeadersInput,
	parseQueryInput,
	RequestValidationError,
	registerHonoRoute,
	toHonoPath,
	toSerializedRuntimeResponse,
	UnsupportedMediaTypeError,
	validateAndSerializeResponse,
} from "../shared/shared.js";

export type ContextFactory<T = unknown> = (ctx: Context) => Promise<T> | T;

export type RuntimeHandlerResponse = RuntimeResponseLike;

export type ContractHandler<TMethod extends ContractMethod, TContext> = (
	data: RequestData<TMethod>,
	ctx: Context,
	appContext: TContext,
) => Promise<InferContractResponseUnion<TMethod>> | InferContractResponseUnion<TMethod>;

// NOTE: The handler tree types below deliberately avoid two things that break
// inferring TContext from `createContext` within the same object literal:
// conditional types in value positions that branch on tree-node types (they
// defer the contextual type of nested handler functions), and homomorphic key
// remapping via `as` (contextual typing cannot reverse non-identity renames).
// Branching on a precomputed key union and using `Extract`-style conditionals
// only inside type arguments preserves that inference.
export type ContractHandlerMap<TContract extends ContractMethods, TContext> = {
	[TMethod in keyof TContract & HTTPMethod]: ContractHandler<
		Extract<TContract[TMethod], ContractMethod>,
		TContext
	>;
};

type ContractHandlerShape<TShapeNode, TContext> = {
	[K in keyof TShapeNode]: ContractHandlerTree<TShapeNode[K], TContext>;
};

type ContractHandlerTreeKey<TContractsNode> =
	| ("CONTRACT" extends keyof TContractsNode ? "HANDLER" : never)
	| ("SHAPE" extends keyof TContractsNode ? "SHAPE" : never);

type ContractAtNode<TContractsNode> = TContractsNode extends {
	CONTRACT: infer TContract extends ContractMethods;
}
	? TContract
	: never;

type ShapeAtNode<TContractsNode> = TContractsNode extends {
	SHAPE: infer TShapeNode extends Record<string, unknown>;
}
	? TShapeNode
	: never;

export type ContractHandlerTree<TContractsNode, TContext> = {
	[K in ContractHandlerTreeKey<TContractsNode>]: K extends "HANDLER"
		? ContractHandlerMap<ContractAtNode<TContractsNode>, TContext>
		: ContractHandlerShape<ShapeAtNode<TContractsNode>, TContext>;
};

export type MiddlewareHandler<TDefinition extends MiddlewareSpec, TContext = unknown> = (
	ctx: Context,
	next: () => Promise<void>,
	appContext: TContext,
) =>
	| Promise<void | Response | InferMiddlewareResponseUnion<TDefinition>>
	| void
	| Response
	| InferMiddlewareResponseUnion<TDefinition>;

type MiddlewareHandlerShape<TShapeNode, TContext> = {
	[K in keyof TShapeNode]: MiddlewareHandlerTree<
		Extract<TShapeNode[K], MiddlewareTree>,
		TContext
	>;
};

type MiddlewareHandlerMap<TMiddlewareMap extends Record<string, MiddlewareSpec>, TContext> = {
	[TName in keyof TMiddlewareMap]: MiddlewareHandler<TMiddlewareMap[TName], TContext>;
};

// Homomorphic mapping keeps the MIDDLEWARE/SHAPE optionality of the source
// tree; see the inference note above ContractHandlerMap.
export type MiddlewareHandlerTree<TMiddlewares extends MiddlewareTree, TContext> = {
	[K in keyof TMiddlewares]: K extends "MIDDLEWARE"
		? MiddlewareHandlerMap<Extract<TMiddlewares[K], Record<string, MiddlewareSpec>>, TContext>
		: K extends "SHAPE"
			? MiddlewareHandlerShape<Extract<TMiddlewares[K], Record<string, unknown>>, TContext>
			: never;
};

type MiddlewareHandlersField<
	TMiddlewares extends MiddlewareTree,
	TContext,
> = EmptyObject extends TMiddlewares
	? { middlewares?: MiddlewareHandlerTree<TMiddlewares, TContext> }
	: { middlewares: MiddlewareHandlerTree<TMiddlewares, TContext> };

export type ApiHandlers<TApi extends AnyApiDefinition, TContext> = {
	createContext: ContextFactory<TContext>;
	contracts: ContractHandlerTree<TApi["contracts"], NoInfer<TContext>>;
} & MiddlewareHandlersField<TApi["middlewares"], NoInfer<TContext>>;

export type ApiBinding<TApi extends AnyApiDefinition, TContext> = {
	api: TApi;
	createContext: ContextFactory<TContext>;
	contracts: ContractHandlerTree<TApi["contracts"], TContext>;
	middlewares: MiddlewareHandlerTree<TApi["middlewares"], TContext> | undefined;
};

/**
 * Creates the unified server binding for an API definition.
 *
 * Curried on purpose: fixing TApi in the first call lets TypeScript infer the
 * application context from `createContext` while still contextually typing
 * every handler's inputs and response literals. A single call would leave TApi
 * inference in flight, which defers the handler trees' contextual types and
 * widens response literals.
 */
export const createApiHandlers = <TApi extends AnyApiDefinition>(api: TApi) => {
	return <TContext>(handlers: ApiHandlers<TApi, TContext>): ApiBinding<TApi, TContext> => {
		return {
			api,
			createContext: handlers.createContext,
			contracts: handlers.contracts,
			middlewares: handlers.middlewares,
		};
	};
};

export type OnError = (error: unknown, ctx: Context) => MaybePromise<void>;

export type HonoOptions = {
	/**
	 * Observational hook invoked with the original failure. Its return value
	 * cannot replace the typed HTTP response, and its own failures are never
	 * exposed to clients.
	 */
	onError?: OnError;
};

export type ClientResponse<
	TMethod extends ContractMethod,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> =
	| InferContractResponseUnion<TMethod>
	| InferAllMiddlewareResponseUnion<TMiddlewares>
	| ErrorResponse<TErrorMode>;

const createRequestValidationError = (
	segment: "Path params" | "Query" | "Headers" | "Body",
	issues: ReadonlyArray<unknown>,
): RequestValidationError => {
	return new RequestValidationError(`${segment} validation failed`, issues);
};

const createParseFailureIssue = (error: unknown): unknown => {
	if (error instanceof Error) {
		return { message: error.message };
	}
	return { message: "Failed to parse request input" };
};

export const invokeOnError = async (
	onError: OnError | undefined,
	error: unknown,
	ctx: Context,
): Promise<void> => {
	if (!onError) {
		return;
	}
	try {
		await onError(error, ctx);
	} catch {
		// Observation failures must never replace the original error response.
	}
};

const getHandlerNodeAtPath = (
	handlersRoot: unknown,
	pathTemplate: string,
): Record<string, unknown> => {
	const current = findExactShapePathNode(
		handlersRoot,
		pathTemplate,
		(path) => `Missing SHAPE node while resolving handler at ${path}`,
		(segment, path) => `Missing handler shape segment '${segment}' at ${path}`,
	);

	if (!isRecordObject(current.HANDLER)) {
		throw new Error(`Missing HANDLER node at ${pathTemplate}`);
	}

	return current.HANDLER;
};

type PreparedContractRoute = {
	pathTemplate: string;
	method: HTTPMethod;
	methodDefinition: ContractMethod;
	handlerNode: Record<string, unknown>;
	requestParsers: ReturnType<typeof getContractRequestParsers>;
};

const getPreparedHandler = (
	route: PreparedContractRoute,
): ((...args: Array<unknown>) => unknown) => {
	const handler = route.handlerNode[route.method];
	if (typeof handler !== "function") {
		throw new Error(`Missing ${route.method} handler at ${route.pathTemplate}`);
	}
	return handler as (...args: Array<unknown>) => unknown;
};

const EMPTY_REQUEST_DATA: Record<string, never> = {};

const assertRequestMediaType = (declaredContentType: string | undefined, ctx: Context): void => {
	if (declaredContentType === undefined) {
		return;
	}
	const incomingContentType = ctx.req.header("content-type");
	if (incomingContentType === undefined) {
		throw new UnsupportedMediaTypeError(
			`Missing content-type header; expected '${declaredContentType}'`,
		);
	}
	if (!mediaTypeSatisfies(declaredContentType, incomingContentType)) {
		throw new UnsupportedMediaTypeError(
			`Content type '${incomingContentType}' does not satisfy declared '${declaredContentType}'`,
		);
	}
};

const parseRequestData = async (
	ctx: Context,
	requestParsers: ReturnType<typeof getContractRequestParsers>,
): Promise<Record<string, unknown>> => {
	if (
		!requestParsers.pathParams &&
		!requestParsers.query &&
		!requestParsers.headers &&
		!requestParsers.body
	) {
		return EMPTY_REQUEST_DATA;
	}

	const inputData: Record<string, unknown> = {};

	if (requestParsers.pathParams) {
		const pathParseResult = await requestParsers.pathParams["~standard"].validate(
			ctx.req.param(),
		);
		if (pathParseResult.issues) {
			throw createRequestValidationError("Path params", pathParseResult.issues);
		}
		inputData.pathParams = pathParseResult.value;
	}

	if (requestParsers.query) {
		let queryInput: unknown;
		try {
			queryInput = parseQueryInput(requestParsers.query, new URL(ctx.req.url));
		} catch (error) {
			throw createRequestValidationError("Query", [createParseFailureIssue(error)]);
		}
		const queryParseResult =
			await requestParsers.query.schema["~standard"].validate(queryInput);
		if (queryParseResult.issues) {
			throw createRequestValidationError("Query", queryParseResult.issues);
		}
		inputData.query = queryParseResult.value;
	}

	if (requestParsers.headers) {
		let headersInput: unknown;
		try {
			headersInput = parseHeadersInput(requestParsers.headers, ctx.req.raw.headers);
		} catch (error) {
			throw createRequestValidationError("Headers", [createParseFailureIssue(error)]);
		}
		const headersParseResult =
			await requestParsers.headers.schema["~standard"].validate(headersInput);
		if (headersParseResult.issues) {
			throw createRequestValidationError("Headers", headersParseResult.issues);
		}
		inputData.headers = headersParseResult.value;
	}

	if (requestParsers.body) {
		assertRequestMediaType(requestParsers.body.contentType, ctx);
		let bodyInput: unknown;
		try {
			bodyInput = await parseBodyInput(requestParsers.body, ctx.req.raw);
		} catch (error) {
			throw createRequestValidationError("Body", [createParseFailureIssue(error)]);
		}
		const bodyParseResult = await requestParsers.body.schema["~standard"].validate(bodyInput);
		if (bodyParseResult.issues) {
			throw createRequestValidationError("Body", bodyParseResult.issues);
		}
		inputData.body = bodyParseResult.value;
	}

	return inputData;
};

const ZONO_CONTEXT_KEY = "__zono_context";

const setContextValue = (ctx: Context, key: string, value: unknown): void => {
	(ctx as unknown as { set: (name: string, data: unknown) => void }).set(key, value);
};

const getContextValue = (ctx: Context, key: string): unknown => {
	return (ctx as unknown as { get: (name: string) => unknown }).get(key);
};

const getStoredContext = <TContext>(ctx: Context): Awaited<TContext> => {
	return getContextValue(ctx, ZONO_CONTEXT_KEY) as Awaited<TContext>;
};

const normalizeMiddlewareResponse = (response: InferMiddlewareResponseUnion<MiddlewareSpec>) => {
	return {
		status: response.status,
		type: response.type,
		data: response.data,
		headers: response.headers,
	} satisfies RuntimeHandlerResponse;
};

const isMiddlewareResponse = (
	value: unknown,
): value is InferMiddlewareResponseUnion<MiddlewareSpec> => {
	return (
		isRecordObject(value) &&
		typeof value.status === "number" &&
		typeof value.type === "string" &&
		"data" in value
	);
};

const registerMiddlewareLayer = <TContext>(
	app: Hono,
	pathTemplate: string,
	layer: MiddlewareLayer<TContext>,
): void => {
	app.use(toHonoPath(pathTemplate), async (ctx, next) => {
		const returned = await layer.handler(ctx, next, getStoredContext<TContext>(ctx));
		if (returned instanceof Response) {
			return returned;
		}
		if (isMiddlewareResponse(returned)) {
			return validateAndSerializeResponse(
				layer.definition,
				normalizeMiddlewareResponse(returned),
				"Middleware",
				"middleware",
			);
		}
		return returned as Response | undefined;
	});
};

const getUniquePathTemplates = (routes: Array<{ pathTemplate: string }>): Array<string> => {
	return Array.from(new Set(routes.map((route) => route.pathTemplate)));
};

const hasAnyMiddleware = (middlewares: MiddlewareTree): boolean => {
	if (middlewares.MIDDLEWARE && Object.keys(middlewares.MIDDLEWARE).length > 0) {
		return true;
	}
	if (!middlewares.SHAPE) {
		return false;
	}
	return Object.values(middlewares.SHAPE).some(hasAnyMiddleware);
};

export const initHono = <TApi extends AnyApiDefinition, TContext>(
	app: Hono,
	binding: ApiBinding<TApi, TContext>,
	options?: HonoOptions,
): void => {
	const errorMode: ErrorMode = binding.api.errorMode;

	app.use("*", async (ctx, next) => {
		setContextValue(ctx, ZONO_CONTEXT_KEY, await binding.createContext(ctx));
		await next();
	});

	app.onError(async (error, ctx) => {
		await invokeOnError(options?.onError, error, ctx);
		return toSerializedRuntimeResponse(makeErrorRuntimeResponse(error, errorMode), "error");
	});

	app.notFound(() => {
		return toSerializedRuntimeResponse(makeNotFoundRuntimeResponse(), "error");
	});

	const contracts: ContractTree = binding.api.contracts;
	const preparedRoutes: Array<PreparedContractRoute> = compileContractRoutes(contracts).map(
		(route) => {
			return {
				pathTemplate: route.pathTemplate,
				method: route.method,
				methodDefinition: route.methodDefinition,
				handlerNode: getHandlerNodeAtPath(binding.contracts, route.pathTemplate),
				requestParsers: getContractRequestParsers(route.methodDefinition),
			};
		},
	);

	const middlewares: MiddlewareTree = binding.api.middlewares;
	if (hasAnyMiddleware(middlewares)) {
		for (const pathTemplate of getUniquePathTemplates(preparedRoutes)) {
			const layers = collectMiddlewareLayers<TContext>(
				collectShapePathNodes(middlewares, pathTemplate),
				collectShapePathNodes(binding.middlewares, pathTemplate),
			);
			for (const layer of layers) {
				registerMiddlewareLayer(app, pathTemplate, layer);
			}
		}
	}

	for (const route of preparedRoutes) {
		registerHonoRoute(app, route.method, route.pathTemplate, async (ctx): Promise<Response> => {
			const handler = getPreparedHandler(route);
			const inputData = await parseRequestData(ctx, route.requestParsers);
			const rawResponse = await handler(inputData, ctx, getStoredContext<TContext>(ctx));
			const normalizedResponse: RuntimeHandlerResponse = {
				status: (rawResponse as { status: number }).status,
				type: (rawResponse as { type: RuntimeHandlerResponse["type"] }).type,
				data: (rawResponse as { data: unknown }).data,
				headers: (rawResponse as { headers?: unknown }).headers,
			};
			return validateAndSerializeResponse(
				route.methodDefinition.responses,
				normalizedResponse,
				"Handler",
				"contract",
			);
		});
	}
};
