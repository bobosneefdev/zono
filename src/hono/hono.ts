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
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import { parseContractFields } from "~/internal/parse.js";
import { resolveRequestBody } from "~/internal/request_body.util.js";
import {
	buildContractResponse,
	buildInternalErrorResponse,
	buildNotFoundErrorResponse,
	buildValidationErrorResponse,
} from "~/internal/server.js";
import {
	dotPathToParamPath,
	getContractMethods,
	isContractNode,
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
	mwDefNode: Record<string, unknown>,
	mwHandlerNode: Record<string, unknown>,
): Array<MiddlewareEntry<ReadonlyArray<unknown>>> {
	const entries: Array<MiddlewareEntry<ReadonlyArray<unknown>>> = [];
	const mwDef = mwDefNode.MIDDLEWARE as Record<string, unknown> | undefined;
	const mwHandlers = mwHandlerNode.MIDDLEWARE as Record<string, unknown> | undefined;

	if (!mwDef || !mwHandlers) return entries;

	for (const name of Object.keys(mwDef)) {
		const handler = mwHandlers[name];
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

		const childMwDef = mwDef?.ROUTER
			? (mwDef.ROUTER as Record<string, unknown>)[key]
			: undefined;
		const childMwHandlers = mwHandlers?.ROUTER
			? (mwHandlers.ROUTER as Record<string, unknown>)[key]
			: undefined;

		let nodeMiddleware = effectiveMiddleware;
		if (isRecord(childMwDef) && isRecord(childMwHandlers)) {
			nodeMiddleware = [
				...effectiveMiddleware,
				...collectMiddlewareEntries(
					childMwDef as Record<string, unknown>,
					childMwHandlers as Record<string, unknown>,
				),
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
						) => Promise<unknown>;
						const result = await handlerFn(
							parseResult.data,
							context,
							...additionalParams,
						);
						return buildContractResponse(
							contract as Contract,
							result as ServerHandlerOutput<Contract>,
						);
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

export function createHonoRouteHandlers<TRoutes, TContextParams extends HonoContextParams = []>(
	_routes: TRoutes,
	_options: HonoOptions<TContextParams>,
	handlers: HonoRouteHandlerTree<TRoutes, TContextParams>,
): HonoRouteHandlerTree<TRoutes, TContextParams> {
	return handlers;
}

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

export function createHonoOptions<TContextParams extends HonoContextParams = []>(
	options: HonoOptions<TContextParams>,
): HonoOptions<TContextParams> {
	return options;
}

export function initHono<
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
