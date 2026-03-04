import type { Context, Hono } from "hono";
import type { ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type { HonoContextParams, HonoMiddlewareHandlerTree } from "~/hono/hono.types.js";
import {
	collectMiddlewareEntriesFromNode,
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
	isRecord,
	isRouterNode,
} from "~/internal/util.js";
import type { MiddlewaresDefinition } from "~/middleware/index.js";

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
	if (!isRecord(mwDef) || !isRecord(mwHandlers)) return [];

	const entries: Array<MiddlewareEntry> = [
		...collectMiddlewareEntriesFromNode(mwDef, mwHandlers),
	];

	let currentDef: Record<string, unknown> = mwDef;
	let currentHandlers: Record<string, unknown> = mwHandlers;
	for (const segment of pathSegments) {
		const defRouter = isRouterNode(currentDef) ? currentDef.ROUTER : undefined;
		const handlerRouter = isRouterNode(currentHandlers) ? currentHandlers.ROUTER : undefined;
		if (!defRouter || !handlerRouter) break;

		const nextDef = defRouter[segment];
		const nextHandler = handlerRouter[segment];
		if (!nextDef || !nextHandler || !isRecord(nextDef) || !isRecord(nextHandler)) break;

		currentDef = nextDef;
		currentHandlers = nextHandler;
		entries.push(...collectMiddlewareEntriesFromNode(currentDef, currentHandlers));
	}

	return entries;
}

/**
 * Generates gateway route and middleware structures from service definitions.
 * Combines multiple services into a single routable structure.
 * @param services - Map of service names to their route/middleware definitions
 * @returns Generated gateway structure with routes and middleware
 */
export function generateHonoGateway<const T extends GatewayInput>(
	services: T,
): GeneratedGateway<T> {
	const contracts: Record<string, unknown> = {};
	const middlewares: Record<string, unknown> = {};

	for (const [name, service] of Object.entries(services)) {
		contracts[name] = service.contracts;
		middlewares[name] = service.middlewares ?? {};
	}

	return {
		contracts: { ROUTER: contracts },
		middlewares: { ROUTER: middlewares },
	} as GeneratedGateway<T>;
}

/**
 * Initializes a Hono gateway that proxies requests to backend services.
 * Supports middlewares that execute before proxying.
 * @param app - Hono app instance
 * @param contracts - Generated gateway routes
 * @param middlewares - Middleware definition for the gateway
 * @param middlewareHandlers - Middleware handler implementations
 * @param options - Gateway configuration including service URLs
 * @returns The configured Hono gateway app
 */
export function initHonoGateway<
	TContracts,
	TMiddlewares extends MiddlewaresDefinition<TContracts> = MiddlewaresDefinition<TContracts>,
	TContextParams extends HonoContextParams = [],
>(
	app: Hono,
	contracts: TContracts,
	middlewares: TMiddlewares,
	middlewareHandlers: HonoMiddlewareHandlerTree<TMiddlewares, TContextParams>,
	options: GatewayOptions<TContracts, TContextParams>,
): Hono {
	const basePath = normalizeBasePath(options.basePath);
	app.notFound(() => buildNotFoundErrorResponse());
	app.onError(() => buildInternalErrorResponse());

	const services = options.services as Record<string, string>;
	const registrations = collectGatewayRoutes(contracts as Record<string, unknown>);

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
			middlewares,
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

/**
 * Creates gateway options with proper type inference for routes and context parameters.
 * @param _routes - Gateway routes (used for type inference only)
 * @param options - Gateway configuration options
 * @returns The options with type validation
 */
export function createGatewayOptions<TRoutes, TContextParams extends HonoContextParams = []>(
	_routes: TRoutes,
	options: GatewayOptions<TRoutes, TContextParams>,
): GatewayOptions<TRoutes, TContextParams> {
	return options;
}
