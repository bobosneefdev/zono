import type { Hono } from "hono";
import { createClient } from "../client/client.js";
import type {
	ContractCallRoutes,
	ContractMethods,
	ContractTree,
	HTTPMethod,
} from "../contract/contract.js";
import { compileContractRoutes } from "../contract/contract.js";
import type {
	InferAllMiddlewareResponseUnion,
	MiddlewareSpec,
	MiddlewareTree,
	MiddlewareTreeFor,
} from "../middleware/middleware.js";
import { runMiddlewareHandlers } from "../middleware/middleware.js";
import type {
	ContextFactory,
	ErrorMode,
	ErrorResponse,
	MiddlewareBindings,
	MiddlewareHandler,
} from "../server/server.js";
import {
	collectShapePathNodes,
	isRecordObject,
	type MapFetchRouteResponse,
	registerHonoRoute,
} from "../shared/shared.internal.js";
import type { ApiShape, EmptyObject, TypedFetch } from "../shared/shared.js";

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
	TErrorMode extends ErrorMode,
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
	middlewares: { MIDDLEWARE: Record<string, MiddlewareSpec> };
	errorMode: ErrorMode;
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

type SplitPath<TPath extends string> = TPath extends ""
	? []
	: TPath extends `${infer THead}/${infer TRest}`
		? [THead, ...SplitPath<TRest>]
		: [TPath];

type PathSegments<TPath extends string> = TPath extends `/${infer TTrimmed}`
	? SplitPath<TTrimmed>
	: SplitPath<TPath>;

type MiddlewareMapAtNode<TNode> = TNode extends {
	MIDDLEWARE: infer TDefinitions;
}
	? TDefinitions extends Record<string, MiddlewareSpec>
		? TDefinitions
		: EmptyObject
	: EmptyObject;

type MergeMiddlewareMaps<
	TBase extends Record<string, MiddlewareSpec>,
	TNext extends Record<string, MiddlewareSpec>,
> = Omit<TBase, keyof TNext> & TNext;

type GatewayServiceMiddlewareTree<
	TGatewayMiddlewares,
	TService extends PropertyKey,
> = TGatewayMiddlewares extends { SHAPE: infer TShape extends Record<PropertyKey, MiddlewareTree> }
	? TService extends keyof TShape
		? TShape[TService]
		: never
	: never;

type MergeMiddlewareDefinitionsAlongPath<
	TNode,
	TSegments extends Array<string>,
	TAcc extends Record<string, MiddlewareSpec> = EmptyObject,
> = [TNode] extends [never]
	? TAcc
	: TNode extends { SHAPE: infer TShape extends Record<string, MiddlewareTree> }
		? TSegments extends [infer THead extends string, ...infer TTail extends Array<string>]
			? THead extends keyof TShape
				? MergeMiddlewareDefinitionsAlongPath<
						TShape[THead],
						TTail,
						MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>
					>
				: MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>
			: MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>
		: MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>;

type InferGatewayMiddlewareResponseUnionAtPath<
	TGatewayMiddlewares,
	TService extends PropertyKey,
	TPath extends string,
> = InferAllMiddlewareResponseUnion<{
	MIDDLEWARE: MergeMiddlewareDefinitionsAlongPath<
		GatewayServiceMiddlewareTree<TGatewayMiddlewares, TService>,
		PathSegments<TPath>,
		MiddlewareMapAtNode<TGatewayMiddlewares>
	>;
}>;

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
				| InferAllMiddlewareResponseUnion<TService["middlewares"]>
				| InferGatewayMiddlewareResponseUnionAtPath<TGatewayMiddlewares, TServiceKey, TPath>
				| ErrorResponse<TService["errorMode"]>
			>
		: never
	: never;

type GatewayServiceClientFetchMethod<
	TService extends AnyGatewayService,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = TypedFetch<GatewayClientRoutes<TService, TGatewayMiddlewares, TServiceKey>>;

export type GatewayClient<TServices extends GatewayServices, TGatewayMiddlewares = undefined> = {
	[TService in keyof TServices]: {
		fetch: GatewayServiceClientFetchMethod<TServices[TService], TGatewayMiddlewares, TService>;
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
	TErrorMode extends ErrorMode,
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

const resolveRouteMiddlewares = <TContext>(
	middlewareNodes: Array<unknown>,
	handlerNodes: Array<unknown>,
): MiddlewareBindings<{ MIDDLEWARE: Record<string, MiddlewareSpec> }, TContext> | undefined => {
	if (middlewareNodes.length === 0) {
		return undefined;
	}

	const mergedDefinitions: Record<string, MiddlewareSpec> = {};
	const mergedHandlers: Record<string, MiddlewareHandler<MiddlewareSpec, TContext>> = {};

	for (let index = 0; index < middlewareNodes.length; index += 1) {
		const middlewareNode = middlewareNodes[index];
		const handlersNode = handlerNodes[index];
		if (!isRecordObject(middlewareNode) || !isRecordObject(middlewareNode.MIDDLEWARE)) {
			continue;
		}
		if (!isRecordObject(handlersNode) || !isRecordObject(handlersNode.MIDDLEWARE)) {
			throw new Error("Missing MIDDLEWARE handlers node for gateway middleware layer");
		}
		const middlewareMap = middlewareNode.MIDDLEWARE as Record<string, unknown>;
		const handlerMap = handlersNode.MIDDLEWARE as Record<string, unknown>;
		for (const [middlewareName, _definition] of Object.entries(middlewareMap)) {
			const handler = handlerMap[middlewareName];
			if (typeof handler !== "function") {
				throw new Error(`Missing gateway middleware handler '${middlewareName}'`);
			}
			Object.defineProperty(mergedDefinitions, middlewareName, {
				configurable: true,
				enumerable: true,
				get: () => {
					const currentDefinition = middlewareMap[middlewareName];
					if (!isRecordObject(currentDefinition)) {
						throw new Error(
							`Missing gateway middleware definition '${middlewareName}'`,
						);
					}
					return currentDefinition as MiddlewareSpec;
				},
			});
			Object.defineProperty(mergedHandlers, middlewareName, {
				configurable: true,
				enumerable: true,
				get: () => {
					const currentHandler = handlerMap[middlewareName];
					if (typeof currentHandler !== "function") {
						throw new Error(`Missing gateway middleware handler '${middlewareName}'`);
					}
					return currentHandler as MiddlewareHandler<MiddlewareSpec, TContext>;
				},
			});
		}
	}

	if (Object.keys(mergedDefinitions).length === 0) {
		return undefined;
	}

	return {
		middlewares: { MIDDLEWARE: mergedDefinitions },
		handlers: {
			MIDDLEWARE: mergedHandlers,
		},
	};
};

type PreparedGatewayRoute<TContext> = {
	pathTemplate: string;
	method: HTTPMethod;
	serializedMethod: string;
	shouldSendBody: boolean;
	baseUrl: string;
	middlewares?: MiddlewareBindings<{ MIDDLEWARE: Record<string, MiddlewareSpec> }, TContext>;
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

export const initGateway = <
	TServices extends GatewayServices,
	TGatewayMiddlewares extends GatewayMiddlewares<TServices> = GatewayMiddlewares<TServices>,
	TContext = unknown,
>(
	app: Hono,
	services: TServices,
	options?: GatewayOptions<TServices, TGatewayMiddlewares, TContext>,
): void => {
	for (const [serviceName, service] of Object.entries(services)) {
		const maskedContracts = applyGatewayServiceMask(service.mask, service.contracts);
		const preparedRoutes: Array<PreparedGatewayRoute<TContext>> = compileContractRoutes(
			maskedContracts,
		).map((route) => {
			const mergedMiddlewares = options?.middlewares
				? (() => {
						const { middlewareNodes, handlerNodes } =
							collectGatewayRouteMiddlewareNodes(
								options.middlewares.middlewares,
								options.middlewares.handlers,
								serviceName,
								route.pathTemplate,
							);
						return resolveRouteMiddlewares<TContext>(middlewareNodes, handlerNodes);
					})()
				: undefined;

			return {
				pathTemplate: route.pathTemplate,
				method: route.method,
				serializedMethod: route.method.toUpperCase(),
				shouldSendBody: route.method !== "get" && route.method !== "head",
				baseUrl: service.baseUrl,
				middlewares: mergedMiddlewares,
			};
		});
		for (const route of preparedRoutes) {
			registerHonoRoute(
				app,
				route.method,
				route.pathTemplate,
				async (ctx): Promise<Response> => {
					const ourContext = options?.createContext
						? await options.createContext(ctx)
						: (undefined as Awaited<TContext>);

					const executeProxy = async (): Promise<Response> => {
						const incomingUrl = new URL(ctx.req.url);
						const upstreamUrl = new URL(
							incomingUrl.pathname + incomingUrl.search,
							route.baseUrl,
						);
						const body = route.shouldSendBody
							? await ctx.req.raw.arrayBuffer()
							: undefined;

						return fetch(upstreamUrl, {
							method: route.serializedMethod,
							headers: ctx.req.raw.headers,
							body,
						});
					};

					if (!route.middlewares) {
						return executeProxy();
					}

					return runMiddlewareHandlers(ctx, ourContext, route.middlewares, executeProxy);
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
			};
			const serviceClient = { fetch: client.fetch } as ServiceMap[keyof ServiceMap];
			obj[serviceKey as keyof ServiceMap] = serviceClient;
			return serviceClient;
		},
	}) as ServiceMap;
};
