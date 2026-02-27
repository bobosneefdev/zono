import type { Context, Hono, MiddlewareHandler } from "hono";
import type { ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import { executeMiddlewareChain, normalizeBasePath, registerHonoRoute } from "~/hono/hono.util.js";
import type {
	FilteredRouter,
	GatewayOptions,
	IncludeShape,
} from "~/hono_gateway/hono_gateway.types.js";
import { getContractMethods, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";

type GatewayRouteRegistration = {
	namespace: string;
	serviceRouterPath: string;
	gatewayHttpPath: string;
	method: ContractMethod;
};

function dotPathToSlashPath(dotPath: string): string {
	if (!dotPath) return "/";
	return `/${dotPath.split(".").filter(Boolean).join("/")}`;
}

function dotPathToParamPath(dotPath: string): string {
	if (!dotPath) return "/";
	const segments = dotPath.split(".").filter(Boolean);
	const mapped = segments.map((s) => (s.startsWith("$") ? `:${s.slice(1)}` : s));
	return `/${mapped.join("/")}`;
}

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
	} else {
		for (const [key, child] of Object.entries(node)) {
			const childPath = dotPathPrefix ? `${dotPathPrefix}.${key}` : key;
			collectServiceRoutes(child, namespace, childPath, registrations);
		}
	}
}

function collectGatewayRoutes(router: Record<string, unknown>): Array<GatewayRouteRegistration> {
	const registrations: Array<GatewayRouteRegistration> = [];
	for (const [namespace, serviceRouter] of Object.entries(router)) {
		collectServiceRoutes(serviceRouter, namespace, "", registrations);
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

function filterByIncludeShape(
	node: Record<string, unknown>,
	include: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, filter] of Object.entries(include)) {
		const child = node[key];
		if (!isRecord(child)) continue;

		if (isContractNode(child)) {
			if (filter === true) {
				result[key] = { CONTRACT: child.CONTRACT };
			} else if (isRecord(filter) && isRouterNode(child)) {
				result[key] = {
					CONTRACT: child.CONTRACT,
					ROUTER: filterByIncludeShape(child.ROUTER, filter),
				};
			} else {
				result[key] = { CONTRACT: child.CONTRACT };
			}
		} else if (isRecord(filter)) {
			result[key] = filterByIncludeShape(child, filter);
		}
	}
	return result;
}

export function createGatewayRouterService<TRouter, const TInclude extends IncludeShape<TRouter>>(
	router: TRouter,
	options: { includeOnlyShape: TInclude },
): FilteredRouter<TRouter, TInclude> {
	return filterByIncludeShape(
		router as Record<string, unknown>,
		options.includeOnlyShape as Record<string, unknown>,
	) as FilteredRouter<TRouter, TInclude>;
}

export function createGatewayRouter<T extends Record<string, unknown>>(services: T): T {
	return services;
}

export function initHonoGateway<TRouter extends Record<string, unknown>>(
	app: Hono,
	router: TRouter,
	options: GatewayOptions<TRouter>,
): Hono {
	const basePath = normalizeBasePath(options.basePath);
	const globalMiddleware: Array<MiddlewareHandler> = options.globalMiddleware ?? [];
	const services = options.services as Record<
		string,
		{
			baseUrl: string;
			middleware?: Array<MiddlewareHandler>;
			pathMiddleware?: Record<string, Array<MiddlewareHandler>>;
		}
	>;

	const registrations = collectGatewayRoutes(router);

	for (const registration of registrations) {
		const serviceConfig = services[registration.namespace];
		if (!serviceConfig) {
			throw new Error(`Missing service config for namespace: ${registration.namespace}`);
		}

		const serviceMiddleware = serviceConfig.middleware ?? [];
		const pathMiddleware = serviceConfig.pathMiddleware?.[registration.serviceRouterPath] ?? [];

		const middlewareChain = [...globalMiddleware, ...serviceMiddleware, ...pathMiddleware];

		const prefix = basePath
			? `${basePath}/${registration.namespace}`
			: `/${registration.namespace}`;

		const proxyHandler = createProxyHandler(serviceConfig.baseUrl, prefix);

		const path = basePath
			? `${basePath}${registration.gatewayHttpPath}`
			: registration.gatewayHttpPath;

		registerHonoRoute(app, registration.method, path, (context) =>
			executeMiddlewareChain(context, middlewareChain, proxyHandler),
		);
	}

	return app;
}
