import type { Context, Hono } from "hono";
import {
	type ContractMethod,
	type ContractMethods,
	type ContractTree,
	type ContractTreeFor,
	compileContractRoutes,
	getContractRequestParsers,
	type HTTPMethod,
	type InferContractResponseUnion,
	type RequestData,
} from "../contract/contract.js";
import type {
	InferAllMiddlewareResponseUnion,
	InferMiddlewareResponseUnion,
	MiddlewareSpec,
	MiddlewareTree,
	MiddlewareTreeFor,
} from "../middleware/middleware.js";
import { resolveMiddlewareBindings, runMiddlewareHandlers } from "../middleware/middleware.js";
import {
	type ApiShape,
	collectShapePathNodes,
	type EmptyObject,
	findExactShapePathNode,
	isRecordObject,
	parseBodyInput,
	parseHeadersInput,
	parseQueryInput,
	type RuntimeResponseLike,
	registerHonoRoute,
	toSerializedRuntimeResponse,
	validateAndSerializeResponse,
} from "../shared/shared.internal.js";

export type ContextFactory<T = unknown> = (ctx: Context) => Promise<T> | T;

export type ErrorMode = "public" | "private";

export type Public500ErrorData = {
	message: string;
};

export type Private500ErrorData = {
	message: string;
	issues?: unknown;
	stack?: string;
};

export type Public400ErrorData = {
	message: string;
	issues: Array<unknown>;
};

export type Private400ErrorData = {
	message: string;
	issueCount: number;
};

export type NotFoundErrorData = {
	message: string;
};

export type PublicErrorData = Public400ErrorData | NotFoundErrorData | Public500ErrorData;

export type PrivateErrorData = Private400ErrorData | NotFoundErrorData | Private500ErrorData;

export type ErrorResponse<TErrorMode extends ErrorMode> =
	| {
			status: 400;
			type: "JSON";
			data: TErrorMode extends "public" ? Public400ErrorData : Private400ErrorData;
	  }
	| {
			status: 404;
			type: "JSON";
			data: NotFoundErrorData;
	  }
	| {
			status: 500;
			type: "JSON";
			data: TErrorMode extends "public" ? Public500ErrorData : Private500ErrorData;
	  };

export type RuntimeHandlerResponse = RuntimeResponseLike;

export type ContractHandler<TMethod extends ContractMethod, TContext> = (
	data: RequestData<TMethod>,
	ctx: Context,
	ourContext: TContext,
) => Promise<InferContractResponseUnion<TMethod>> | InferContractResponseUnion<TMethod>;

export type ContractHandlerMap<TContract extends ContractMethods, TContext> = {
	[TMethod in keyof TContract & HTTPMethod]: NonNullable<
		TContract[TMethod]
	> extends ContractMethod
		? ContractHandler<NonNullable<TContract[TMethod]>, TContext>
		: never;
};

type ContractHandlerShape<TShapeNode, TContext> =
	TShapeNode extends Record<string, unknown>
		? {
				[K in keyof TShapeNode]: ContractHandlerTree<TShapeNode[K], TContext>;
			}
		: never;

export type ContractHandlerTree<TContractsNode, TContext> = TContractsNode extends {
	CONTRACT: infer TContract;
	SHAPE: infer TShapeNode;
}
	? {
			HANDLER: TContract extends ContractMethods
				? ContractHandlerMap<TContract, TContext>
				: never;
			SHAPE: ContractHandlerShape<TShapeNode, TContext>;
		}
	: TContractsNode extends { CONTRACT: infer TContract }
		? {
				HANDLER: TContract extends ContractMethods
					? ContractHandlerMap<TContract, TContext>
					: never;
			}
		: TContractsNode extends { SHAPE: infer TShapeNode }
			? {
					SHAPE: ContractHandlerShape<TShapeNode, TContext>;
				}
			: never;

export type MiddlewareHandler<TDefinition extends MiddlewareSpec, TContext = unknown> = (
	ctx: Context,
	next: () => Promise<void>,
	ourContext: TContext,
) =>
	| Promise<void | InferMiddlewareResponseUnion<TDefinition>>
	| void
	| InferMiddlewareResponseUnion<TDefinition>;

type HasKey<T, TKey extends PropertyKey> = TKey extends keyof T ? true : false;

type IsRequiredKey<T, TKey extends keyof T> = EmptyObject extends Pick<T, TKey> ? false : true;

type MiddlewareMapAtNode<TNode> = TNode extends { MIDDLEWARE?: infer TMiddlewareMap }
	? TMiddlewareMap extends Record<string, MiddlewareSpec>
		? TMiddlewareMap
		: EmptyObject
	: EmptyObject;

type MiddlewareShapeAtNode<TNode> = TNode extends { SHAPE?: infer TShapeNode }
	? TShapeNode extends Record<string, unknown>
		? TShapeNode
		: EmptyObject
	: EmptyObject;

type MiddlewareHandlerShape<TShapeNode, TContext> =
	TShapeNode extends Record<string, unknown>
		? {
				[K in keyof TShapeNode]: MiddlewareHandlerTree<
					NonNullable<TShapeNode[K]>,
					TContext
				>;
			}
		: never;

type MiddlewareHandlerMap<TMiddlewareMap extends Record<string, MiddlewareSpec>, TContext> = {
	[TName in keyof TMiddlewareMap]: MiddlewareHandler<TMiddlewareMap[TName], TContext>;
};

type MiddlewareHandlerTreeFromNode<TMiddlewaresNode, TContext> = (HasKey<
	TMiddlewaresNode,
	"MIDDLEWARE"
> extends true
	? "MIDDLEWARE" extends keyof TMiddlewaresNode
		? IsRequiredKey<TMiddlewaresNode, "MIDDLEWARE"> extends true
			? {
					MIDDLEWARE: MiddlewareHandlerMap<
						MiddlewareMapAtNode<TMiddlewaresNode>,
						TContext
					>;
				}
			: {
					MIDDLEWARE?: MiddlewareHandlerMap<
						MiddlewareMapAtNode<TMiddlewaresNode>,
						TContext
					>;
				}
		: never
	: EmptyObject) &
	(HasKey<TMiddlewaresNode, "SHAPE"> extends true
		? "SHAPE" extends keyof TMiddlewaresNode
			? IsRequiredKey<TMiddlewaresNode, "SHAPE"> extends true
				? {
						SHAPE: MiddlewareHandlerShape<
							MiddlewareShapeAtNode<TMiddlewaresNode>,
							TContext
						>;
					}
				: {
						SHAPE?: MiddlewareHandlerShape<
							MiddlewareShapeAtNode<TMiddlewaresNode>,
							TContext
						>;
					}
			: never
		: EmptyObject);

export type MiddlewareHandlerTree<
	TMiddlewares extends MiddlewareTree,
	TContext,
> = MiddlewareHandlerTreeFromNode<TMiddlewares, TContext>;

export type ContractBindings<TContracts extends ContractTree, TContext> = {
	contracts: TContracts;
	handlers: ContractHandlerTree<TContracts, TContext>;
};

export type MiddlewareBindings<TMiddlewares extends MiddlewareTree, TContext> = {
	middlewares: TMiddlewares;
	handlers: MiddlewareHandlerTree<TMiddlewares, TContext>;
};

export type ServerOptions<
	TShape extends ApiShape,
	TContext = unknown,
	TMiddlewares extends MiddlewareTreeFor<TShape> = MiddlewareTreeFor<TShape>,
> = {
	contracts: ContractBindings<ContractTreeFor<TShape>, TContext>;
	middlewares?: MiddlewareBindings<TMiddlewares, TContext>;
	errorMode: ErrorMode;
	createContext: ContextFactory<TContext>;
};

export type ClientResponse<
	TMethod extends ContractMethod,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> =
	| InferContractResponseUnion<TMethod>
	| InferAllMiddlewareResponseUnion<TMiddlewares>
	| ErrorResponse<TErrorMode>;

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

type PreparedContractRoute<TContext> = {
	pathTemplate: string;
	method: HTTPMethod;
	methodDefinition: ContractMethod;
	handlerNode: Record<string, unknown>;
	requestParsers: ReturnType<typeof getContractRequestParsers>;
	middlewares?: MiddlewareBindings<{ MIDDLEWARE: Record<string, MiddlewareSpec> }, TContext>;
};

const getPreparedHandler = <TContext>(
	route: PreparedContractRoute<TContext>,
): ((...args: Array<unknown>) => unknown) => {
	const handler = route.handlerNode[route.method];
	if (typeof handler !== "function") {
		throw new Error(`Missing ${route.method} handler at ${route.pathTemplate}`);
	}
	return handler as (...args: Array<unknown>) => unknown;
};

export const createHonoContractHandlers = <
	const TContracts extends ContractTree,
	TContext = unknown,
>(
	contracts: TContracts,
	handlers: ContractHandlerTree<TContracts, TContext>,
): ContractBindings<TContracts, TContext> => {
	return {
		contracts,
		handlers,
	};
};

const EMPTY_REQUEST_DATA: Record<string, never> = {};

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
		const pathParseResult = await requestParsers.pathParams.safeParseAsync(ctx.req.param());
		if (!pathParseResult.success) {
			throw createRequestValidationError("Path params", pathParseResult.error.issues);
		}
		inputData.pathParams = pathParseResult.data;
	}

	if (requestParsers.query) {
		let queryInput: unknown;
		try {
			queryInput = parseQueryInput(requestParsers.query, new URL(ctx.req.url));
		} catch (error) {
			throw createRequestValidationError("Query", [createParseFailureIssue(error)]);
		}
		const queryParseResult = await requestParsers.query.schema.safeParseAsync(queryInput);
		if (!queryParseResult.success) {
			throw createRequestValidationError("Query", queryParseResult.error.issues);
		}
		inputData.query = queryParseResult.data;
	}

	if (requestParsers.headers) {
		let headersInput: unknown;
		try {
			headersInput = parseHeadersInput(requestParsers.headers, ctx.req.raw.headers);
		} catch (error) {
			throw createRequestValidationError("Headers", [createParseFailureIssue(error)]);
		}
		const headersParseResult = await requestParsers.headers.schema.safeParseAsync(headersInput);
		if (!headersParseResult.success) {
			throw createRequestValidationError("Headers", headersParseResult.error.issues);
		}
		inputData.headers = headersParseResult.data;
	}

	if (requestParsers.body) {
		let bodyInput: unknown;
		try {
			bodyInput = await parseBodyInput(requestParsers.body, ctx.req.raw);
		} catch (error) {
			throw createRequestValidationError("Body", [createParseFailureIssue(error)]);
		}
		const bodyParseResult = await requestParsers.body.schema.safeParseAsync(bodyInput);
		if (!bodyParseResult.success) {
			throw createRequestValidationError("Body", bodyParseResult.error.issues);
		}
		inputData.body = bodyParseResult.data;
	}

	return inputData;
};

export const initHono = <
	TShape extends ApiShape,
	TContext = unknown,
	TMiddlewares extends MiddlewareTreeFor<TShape> = MiddlewareTreeFor<TShape>,
>(
	app: Hono,
	options: ServerOptions<TShape, TContext, TMiddlewares>,
): void => {
	app.notFound(() => {
		return toSerializedRuntimeResponse(makeNotFoundResponse(), "error");
	});

	const preparedRoutes: Array<PreparedContractRoute<TContext>> = compileContractRoutes(
		options.contracts.contracts,
	).map((route) => {
		const middlewares = options.middlewares
			? resolveMiddlewareBindings<TContext>(
					collectShapePathNodes(options.middlewares.middlewares, route.pathTemplate),
					collectShapePathNodes(options.middlewares.handlers, route.pathTemplate),
				)
			: undefined;

		return {
			pathTemplate: route.pathTemplate,
			method: route.method,
			methodDefinition: route.methodDefinition,
			handlerNode: getHandlerNodeAtPath(options.contracts.handlers, route.pathTemplate),
			requestParsers: getContractRequestParsers(route.methodDefinition),
			middlewares,
		};
	});

	for (const route of preparedRoutes) {
		registerHonoRoute(app, route.method, route.pathTemplate, async (ctx): Promise<Response> => {
			const ourContext = await options.createContext(ctx);

			const executeHandler = async (): Promise<Response> => {
				const handler = getPreparedHandler(route);
				const inputData = await parseRequestData(ctx, route.requestParsers);
				const rawResponse = await handler(inputData, ctx, ourContext);
				const normalizedResponse: RuntimeHandlerResponse = {
					status: (rawResponse as { status: number }).status,
					type: (rawResponse as { type: RuntimeHandlerResponse["type"] }).type,
					data: (rawResponse as { data: unknown }).data,
				};
				return validateAndSerializeResponse(
					route.methodDefinition.responses,
					normalizedResponse,
					"Handler",
					"contract",
				);
			};

			try {
				if (route.middlewares) {
					return await runMiddlewareHandlers(
						ctx,
						ourContext,
						route.middlewares,
						executeHandler,
					);
				}
				return await executeHandler();
			} catch (error) {
				return toSerializedRuntimeResponse(
					makeErrorResponse(error, options.errorMode),
					"error",
				);
			}
		});
	}
};

export { createHonoMiddlewareHandlers } from "../middleware/middleware.js";
