import type { Context, Hono } from "hono";
import { createClient } from "../client/client.js";
import { compileContractRoutes } from "../contract/contract.js";
import type { ContractsTree, HTTPMethod } from "../contract/contract.types.js";
import { runMiddlewareHandlers } from "../middleware/middleware.js";
import type { MiddlewareDefinition, MiddlewareTree } from "../middleware/middleware.types.js";
import type {
	BoundMiddlewareHandlers,
	ErrorMode,
	MiddlewareHandler,
} from "../server/server.types.js";
import type { Shape } from "../shared/shared.types.js";
import type {
	GatewayClient,
	GatewayInitOptions,
	GatewayMiddlewares,
	GatewayService,
	GatewayServiceShape,
	GatewayServices,
} from "./gateway.types.js";

export const createGatewayService = <
	TShape extends Shape,
	TContracts extends ContractsTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
	TErrorMode extends ErrorMode,
>(
	shape: GatewayServiceShape<TShape>,
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

const registerGatewayRoute = (
	app: Hono,
	method: HTTPMethod,
	path: string,
	handler: (ctx: Context) => Promise<Response>,
): void => {
	app.on(method.toUpperCase(), path, handler);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
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
):
	| BoundMiddlewareHandlers<{ MIDDLEWARE: Record<string, MiddlewareDefinition> }, unknown>
	| undefined => {
	if (!serviceMiddlewaresRoot) {
		return undefined;
	}

	const mergedDefinitions: Record<string, MiddlewareDefinition> = {};
	const mergedHandlers: Record<string, MiddlewareHandler<MiddlewareDefinition, unknown>> = {};

	const mergeNode = (middlewareNode: MiddlewareTree, handlersNode: unknown): void => {
		if (!middlewareNode.MIDDLEWARE) {
			return;
		}
		if (!isRecord(handlersNode) || !isRecord(handlersNode.MIDDLEWARE)) {
			throw new Error("Missing MIDDLEWARE handlers node for gateway middleware layer");
		}
		const handlersMap = handlersNode.MIDDLEWARE;
		for (const [middlewareName, definition] of Object.entries(middlewareNode.MIDDLEWARE)) {
			const handler = handlersMap[middlewareName];
			if (typeof handler !== "function") {
				throw new Error(`Missing gateway middleware handler '${middlewareName}'`);
			}
			mergedDefinitions[middlewareName] = definition;
			mergedHandlers[middlewareName] = handler as MiddlewareHandler<
				MiddlewareDefinition,
				unknown
			>;
		}
	};

	const segments = pathTemplate.split("/").filter(Boolean);
	let middlewareNode: MiddlewareTree = serviceMiddlewaresRoot;
	let handlersNode: unknown = serviceHandlersRoot;

	mergeNode(middlewareNode, handlersNode);

	for (const segment of segments) {
		const nextMiddlewareNode: MiddlewareTree | undefined = middlewareNode.SHAPE?.[segment];
		if (!nextMiddlewareNode) {
			break;
		}

		if (!isRecord(handlersNode) || !isRecord(handlersNode.SHAPE)) {
			throw new Error(
				`Missing SHAPE handlers node for gateway middleware segment '${segment}'`,
			);
		}
		const nextHandlersNode = handlersNode.SHAPE[segment];
		if (!nextHandlersNode) {
			throw new Error(`Missing gateway middleware handlers for segment '${segment}'`);
		}

		middlewareNode = nextMiddlewareNode;
		handlersNode = nextHandlersNode;
		mergeNode(middlewareNode, handlersNode);
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
	options?: GatewayInitOptions<TServices, TGatewayMiddlewares, TContext>,
): void => {
	for (const [serviceName, service] of Object.entries(services)) {
		const routes = compileContractRoutes(service.contracts);
		for (const route of routes) {
			registerGatewayRoute(
				app,
				route.method,
				route.honoPath,
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

export type { GatewayInitOptions, GatewayMiddlewares } from "./gateway.types.js";
