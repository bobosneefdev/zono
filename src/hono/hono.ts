import type { Context, Hono } from "hono";
import type { ErrorMode } from "~/contract/contract.error.js";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type {
	AdditionalHandlerParamsFn,
	HonoContextParams,
	HonoMiddlewareHandlerTree,
	HonoOptions,
	HonoRouteHandlerTree,
} from "~/hono/hono.types.js";
import {
	executeMiddlewareChain,
	type MiddlewareEntry,
	normalizeBasePath,
	registerHonoRoute,
} from "~/hono/hono.util.js";
import { resolveRequestBody } from "~/internal/body.util.js";
import { parseContractFields } from "~/internal/parse.js";
import { createSafeContext } from "~/internal/safe_context.js";
import {
	buildInternalErrorResponse,
	buildNotFoundErrorResponse,
	buildValidationErrorResponse,
} from "~/internal/server.js";
import {
	dotPathToParamPath,
	getContractMethods,
	isContractNode,
	isMiddlewareNode,
	isRecord,
	isRouterNode,
} from "~/internal/util.js";
import { MiddlewareDefinition } from "~/middleware/index.js";

async function parseRequestBody(context: Context): Promise<unknown> {
	const contentType = context.req.header("content-type") ?? "";
	return resolveRequestBody(
		contentType,
		() => context.req.json(),
		() => context.req.formData(),
	);
}

type ResolvedHonoOptions = {
	basePath: string;
	errorMode: ErrorMode;
	additionalHandlerParams: AdditionalHandlerParamsFn<ReadonlyArray<unknown>>;
};

type RouteRegistration = {
	path: string;
	method: ContractMethod;
	contract: Contract;
	middleware: Array<MiddlewareEntry<ReadonlyArray<unknown>>>;
	handler: (
		context: Context,
		additionalParams: ReadonlyArray<unknown>,
		options: ResolvedHonoOptions,
	) => Promise<Response>;
};

function collectMiddlewareEntries(
	mwDefNode: unknown,
	mwHandlerNode: unknown,
): Array<MiddlewareEntry<ReadonlyArray<unknown>>> {
	const entries: Array<MiddlewareEntry<ReadonlyArray<unknown>>> = [];
	if (!isMiddlewareNode(mwDefNode) || !isMiddlewareNode(mwHandlerNode)) {
		return entries;
	}

	for (const name of Object.keys(mwDefNode.MIDDLEWARE)) {
		const handler = mwHandlerNode.MIDDLEWARE[name];
		if (handler === null || handler === undefined) continue;
		if (typeof handler !== "function") continue;
		entries.push({
			handler: handler as MiddlewareEntry<ReadonlyArray<unknown>>["handler"],
		});
	}

	return entries;
}

function collectRoutes(
	routes: Record<string, unknown>,
	handlers: Record<string, unknown>,
	mwDef: Record<string, unknown> | undefined,
	mwHandlers: Record<string, unknown> | undefined,
	dotPathPrefix: string,
	accumulatedMiddleware: Array<MiddlewareEntry<ReadonlyArray<unknown>>>,
): Array<RouteRegistration> {
	const registrations: Array<RouteRegistration> = [];

	let effectiveMiddleware = accumulatedMiddleware;
	if (mwDef && mwHandlers) {
		effectiveMiddleware = [
			...effectiveMiddleware,
			...collectMiddlewareEntries(mwDef, mwHandlers),
		];
	}

	const routerKeys = Object.keys(routes.ROUTER as Record<string, unknown>);
	const routesRouter = routes.ROUTER as Record<string, unknown>;
	const handlersRouter = (handlers.ROUTER ?? handlers) as Record<string, unknown>;

	for (const key of routerKeys) {
		const routeNode = routesRouter[key];
		const handlerNode = handlersRouter[key];

		if (!isRecord(routeNode) || !isRecord(handlerNode)) continue;

		const nodePath = dotPathPrefix ? `${dotPathPrefix}.${key}` : key;

		const childMwDef = isRouterNode(mwDef) ? mwDef.ROUTER[key] : undefined;
		const childMwHandlers = isRouterNode(mwHandlers) ? mwHandlers.ROUTER[key] : undefined;

		let nodeMiddleware = effectiveMiddleware;
		if (childMwDef && childMwHandlers) {
			nodeMiddleware = [
				...effectiveMiddleware,
				...collectMiddlewareEntries(childMwDef, childMwHandlers),
			];
		}

		if (isContractNode(routeNode) && "HANDLER" in handlerNode) {
			const path = dotPathToParamPath(nodePath);
			const contractMap = routeNode.CONTRACT as ContractMethodMap;
			const handlerMap = handlerNode.HANDLER as Record<string, unknown>;

			for (const method of getContractMethods(contractMap)) {
				const contract = contractMap[method];
				if (!contract) continue;

				const resolvedHandler = handlerMap[method];
				if (typeof resolvedHandler !== "function") {
					throw new Error(`Missing handler for ${method.toUpperCase()} ${path}`);
				}

				registrations.push({
					path,
					method,
					contract,
					middleware: nodeMiddleware,
					handler: async (
						context: Context,
						additionalParams: ReadonlyArray<unknown>,
						options: ResolvedHonoOptions,
					) => {
						const rawInput = {
							pathParams: context.req.param(),
							query: context.req.query(),
							headers: Object.fromEntries(context.req.raw.headers.entries()),
							body: contract.body ? await parseRequestBody(context) : undefined,
						};
						const parseResult = await parseContractFields(
							contract,
							rawInput,
							"transformed",
						);
						if (!parseResult.success) {
							return buildValidationErrorResponse(
								parseResult.issues,
								options.errorMode,
							);
						}
						const handlerFn = resolvedHandler as (
							input: unknown,
							ctx: Context,
							...params: ReadonlyArray<unknown>
						) => Promise<Response>;
						// Wrap context with safe methods for response validation
						const safeContext = createSafeContext(context, contract);
						const result = await handlerFn(
							parseResult.data,
							safeContext,
							...additionalParams,
						);
						return result;
					},
				});
			}
		}

		if (isRouterNode(routeNode)) {
			const childHandlers = isRecord(handlerNode.ROUTER) ? handlerNode.ROUTER : handlerNode;
			registrations.push(
				...collectRoutes(
					routeNode as Record<string, unknown>,
					{ ROUTER: childHandlers } as Record<string, unknown>,
					isRecord(childMwDef) ? (childMwDef as Record<string, unknown>) : undefined,
					isRecord(childMwHandlers)
						? (childMwHandlers as Record<string, unknown>)
						: undefined,
					nodePath,
					nodeMiddleware,
				),
			);
		}
	}

	return registrations;
}

/**
 * Creates type-safe route handlers for use with createHono.
 * Validates that handlers match the route definition structure.
 * @param _routes - Route definition (used for type inference only)
 * @param _options - Hono options (used for type inference only)
 * @param handlers - The route handler implementations
 * @returns The handlers with type validation
 */
export function createHonoRouteHandlers<TRoutes, TContextParams extends HonoContextParams = []>(
	_routes: TRoutes,
	_options: HonoOptions<TContextParams>,
	handlers: HonoRouteHandlerTree<TRoutes, TContextParams>,
): HonoRouteHandlerTree<TRoutes, TContextParams> {
	return handlers;
}

/**
 * Creates type-safe middleware handlers for use with createHono.
 * Validates that handlers match the middleware definition structure.
 * @param _middleware - Middleware definition (used for type inference only)
 * @param _options - Hono options (used for type inference only)
 * @param handlers - The middleware handler implementations
 * @returns The handlers with type validation
 */
export function createHonoMiddlewareHandlers<
	TMiddleware,
	TContextParams extends HonoContextParams = [],
>(
	_middleware: TMiddleware,
	_options: HonoOptions<TContextParams>,
	handlers: HonoMiddlewareHandlerTree<TMiddleware, TContextParams>,
): HonoMiddlewareHandlerTree<TMiddleware, TContextParams> {
	return handlers;
}

/**
 * Creates Hono options with proper type inference for context parameters.
 * @param options - Configuration options for the Hono server
 * @returns The options with type validation
 */
export function createHonoOptions<TContextParams extends HonoContextParams = []>(
	options: HonoOptions<TContextParams>,
): HonoOptions<TContextParams> {
	return options;
}

/**
 * Creates a type-safe Hono server from route and middleware definitions.
 * Registers all routes with their handlers and middleware.
 * @param app - Hono app instance
 * @param routes - Route definition from createRoutes()
 * @param routeHandlers - Route handlers from createHonoRouteHandlers()
 * @param middleware - Optional middleware definition
 * @param middlewareHandlers - Optional middleware handlers
 * @param options - Optional server configuration
 * @returns The configured Hono app
 */
export function createHono<
	TRoutes,
	TMiddleware extends MiddlewareDefinition<TRoutes> = MiddlewareDefinition<TRoutes>,
	TContextParams extends HonoContextParams = [],
>(
	app: Hono,
	routes: TRoutes,
	routeHandlers: HonoRouteHandlerTree<TRoutes, TContextParams>,
	middleware?: TMiddleware,
	middlewareHandlers?: HonoMiddlewareHandlerTree<TMiddleware, TContextParams>,
	options?: HonoOptions<TContextParams>,
): Hono {
	const resolvedOptions: ResolvedHonoOptions = {
		basePath: normalizeBasePath(options?.basePath),
		errorMode: options?.errorMode ?? "hidden",
		additionalHandlerParams: options?.additionalHandlerParams ?? (() => [] as const),
	};

	app.notFound(() => buildNotFoundErrorResponse());
	app.onError(() => buildInternalErrorResponse());

	const registrations = collectRoutes(
		routes as Record<string, unknown>,
		routeHandlers as Record<string, unknown>,
		middleware as Record<string, unknown> | undefined,
		middlewareHandlers as Record<string, unknown> | undefined,
		"",
		[],
	);

	for (const registration of registrations) {
		const path = resolvedOptions.basePath
			? `${resolvedOptions.basePath}${registration.path}`
			: registration.path;

		registerHonoRoute(app, registration.method, path, async (context) => {
			const additionalParams = await Promise.resolve(
				resolvedOptions.additionalHandlerParams(context),
			);

			return executeMiddlewareChain(
				context,
				registration.middleware,
				(ctx, resolvedContextParams) =>
					registration.handler(ctx, resolvedContextParams, resolvedOptions),
				additionalParams,
			);
		});
	}

	return app;
}
