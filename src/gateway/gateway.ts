import type { Context, Hono } from "hono";
import { createClient } from "../client/client.js";
import { compileContractRoutes } from "../contract/contract.js";
import type { ContractsTree, HTTPMethod } from "../contract/contract.types.js";
import type { MiddlewareDefinition } from "../middleware/middleware.types.js";
import type { ErrorMode } from "../server/server.types.js";
import type { Shape } from "../shared/shared.types.js";
import type {
	GatewayClient,
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

export const createGatewayServices = <TServices extends GatewayServices>(
	services: TServices,
): TServices => {
	return services;
};

export const initGateway = <TServices extends GatewayServices>(
	app: Hono,
	services: TServices,
): void => {
	for (const service of Object.values(services)) {
		const routes = compileContractRoutes(service.contracts);
		for (const route of routes) {
			registerGatewayRoute(
				app,
				route.method,
				route.honoPath,
				async (ctx): Promise<Response> => {
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
				},
			);
		}
	}
};

export const createGatewayClient = <TServices extends GatewayServices>(
	gatewayBaseUrl: string,
): GatewayClient<TServices> => {
	type ServiceMap = GatewayClient<TServices>;
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
			const client = createClient(gatewayBaseUrl);
			const serviceClient = { fetch: client.fetch } as ServiceMap[keyof ServiceMap];
			obj[serviceKey as keyof ServiceMap] = serviceClient;
			return serviceClient;
		},
	}) as ServiceMap;
};
