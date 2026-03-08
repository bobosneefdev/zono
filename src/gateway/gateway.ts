import type { Hono } from "hono";
import { createClient } from "../client/client.js";
import type { ContractCallRoutes, ContractTree, HTTPMethod } from "../contract/contract.js";
import { compileContractRoutes } from "../contract/contract.js";
import type {
	InferAllMiddlewareResponseUnion,
	InferMiddlewareResponseUnion,
	MiddlewareSpec,
	MiddlewareTree,
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
	registerHonoRoute,
} from "../shared/shared.internal.js";
import type {
	ApiShape,
	EmptyObject,
	ExpandUnion,
	FetchResponse,
	TypedFetch,
} from "../shared/shared.js";

export type GatewayShape<TShape extends ApiShape> = {} & (TShape extends { CONTRACT: true }
	? { CONTRACT?: true }
	: EmptyObject) &
	(TShape extends { SHAPE: infer TChildShape extends Record<string, ApiShape> }
		? {
				SHAPE?: {
					[TKey in keyof TChildShape]?: GatewayShape<TChildShape[TKey]>;
				};
			}
		: EmptyObject);

export type GatewayService<
	TShape extends ApiShape,
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = {
	shape: GatewayShape<TShape>;
	contracts: TContracts;
	middlewares: TMiddlewares;
	errorMode: TErrorMode;
	baseUrl: string;
};

type GatewayMiddlewareTreeFromContracts<TContracts extends ContractTree> = {
	MIDDLEWARE?: Record<string, MiddlewareSpec>;
} & (TContracts extends { SHAPE: infer TShape extends Record<string, ContractTree> }
	? {
			SHAPE?: {
				[TKey in keyof TShape]?: GatewayMiddlewareTreeFromContracts<TShape[TKey]>;
			};
		}
	: EmptyObject);

export type GatewayServices = Record<
	string,
	GatewayService<
		ApiShape,
		ContractTree,
		{ MIDDLEWARE: Record<string, MiddlewareSpec> },
		ErrorMode
	>
>;

export type GatewayMiddlewares<TServices extends GatewayServices> = {
	SHAPE: {
		[TService in keyof TServices]: GatewayMiddlewareTreeFromContracts<
			TServices[TService]["contracts"]
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

type MiddlewareDefinitionsAtNode<TNode> = TNode extends {
	MIDDLEWARE: infer TDefinitions;
}
	? TDefinitions extends Record<string, MiddlewareSpec>
		? TDefinitions[keyof TDefinitions]
		: never
	: never;

type MiddlewareDefinitionsAlongPath<TNode, TSegments extends Array<string>> =
	| MiddlewareDefinitionsAtNode<TNode>
	| (TSegments extends [infer THead extends string, ...infer TTail extends Array<string>]
			? TNode extends { SHAPE: infer TShape extends Record<string, MiddlewareTree> }
				? THead extends keyof TShape
					? MiddlewareDefinitionsAlongPath<TShape[THead], TTail>
					: never
				: never
			: never);

type GatewayServiceTreeAtRoot<
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
> = MiddlewareDefinitionsAlongPath<
	GatewayServiceTreeAtRoot<TGatewayMiddlewares, TService>,
	PathSegments<TPath>
> extends infer TDefinitions
	? TDefinitions extends MiddlewareSpec
		? InferMiddlewareResponseUnion<TDefinitions>
		: never
	: never;

type GatewayClientRoutes<
	TService extends GatewayService<
		ApiShape,
		ContractTree,
		{ MIDDLEWARE: Record<string, MiddlewareSpec> },
		ErrorMode
	>,
	TGatewayMiddlewares,
	TServiceKey extends PropertyKey,
> = ContractCallRoutes<TService["contracts"]> extends infer TRoute
	? TRoute extends {
			path: infer TPath extends string;
			method: infer TMethod extends HTTPMethod;
			request: infer TRequest;
			response: infer TResponse;
		}
		? {
				path: TPath;
				method: TMethod;
				request: TRequest;
				response: ExpandUnion<
					FetchResponse<
						| TResponse
						| InferAllMiddlewareResponseUnion<TService["middlewares"]>
						| InferGatewayMiddlewareResponseUnionAtPath<
								TGatewayMiddlewares,
								TServiceKey,
								TPath
						  >
						| ErrorResponse<TService["errorMode"]>
					>
				>;
			}
		: never
	: never;

type GatewayServiceClientFetchMethod<
	TService extends GatewayService<
		ApiShape,
		ContractTree,
		{ MIDDLEWARE: Record<string, MiddlewareSpec> },
		ErrorMode
	>,
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
	TShape extends ApiShape,
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
>(
	shape: GatewayShape<TShape>,
	contracts: TContracts,
	middlewares: TMiddlewares,
	errorMode: TErrorMode,
	baseUrl: string,
): GatewayService<TShape, TContracts, TMiddlewares, TErrorMode> => {
	return {
		shape,
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

const resolveRouteMiddlewares = (
	serviceMiddlewaresRoot: MiddlewareTree | undefined,
	serviceHandlersRoot: unknown,
	pathTemplate: string,
): MiddlewareBindings<{ MIDDLEWARE: Record<string, MiddlewareSpec> }, unknown> | undefined => {
	if (!serviceMiddlewaresRoot) {
		return undefined;
	}

	const mergedDefinitions: Record<string, MiddlewareSpec> = {};
	const mergedHandlers: Record<string, MiddlewareHandler<MiddlewareSpec, unknown>> = {};
	const middlewareNodes = collectShapePathNodes(serviceMiddlewaresRoot, pathTemplate);
	const handlerNodes = collectShapePathNodes(serviceHandlersRoot, pathTemplate);

	for (let index = 0; index < middlewareNodes.length; index += 1) {
		const middlewareNode = middlewareNodes[index];
		const handlersNode = handlerNodes[index];
		if (!isRecordObject(middlewareNode) || !isRecordObject(middlewareNode.MIDDLEWARE)) {
			continue;
		}
		if (!isRecordObject(handlersNode) || !isRecordObject(handlersNode.MIDDLEWARE)) {
			throw new Error("Missing MIDDLEWARE handlers node for gateway middleware layer");
		}
		for (const [middlewareName, definition] of Object.entries(middlewareNode.MIDDLEWARE)) {
			const handler = handlersNode.MIDDLEWARE[middlewareName];
			if (typeof handler !== "function") {
				throw new Error(`Missing gateway middleware handler '${middlewareName}'`);
			}
			mergedDefinitions[middlewareName] = definition as MiddlewareSpec;
			mergedHandlers[middlewareName] = handler as MiddlewareHandler<MiddlewareSpec, unknown>;
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
		const routes = compileContractRoutes(service.contracts);
		for (const route of routes) {
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
							service.baseUrl,
						);

						const method = ctx.req.method.toUpperCase();
						const shouldSendBody = method !== "GET" && method !== "HEAD";
						const body = shouldSendBody ? await ctx.req.raw.arrayBuffer() : undefined;

						const upstreamResponse = await fetch(upstreamUrl, {
							method,
							headers: ctx.req.raw.headers,
							body,
						});

						return new Response(upstreamResponse.body, {
							status: upstreamResponse.status,
							headers: upstreamResponse.headers,
						});
					};

					const boundGatewayMiddlewares = options?.middlewares;
					const serviceTree = boundGatewayMiddlewares?.middlewares.SHAPE?.[
						serviceName as keyof TServices
					] as MiddlewareTree | undefined;
					if (!boundGatewayMiddlewares || !serviceTree) {
						return executeProxy();
					}

					const merged = resolveRouteMiddlewares(
						serviceTree,
						(boundGatewayMiddlewares.handlers as { SHAPE?: Record<string, unknown> })
							.SHAPE?.[serviceName],
						route.pathTemplate,
					);
					if (!merged) {
						return executeProxy();
					}

					return runMiddlewareHandlers(ctx, ourContext, merged, executeProxy);
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
