import type { Context, Hono } from "hono";
import type { ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import { HonoContextParams, HonoMiddlewareHandlerTree } from "~/hono/hono.types.js";
import {
	executeMiddlewareChain,
	type MiddlewareEntry,
	normalizeBasePath,
	registerHonoRoute,
} from "~/hono/hono.util.js";
import type {
	GatewayInput,
	GatewayOptions,
	GeneratedGateway,
} from "~/hono_gateway/hono_gateway.types.js";
import { buildInternalErrorResponse, buildNotFoundErrorResponse } from "~/internal/server.js";
import {
	dotPathToParamPath,
	dotPathToSlashPath,
	getContractMethods,
	isContractNode,
	isMiddlewareNode,
	isRecord,
	isRouterNode,
} from "~/internal/util.js";
import { MiddlewareDefinition } from "~/middleware/index.js";

type GatewayRouteRegistration = {
	namespace: string;
	serviceRouterPath: string;
	gatewayHttpPath: string;
	method: ContractMethod;
};

function collectServiceRoutes(
	node: unknown,
	namespace: string,
	dotPathPrefix: string,
	registrations: Array<GatewayRouteRegistration>,
): void {
	if (!isRecord(node)) return;

	if (isContractNode(node)) {
		const contractMap = node.CONTRACT as ContractMethodMap;
		const fullDotPath = dotPathPrefix ? `${namespace}.${dotPathPrefix}` : namespace;

		for (const method of getContractMethods(contractMap)) {
			registrations.push({
				namespace,
				serviceRouterPath: dotPathToSlashPath(dotPathPrefix),
				gatewayHttpPath: dotPathToParamPath(fullDotPath),
				method,
			});
		}

		if (isRouterNode(node)) {
			for (const [key, child] of Object.entries(node.ROUTER)) {
				const childPath = dotPathPrefix ? `${dotPathPrefix}.${key}` : key;
				collectServiceRoutes(child, namespace, childPath, registrations);
			}
		}
	} else if (isRouterNode(node)) {
		for (const [key, child] of Object.entries(node.ROUTER)) {
			const childPath = dotPathPrefix ? `${dotPathPrefix}.${key}` : key;
			collectServiceRoutes(child, namespace, childPath, registrations);
		}
	}
}

function collectGatewayRoutes(routes: Record<string, unknown>): Array<GatewayRouteRegistration> {
	const registrations: Array<GatewayRouteRegistration> = [];
	const router = routes.ROUTER as Record<string, unknown>;
	if (!router) return registrations;
	for (const [namespace, serviceRoutes] of Object.entries(router)) {
		collectServiceRoutes(serviceRoutes, namespace, "", registrations);
	}
	return registrations;
}

function createProxyHandler(
	serviceBaseUrl: string,
	prefix: string,
): (context: Context) => Promise<Response> {
	const normalizedBaseUrl = serviceBaseUrl.replace(/\/+$/, "");

	return async (context: Context): Promise<Response> => {
		const servicePath = context.req.path.slice(prefix.length) || "/";
		const url = new URL(context.req.url);
		const upstreamUrl = `${normalizedBaseUrl}${servicePath}${url.search}`;

		const headers = new Headers(context.req.raw.headers);
		headers.delete("host");

		const init: RequestInit = {
			method: context.req.method,
			headers,
		};

		if (context.req.method !== "GET" && context.req.method !== "HEAD" && context.req.raw.body) {
			init.body = context.req.raw.body;
			(init as Record<string, unknown>).duplex = "half";
		}

		try {
			const response = await fetch(upstreamUrl, init);
			return new Response(response.body, {
				status: response.status,
				headers: response.headers,
			});
		} catch {
			return new Response(JSON.stringify({ error: "Bad Gateway" }), {
				status: 502,
				headers: { "content-type": "application/json" },
			});
		}
	};
}

function collectGatewayMiddleware(
	mwDef: unknown,
	mwHandlers: unknown,
	pathSegments: Array<string>,
): Array<MiddlewareEntry> {
	const entries: Array<MiddlewareEntry> = [];
	if (!isRecord(mwDef) || !isRecord(mwHandlers)) return entries;

	if (isMiddlewareNode(mwDef) && isMiddlewareNode(mwHandlers)) {
		for (const name of Object.keys(mwDef.MIDDLEWARE)) {
			const handler = mwHandlers.MIDDLEWARE[name];
			if (handler === null || handler === undefined || typeof handler !== "function")
				continue;
			entries.push({
				handler: handler as MiddlewareEntry<ReadonlyArray<unknown>>["handler"],
			});
		}
	}

	let currentDef: Record<string, unknown> = mwDef;
	let currentHandlers: Record<string, unknown> = mwHandlers;
	for (const segment of pathSegments) {
		const defRouter = isRouterNode(currentDef) ? currentDef.ROUTER : undefined;
		const handlerRouter = isRouterNode(currentHandlers)
			? currentHandlers.ROUTER
			: undefined;
		if (!defRouter || !handlerRouter) break;

		const nextDef = defRouter[segment];
		const nextHandler = handlerRouter[segment];
		if (!nextDef || !nextHandler) break;
		if (!isRecord(nextDef) || !isRecord(nextHandler)) break;

		currentDef = nextDef;
		currentHandlers = nextHandler;

		if (isMiddlewareNode(currentDef) && isMiddlewareNode(currentHandlers)) {
			for (const name of Object.keys(currentDef.MIDDLEWARE)) {
				const handler = currentHandlers.MIDDLEWARE[name];
				if (handler === null || handler === undefined || typeof handler !== "function")
					continue;
				entries.push({
					handler: handler as MiddlewareEntry<ReadonlyArray<unknown>>["handler"],
				});
			}
		}
	}

	return entries;
}

export function generateHonoGatewayRoutesAndMiddleware<const T extends GatewayInput>(
	services: T,
): GeneratedGateway<T> {
	const routes: Record<string, unknown> = {};
	const middleware: Record<string, unknown> = {};

	for (const [name, service] of Object.entries(services)) {
		routes[name] = service.routes;
		middleware[name] = service.middleware ?? {};
	}

	return {
		routes: { ROUTER: routes },
		middleware: { ROUTER: middleware },
	} as GeneratedGateway<T>;
}

export function createHonoGateway<
	TRoutes,
	TMiddleware extends MiddlewareDefinition<TRoutes> = MiddlewareDefinition<TRoutes>,
	TContextParams extends HonoContextParams = [],
>(
	app: Hono,
	routes: TRoutes,
	middleware: TMiddleware,
	middlewareHandlers: HonoMiddlewareHandlerTree<TMiddleware, TContextParams>,
	options: GatewayOptions<TRoutes, TContextParams>,
): Hono {
	const basePath = normalizeBasePath(options.basePath);
	app.notFound(() => buildNotFoundErrorResponse());
	app.onError(() => buildInternalErrorResponse());

	const services = options.services as Record<string, string>;
	const registrations = collectGatewayRoutes(routes as Record<string, unknown>);

	for (const registration of registrations) {
		const serviceBaseUrl = services[registration.namespace];
		if (!serviceBaseUrl) {
			throw new Error(`Missing service URL for namespace: ${registration.namespace}`);
		}

		const gatewayPathSegments = registration.gatewayHttpPath
			.slice(1)
			.split("/")
			.filter(Boolean);
		const middlewareChain = collectGatewayMiddleware(
			middleware,
			middlewareHandlers,
			gatewayPathSegments.map((s) => (s.startsWith(":") ? `$${s.slice(1)}` : s)),
		);

		const prefix = basePath
			? `${basePath}/${registration.namespace}`
			: `/${registration.namespace}`;
		const proxyHandler = createProxyHandler(serviceBaseUrl, prefix);

		const path = basePath
			? `${basePath}${registration.gatewayHttpPath}`
			: registration.gatewayHttpPath;

		registerHonoRoute(app, registration.method, path, (context) =>
			executeMiddlewareChain(context, middlewareChain, (ctx) => proxyHandler(ctx), [
				context,
			] as const),
		);
	}

	return app;
}

export function createGatewayOptions<TRoutes, TContextParams extends HonoContextParams = []>(
	_routes: TRoutes,
	options: GatewayOptions<TRoutes, TContextParams>,
): GatewayOptions<TRoutes, TContextParams> {
	return options;
}
