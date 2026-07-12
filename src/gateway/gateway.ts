import type { Context, Hono } from "hono";
import { type ClientOptions, createClient } from "../client/client.js";
import type {
	AnyApiDefinition,
	ContractCallRoutes,
	ContractMethods,
	ContractTree,
} from "../contract/contract.js";
import { compileContractRoutes } from "../contract/contract.js";
import type {
	InferMiddlewareResponseUnion,
	InferMiddlewareResponseUnionAtPath,
	MiddlewareLayer,
	MiddlewareMapAtNode,
	MiddlewareSpec,
	MiddlewareTree,
} from "../middleware/middleware.js";
import { collectMiddlewareLayers } from "../middleware/middleware.js";
import type { ContextFactory, MiddlewareHandlerTree, OnError } from "../server/server.js";
import { invokeOnError } from "../server/server.js";
import type {
	EmptyObject,
	ErrorMode,
	ErrorResponse,
	HTTPMethod,
	MapFetchRouteResponse,
	TypedFetch,
	TypedFetchConfig,
	TypedParseResponse,
} from "../shared/shared.js";
import {
	collectShapePathNodes,
	isRecordObject,
	METHODS_WITHOUT_FETCH_BODY,
	makeErrorRuntimeResponse,
	registerHonoRoute,
	toHonoPath,
	toSerializedRuntimeResponse,
	validateAndSerializeResponse,
} from "../shared/shared.js";

export type GatewayServiceMask<TContracts extends ContractTree> = {} & (TContracts extends {
	CONTRACT: ContractMethods;
}
	? { CONTRACT?: true }
	: EmptyObject) &
	(TContracts extends { SHAPE: infer TShape extends Record<string, ContractTree> }
		? {
				SHAPE?:
					| true
					| {
							[TKey in keyof TShape]?: GatewayServiceMask<TShape[TKey]>;
					  };
			}
		: EmptyObject);

type ApplyGatewayServiceMaskToContractTree<
	TContracts extends ContractTree,
	TMask,
> = {} & (TMask extends { CONTRACT: true }
	? TContracts extends { CONTRACT: infer TContract extends NonNullable<ContractTree["CONTRACT"]> }
		? { CONTRACT: TContract }
		: EmptyObject
	: EmptyObject) &
	(TMask extends { SHAPE: true }
		? TContracts extends { SHAPE: infer TContractShape extends Record<string, ContractTree> }
			? { SHAPE: TContractShape }
			: EmptyObject
		: TMask extends { SHAPE: infer TMaskShape extends Record<string, unknown> }
			? TContracts extends {
					SHAPE: infer TContractShape extends Record<string, ContractTree>;
				}
				? {
						SHAPE: {
							[TKey in keyof TMaskShape &
								keyof TContractShape]: ApplyGatewayServiceMaskToContractTree<
								TContractShape[TKey],
								TMaskShape[TKey]
							>;
						};
					}
				: EmptyObject
			: EmptyObject);

export type GatewayService<
	TApi extends AnyApiDefinition,
	TMask extends GatewayServiceMask<TApi["contracts"]>,
> = {
	api: TApi;
	mask: TMask;
	baseUrl: string;
};

type AnyGatewayService = {
	api: AnyApiDefinition;
	mask: unknown;
	baseUrl: string;
};

type MaskedGatewayServiceContracts<TService extends AnyGatewayService> =
	ApplyGatewayServiceMaskToContractTree<TService["api"]["contracts"], TService["mask"]>;

type GatewayMiddlewareTreeFromContracts<TContracts extends ContractTree> = {
	MIDDLEWARE?: Record<string, MiddlewareSpec>;
} & (TContracts extends { SHAPE: infer TShape extends Record<string, ContractTree> }
	? {
			SHAPE?: {
				[TKey in keyof TShape]?: GatewayMiddlewareTreeFromContracts<TShape[TKey]>;
			};
		}
	: EmptyObject);

export type GatewayServices = Record<string, AnyGatewayService>;

export type GatewayMiddlewares<TServices extends GatewayServices> = {
	MIDDLEWARE?: Record<string, MiddlewareSpec>;
	SHAPE?: Record<string, MiddlewareTree> & {
		[TService in keyof TServices]?: GatewayMiddlewareTreeFromContracts<
			MaskedGatewayServiceContracts<TServices[TService]>
		>;
	};
};

type GatewayServiceMiddlewareTree<
	TGatewayMiddlewares,
	TService extends PropertyKey,
> = TGatewayMiddlewares extends { SHAPE: infer TShape extends Record<PropertyKey, MiddlewareTree> }
	? TService extends keyof TShape
		? TShape[TService]
		: never
	: never;

type InferGatewayMiddlewareResponseUnionAtPath<
	TGatewayMiddlewares,
	TService extends PropertyKey,
	TPath extends string,
> = InferMiddlewareResponseUnionAtPath<
	GatewayServiceMiddlewareTree<TGatewayMiddlewares, TService>,
	TPath,
	MiddlewareMapAtNode<TGatewayMiddlewares>[keyof MiddlewareMapAtNode<TGatewayMiddlewares>]
>;

type GatewayClientRoutes<
	TService extends AnyGatewayService,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = ContractCallRoutes<MaskedGatewayServiceContracts<TService>> extends infer TRoute
	? TRoute extends {
			path: infer TPath extends string;
			method: infer _TMethod extends HTTPMethod;
			request: infer _TRequest;
			response: infer _TResponse;
		}
		? MapFetchRouteResponse<
				TRoute,
				| InferMiddlewareResponseUnionAtPath<TService["api"]["middlewares"], TPath>
				| InferGatewayMiddlewareResponseUnionAtPath<TGatewayMiddlewares, TServiceKey, TPath>
				| ErrorResponse<TService["api"]["errorMode"]>
			>
		: never
	: never;

export type GatewayClientFetchMethod<
	TService extends AnyGatewayService,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = TypedFetch<GatewayClientRoutes<TService, TGatewayMiddlewares, TServiceKey>>;

export type GatewayClientFetchConfigMethod<
	TService extends AnyGatewayService,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = TypedFetchConfig<GatewayClientRoutes<TService, TGatewayMiddlewares, TServiceKey>>;

export type GatewayClientParseResponseMethod<
	TService extends AnyGatewayService,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = TypedParseResponse<GatewayClientRoutes<TService, TGatewayMiddlewares, TServiceKey>>;

export type GatewayClient<TServices extends GatewayServices, TGatewayMiddlewares = undefined> = {
	[TService in keyof TServices]: {
		fetch: GatewayClientFetchMethod<TServices[TService], TGatewayMiddlewares, TService>;
		fetchConfig: GatewayClientFetchConfigMethod<
			TServices[TService],
			TGatewayMiddlewares,
			TService
		>;
		parseResponse: GatewayClientParseResponseMethod<
			TServices[TService],
			TGatewayMiddlewares,
			TService
		>;
	};
};

export type GatewayBinding<TGatewayMiddlewares extends MiddlewareTree, TContext> = {
	middlewares: TGatewayMiddlewares;
	createContext: ContextFactory<TContext> | undefined;
	handlers: MiddlewareHandlerTree<TGatewayMiddlewares, TContext>;
};

export type GatewayOptions<
	TServices extends GatewayServices,
	TGatewayMiddlewares extends GatewayMiddlewares<TServices> & MiddlewareTree,
	TContext,
> = {
	handlers?: GatewayBinding<TGatewayMiddlewares, TContext>;
	/**
	 * Observational hook invoked with the original failure. Its return value
	 * cannot replace the typed HTTP response.
	 */
	onError?: OnError;
};

export const createGatewayService = <
	TApi extends AnyApiDefinition,
	const TMask extends GatewayServiceMask<TApi["contracts"]>,
>(config: {
	api: TApi;
	mask: TMask;
	baseUrl: string;
}): GatewayService<TApi, TMask> => {
	return {
		api: config.api,
		mask: config.mask,
		baseUrl: config.baseUrl,
	};
};

export const createGatewayServices = <TServices extends GatewayServices>(
	services: TServices,
): TServices => {
	for (const serviceName of Object.keys(services)) {
		assertValidGatewayServiceKey(serviceName);
	}
	return services;
};

/**
 * Creates the gateway middleware binding. Curried for the same inference
 * reasons as `createApiHandlers`: the middleware tree must be fixed before the
 * handlers are contextually typed.
 */
export const createGatewayHandlers = <const TGatewayMiddlewares extends MiddlewareTree>(
	gatewayApi: TGatewayMiddlewares,
) => {
	return <TContext = unknown>(handlers: {
		createContext?: ContextFactory<TContext>;
		middlewares: MiddlewareHandlerTree<TGatewayMiddlewares, NoInfer<TContext>>;
	}): GatewayBinding<TGatewayMiddlewares, TContext> => {
		return {
			middlewares: gatewayApi,
			createContext: handlers.createContext,
			handlers: handlers.middlewares,
		};
	};
};

const applyGatewayServiceMask = (mask: unknown, contracts: unknown): ContractTree => {
	if (!isRecordObject(mask) || !isRecordObject(contracts)) {
		return {};
	}

	const maskedContracts: ContractTree = {};

	if (mask.CONTRACT === true && isRecordObject(contracts.CONTRACT)) {
		maskedContracts.CONTRACT = contracts.CONTRACT;
	}
	if (mask.SHAPE === true && isRecordObject(contracts.SHAPE)) {
		const maskedShape: Record<string, ContractTree> = {};
		for (const [segment, childContracts] of Object.entries(contracts.SHAPE)) {
			if (isRecordObject(childContracts)) {
				maskedShape[segment] = applyGatewayServiceMask(
					{ CONTRACT: true, SHAPE: true },
					childContracts,
				);
			}
		}
		maskedContracts.SHAPE = maskedShape;
		return maskedContracts;
	}

	if (!isRecordObject(mask.SHAPE) || !isRecordObject(contracts.SHAPE)) {
		return maskedContracts;
	}

	const maskedShape: Record<string, ContractTree> = {};
	for (const [segment, childMask] of Object.entries(mask.SHAPE)) {
		const childContracts = contracts.SHAPE[segment];
		if (!isRecordObject(childMask) || !isRecordObject(childContracts)) {
			continue;
		}

		const maskedChildContracts = applyGatewayServiceMask(childMask, childContracts);
		if (
			maskedChildContracts.CONTRACT !== undefined ||
			maskedChildContracts.SHAPE !== undefined
		) {
			maskedShape[segment] = maskedChildContracts;
		}
	}

	if (Object.keys(maskedShape).length > 0) {
		maskedContracts.SHAPE = maskedShape;
	}

	return maskedContracts;
};

type PreparedGatewayRoute = {
	pathTemplate: string;
	gatewayPathTemplate: string;
	method: HTTPMethod;
	serializedMethod: string;
	shouldSendBody: boolean;
	baseUrl: string;
	errorMode: ErrorMode;
	servicePathPrefix: string;
};

const collectGatewayRouteMiddlewareNodes = (
	gatewayMiddlewares: MiddlewareTree,
	gatewayHandlers: unknown,
	serviceName: string,
	pathTemplate: string,
): {
	middlewareNodes: Array<unknown>;
	handlerNodes: Array<unknown>;
} => {
	const middlewareNodes: Array<unknown> = [gatewayMiddlewares];
	const handlerNodes: Array<unknown> = [gatewayHandlers];

	const serviceMiddlewareRoot = gatewayMiddlewares.SHAPE?.[serviceName];
	if (!serviceMiddlewareRoot) {
		return { middlewareNodes, handlerNodes };
	}

	const serviceHandlerRoot =
		isRecordObject(gatewayHandlers) && isRecordObject(gatewayHandlers.SHAPE)
			? gatewayHandlers.SHAPE[serviceName]
			: undefined;

	return {
		middlewareNodes: [
			...middlewareNodes,
			...collectShapePathNodes(serviceMiddlewareRoot, pathTemplate),
		],
		handlerNodes: [...handlerNodes, ...collectShapePathNodes(serviceHandlerRoot, pathTemplate)],
	};
};

const ZONO_GATEWAY_CONTEXT_KEY = "__zono_gateway_context";
const ZONO_GATEWAY_ERROR_MODE_KEY = "__zono_gateway_error_mode";

const setContextValue = (ctx: Context, key: string, value: unknown): void => {
	(ctx as unknown as { set: (name: string, data: unknown) => void }).set(key, value);
};

const getContextValue = (ctx: Context, key: string): unknown => {
	return (ctx as unknown as { get: (name: string) => unknown }).get(key);
};

const getGatewayContext = <TContext>(ctx: Context): Awaited<TContext> => {
	return getContextValue(ctx, ZONO_GATEWAY_CONTEXT_KEY) as Awaited<TContext>;
};

const getGatewayErrorMode = (ctx: Context): ErrorMode => {
	return (getContextValue(ctx, ZONO_GATEWAY_ERROR_MODE_KEY) as ErrorMode | undefined) ?? "opaque";
};

const getUniquePathTemplates = (routes: Array<{ pathTemplate: string }>): Array<string> => {
	return Array.from(new Set(routes.map((route) => route.pathTemplate)));
};

const assertValidGatewayServiceKey = (serviceName: string): void => {
	if (serviceName.length === 0) {
		throw new Error("Gateway service key cannot be empty");
	}
	if (serviceName.includes("/")) {
		throw new Error(`Gateway service key '${serviceName}' cannot contain '/'`);
	}
	if (serviceName.startsWith("$")) {
		throw new Error(`Gateway service key '${serviceName}' cannot start with '$'`);
	}
};

const getGatewayServicePathPrefix = (serviceName: string): string => {
	assertValidGatewayServiceKey(serviceName);
	return `/${serviceName}`;
};

const namespaceGatewayPath = (serviceName: string, pathTemplate: string): string => {
	const servicePathPrefix = getGatewayServicePathPrefix(serviceName);
	if (pathTemplate === "/") {
		return servicePathPrefix;
	}
	return `${servicePathPrefix}${pathTemplate}`;
};

const stripGatewayServicePathPrefix = (servicePathPrefix: string, pathname: string): string => {
	if (pathname === servicePathPrefix) {
		return "/";
	}
	if (pathname.startsWith(`${servicePathPrefix}/`)) {
		return pathname.slice(servicePathPrefix.length);
	}
	throw new Error(`Gateway request path '${pathname}' does not match '${servicePathPrefix}'`);
};

const normalizeMiddlewareResponse = (response: InferMiddlewareResponseUnion<MiddlewareSpec>) => {
	return {
		status: response.status,
		type: response.type,
		data: response.data,
		headers: response.headers,
	};
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

const registerGatewayMiddlewareLayer = <TContext>(
	app: Hono,
	pathTemplate: string,
	layer: MiddlewareLayer<TContext>,
): void => {
	app.use(toHonoPath(pathTemplate), async (ctx, next) => {
		const returned = await layer.handler(ctx, next, getGatewayContext<TContext>(ctx));
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

export const initGateway = <
	TServices extends GatewayServices,
	TGatewayMiddlewares extends GatewayMiddlewares<TServices> &
		MiddlewareTree = GatewayMiddlewares<TServices> & MiddlewareTree,
	TContext = unknown,
>(
	app: Hono,
	services: TServices,
	options?: GatewayOptions<TServices, TGatewayMiddlewares, TContext>,
): void => {
	const createContext = options?.handlers?.createContext;
	if (createContext) {
		app.use("*", async (ctx, next) => {
			setContextValue(ctx, ZONO_GATEWAY_CONTEXT_KEY, await createContext(ctx));
			await next();
		});
	}

	app.onError(async (error, ctx) => {
		await invokeOnError(options?.onError, error, ctx);
		return toSerializedRuntimeResponse(
			makeErrorRuntimeResponse(error, getGatewayErrorMode(ctx)),
			"error",
		);
	});

	for (const [serviceName, service] of Object.entries(services)) {
		const servicePathPrefix = getGatewayServicePathPrefix(serviceName);
		const maskedContracts = applyGatewayServiceMask(service.mask, service.api.contracts);
		const preparedRoutes: Array<PreparedGatewayRoute> = compileContractRoutes(
			maskedContracts,
		).map((route) => {
			return {
				pathTemplate: route.pathTemplate,
				gatewayPathTemplate: namespaceGatewayPath(serviceName, route.pathTemplate),
				method: route.method,
				serializedMethod: route.method.toUpperCase(),
				shouldSendBody: !METHODS_WITHOUT_FETCH_BODY.has(route.method),
				baseUrl: service.baseUrl,
				errorMode: service.api.errorMode,
				servicePathPrefix,
			};
		});

		if (options?.handlers) {
			const gatewayBinding = options.handlers;
			for (const pathTemplate of getUniquePathTemplates(preparedRoutes)) {
				const gatewayPathTemplate = namespaceGatewayPath(serviceName, pathTemplate);
				const { middlewareNodes, handlerNodes } = collectGatewayRouteMiddlewareNodes(
					gatewayBinding.middlewares,
					gatewayBinding.handlers,
					serviceName,
					pathTemplate,
				);
				const layers = collectMiddlewareLayers<TContext>(middlewareNodes, handlerNodes);
				app.use(toHonoPath(gatewayPathTemplate), async (ctx, next) => {
					setContextValue(ctx, ZONO_GATEWAY_ERROR_MODE_KEY, service.api.errorMode);
					await next();
				});
				for (const layer of layers) {
					registerGatewayMiddlewareLayer(app, gatewayPathTemplate, layer);
				}
			}
		} else {
			for (const pathTemplate of getUniquePathTemplates(
				preparedRoutes.map((route) => ({ pathTemplate: route.gatewayPathTemplate })),
			)) {
				app.use(toHonoPath(pathTemplate), async (ctx, next) => {
					setContextValue(ctx, ZONO_GATEWAY_ERROR_MODE_KEY, service.api.errorMode);
					await next();
				});
			}
		}

		for (const route of preparedRoutes) {
			registerHonoRoute(
				app,
				route.method,
				route.gatewayPathTemplate,
				async (ctx): Promise<Response> => {
					void getGatewayContext<TContext>(ctx);
					const incomingUrl = new URL(ctx.req.url);
					const upstreamPathname = stripGatewayServicePathPrefix(
						route.servicePathPrefix,
						incomingUrl.pathname,
					);
					const upstreamUrl = new URL(
						upstreamPathname + incomingUrl.search,
						route.baseUrl,
					);
					const body = route.shouldSendBody ? await ctx.req.raw.arrayBuffer() : undefined;

					return fetch(upstreamUrl, {
						method: route.serializedMethod,
						headers: ctx.req.raw.headers,
						body,
					});
				},
			);
		}
	}
};

export const createGatewayClient = <
	TServices extends GatewayServices,
	TGatewayMiddlewares extends GatewayMiddlewares<TServices> | undefined = undefined,
>(
	gatewayBaseUrl: string,
	options?: ClientOptions,
): GatewayClient<TServices, TGatewayMiddlewares> => {
	type ServiceMap = GatewayClient<TServices, TGatewayMiddlewares>;
	const target: Partial<ServiceMap> = {};
	return new Proxy(target, {
		get: (obj, serviceKey) => {
			if (typeof serviceKey !== "string") {
				return undefined;
			}
			assertValidGatewayServiceKey(serviceKey);
			const existing = obj[serviceKey as keyof ServiceMap];
			if (existing) {
				return existing;
			}
			const client = createClient(gatewayBaseUrl, options) as {
				fetch: ServiceMap[keyof ServiceMap]["fetch"];
				fetchConfig: ServiceMap[keyof ServiceMap]["fetchConfig"];
				parseResponse: ServiceMap[keyof ServiceMap]["parseResponse"];
			};
			const serviceClient = {
				fetch: ((path, method, ...request) => {
					const namespacedPath = namespaceGatewayPath(serviceKey, path) as Parameters<
						ServiceMap[keyof ServiceMap]["fetch"]
					>[0];
					return client.fetch(namespacedPath, method, ...request);
				}) as ServiceMap[keyof ServiceMap]["fetch"],
				fetchConfig: ((path, method, ...request) => {
					const namespacedPath = namespaceGatewayPath(serviceKey, path) as Parameters<
						ServiceMap[keyof ServiceMap]["fetchConfig"]
					>[0];
					return client.fetchConfig(namespacedPath, method, ...request);
				}) as ServiceMap[keyof ServiceMap]["fetchConfig"],
				parseResponse: client.parseResponse,
			} as ServiceMap[keyof ServiceMap];
			obj[serviceKey as keyof ServiceMap] = serviceClient;
			return serviceClient;
		},
	}) as ServiceMap;
};
