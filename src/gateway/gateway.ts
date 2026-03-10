import type { Context, Hono } from "hono";
import { createClient } from "../client/client.js";
import type {
	ContractCallRoutes,
	ContractMethods,
	ContractTree,
	HTTPMethod,
} from "../contract/contract.js";
import { compileContractRoutes } from "../contract/contract.js";
import type {
	InferMiddlewareResponseUnion,
	InferMiddlewareResponseUnionAtPath,
	MiddlewareLayer,
	MiddlewareMapAtNode,
	MiddlewareSpec,
	MiddlewareTree,
	MiddlewareTreeFor,
} from "../middleware/middleware.js";
import { collectMiddlewareLayers } from "../middleware/middleware.js";
import type {
	ContextFactory,
	ErrorResponse,
	MiddlewareBindings,
	ServerErrorMode,
} from "../server/server.js";
import {
	type ApiShape,
	collectShapePathNodes,
	type EmptyObject,
	isRecordObject,
	type MapFetchRouteResponse,
	registerHonoRoute,
	type TypedFetch,
	type TypedFetchConfig,
	type TypedParseResponse,
	toHonoPath,
	toSerializedRuntimeResponse,
	validateAndSerializeResponse,
} from "../shared/shared.js";

export type GatewayServiceMask<TShape extends ApiShape> = {} & (TShape extends { CONTRACT: true }
	? { CONTRACT?: true }
	: EmptyObject) &
	(TShape extends { SHAPE: infer TChildShape extends Record<string, ApiShape> }
		? {
				SHAPE?: {
					[TKey in keyof TChildShape]?: GatewayServiceMask<TChildShape[TKey]>;
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
	(TMask extends { SHAPE: infer TMaskShape extends Record<string, unknown> }
		? TContracts extends { SHAPE: infer TContractShape extends Record<string, ContractTree> }
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

type ApiShapeFromContractTree<TContracts extends ContractTree> = {} & (TContracts extends {
	CONTRACT: infer TContract;
}
	? TContract extends ContractMethods
		? { CONTRACT: true }
		: EmptyObject
	: EmptyObject) &
	(TContracts extends { SHAPE: infer TShape extends Record<string, ContractTree> }
		? {
				SHAPE: {
					[TKey in keyof TShape]: ApiShapeFromContractTree<TShape[TKey]>;
				};
			}
		: EmptyObject);

export type GatewayService<
	TContracts extends ContractTree,
	TMask extends GatewayServiceMask<ApiShapeFromContractTree<TContracts>>,
	TMiddlewares extends MiddlewareTreeFor<ApiShapeFromContractTree<TContracts>>,
	TErrorMode extends ServerErrorMode,
> = {
	mask: TMask;
	contracts: TContracts;
	middlewares: TMiddlewares;
	errorMode: TErrorMode;
	baseUrl: string;
};

type AnyGatewayService = {
	mask: GatewayServiceMask<ApiShape>;
	contracts: ContractTree;
	middlewares: MiddlewareTree;
	errorMode: ServerErrorMode;
	baseUrl: string;
};

type MaskedGatewayServiceContracts<TService extends AnyGatewayService> =
	ApplyGatewayServiceMaskToContractTree<TService["contracts"], TService["mask"]>;

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
				| InferMiddlewareResponseUnionAtPath<TService["middlewares"], TPath>
				| InferGatewayMiddlewareResponseUnionAtPath<TGatewayMiddlewares, TServiceKey, TPath>
				| ErrorResponse<TService["errorMode"]>
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

export type GatewayOptions<
	TServices extends GatewayServices,
	TGatewayMiddlewares extends GatewayMiddlewares<TServices>,
	TContext,
> = {
	middlewares?: MiddlewareBindings<TGatewayMiddlewares, TContext>;
	createContext?: ContextFactory<TContext>;
};

export const createGatewayService = <
	TContracts extends ContractTree,
	const TMask extends GatewayServiceMask<ApiShapeFromContractTree<TContracts>>,
	TMiddlewares extends MiddlewareTreeFor<ApiShapeFromContractTree<TContracts>>,
	TErrorMode extends ServerErrorMode,
>(
	mask: TMask,
	contracts: TContracts,
	middlewares: TMiddlewares,
	errorMode: TErrorMode,
	baseUrl: string,
): GatewayService<TContracts, TMask, TMiddlewares, TErrorMode> => {
	return {
		mask,
		contracts,
		middlewares,
		errorMode,
		baseUrl,
	};
};

export const createGatewayServices = <TServices extends GatewayServices>(
	services: TServices,
): TServices => {
	return services;
};

const applyGatewayServiceMask = (mask: unknown, contracts: unknown): ContractTree => {
	if (!isRecordObject(mask) || !isRecordObject(contracts)) {
		return {};
	}

	const maskedContracts: ContractTree = {};

	if (mask.CONTRACT === true && isRecordObject(contracts.CONTRACT)) {
		maskedContracts.CONTRACT = contracts.CONTRACT;
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
	method: HTTPMethod;
	serializedMethod: string;
	shouldSendBody: boolean;
	baseUrl: string;
	errorMode: ServerErrorMode;
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

const getGatewayErrorMode = (ctx: Context): ServerErrorMode => {
	return (
		(getContextValue(ctx, ZONO_GATEWAY_ERROR_MODE_KEY) as ServerErrorMode | undefined) ??
		"public"
	);
};

const makeGatewayErrorResponse = (error: unknown, errorMode: ServerErrorMode) => {
	if (errorMode === "public") {
		return {
			status: 500,
			type: "JSON" as const,
			data: {
				message: error instanceof Error ? error.message : "Internal server error",
			},
		};
	}

	return {
		status: 500,
		type: "JSON" as const,
		data: {
			message: error instanceof Error ? error.message : "Internal server error",
			issues: error,
			stack: error instanceof Error ? error.stack : undefined,
		},
	};
};

const getUniquePathTemplates = (routes: Array<{ pathTemplate: string }>): Array<string> => {
	return Array.from(new Set(routes.map((route) => route.pathTemplate)));
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
	TGatewayMiddlewares extends GatewayMiddlewares<TServices> = GatewayMiddlewares<TServices>,
	TContext = unknown,
>(
	app: Hono,
	services: TServices,
	options?: GatewayOptions<TServices, TGatewayMiddlewares, TContext>,
): void => {
	const createContext = options?.createContext;
	if (createContext) {
		app.use("*", async (ctx, next) => {
			setContextValue(ctx, ZONO_GATEWAY_CONTEXT_KEY, await createContext(ctx));
			await next();
		});
	}

	app.onError((error, ctx) => {
		return toSerializedRuntimeResponse(
			makeGatewayErrorResponse(error, getGatewayErrorMode(ctx)),
			"error",
		);
	});

	for (const [serviceName, service] of Object.entries(services)) {
		const maskedContracts = applyGatewayServiceMask(service.mask, service.contracts);
		const preparedRoutes: Array<PreparedGatewayRoute> = compileContractRoutes(
			maskedContracts,
		).map((route) => {
			return {
				pathTemplate: route.pathTemplate,
				method: route.method,
				serializedMethod: route.method.toUpperCase(),
				shouldSendBody: route.method !== "get" && route.method !== "head",
				baseUrl: service.baseUrl,
				errorMode: service.errorMode,
			};
		});

		if (options?.middlewares) {
			for (const pathTemplate of getUniquePathTemplates(preparedRoutes)) {
				const { middlewareNodes, handlerNodes } = collectGatewayRouteMiddlewareNodes(
					options.middlewares.middlewares,
					options.middlewares.handlers,
					serviceName,
					pathTemplate,
				);
				const layers = collectMiddlewareLayers<TContext>(middlewareNodes, handlerNodes);
				app.use(toHonoPath(pathTemplate), async (ctx, next) => {
					setContextValue(ctx, ZONO_GATEWAY_ERROR_MODE_KEY, service.errorMode);
					await next();
				});
				for (const layer of layers) {
					registerGatewayMiddlewareLayer(app, pathTemplate, layer);
				}
			}
		} else {
			for (const pathTemplate of getUniquePathTemplates(preparedRoutes)) {
				app.use(toHonoPath(pathTemplate), async (ctx, next) => {
					setContextValue(ctx, ZONO_GATEWAY_ERROR_MODE_KEY, service.errorMode);
					await next();
				});
			}
		}

		for (const route of preparedRoutes) {
			registerHonoRoute(
				app,
				route.method,
				route.pathTemplate,
				async (ctx): Promise<Response> => {
					void getGatewayContext<TContext>(ctx);
					const incomingUrl = new URL(ctx.req.url);
					const upstreamUrl = new URL(
						incomingUrl.pathname + incomingUrl.search,
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
): GatewayClient<TServices, TGatewayMiddlewares> => {
	type ServiceMap = GatewayClient<TServices, TGatewayMiddlewares>;
	const target: Partial<ServiceMap> = {};
	return new Proxy(target, {
		get: (obj, serviceKey) => {
			if (typeof serviceKey !== "string") {
				return undefined;
			}
			const existing = obj[serviceKey as keyof ServiceMap];
			if (existing) {
				return existing;
			}
			const client = createClient(gatewayBaseUrl) as {
				fetch: ServiceMap[keyof ServiceMap]["fetch"];
				fetchConfig: ServiceMap[keyof ServiceMap]["fetchConfig"];
				parseResponse: ServiceMap[keyof ServiceMap]["parseResponse"];
			};
			const serviceClient = {
				fetch: client.fetch,
				fetchConfig: client.fetchConfig,
				parseResponse: client.parseResponse,
			} as ServiceMap[keyof ServiceMap];
			obj[serviceKey as keyof ServiceMap] = serviceClient;
			return serviceClient;
		},
	}) as ServiceMap;
};
