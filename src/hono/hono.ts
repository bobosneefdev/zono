import type { Context, Hono } from "hono";
import superjson from "superjson";
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
	collectMiddlewareEntriesFromNode,
	executeMiddlewareChain,
	type MiddlewareEntry,
	normalizeBasePath,
	registerHonoRoute,
} from "~/hono/hono.util.js";
import { resolveRequestBody } from "~/internal/body.util.js";
import { parseContractFields } from "~/internal/parse.js";
import {
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
import type { MiddlewaresDefinition } from "~/middleware/index.js";

/**
 * Builds an HTTP Response from a handler output object { type, status, data?, headers? }.
 * Response headers from the contract definition are applied when present.
 */
function buildResponseFromOutput(
	output: { type: string; status: number; data?: unknown; headers?: unknown },
	contract: Contract,
): Response {
	const responseHeaders: Record<string, string> = {};

	if (output.headers) {
		const responseDef = contract.responses[output.status];
		if (responseDef?.headers) {
			if (responseDef.headers.type === "SuperJSON") {
				responseHeaders["x-zono-superjson-headers"] = superjson.stringify(output.headers);
			} else {
				for (const [k, v] of Object.entries(output.headers as Record<string, string>)) {
					if (typeof v === "string") responseHeaders[k] = v;
				}
			}
		}
	}

	switch (output.type) {
		case "JSON":
			return new Response(JSON.stringify(output.data), {
				status: output.status,
				headers: { "content-type": "application/json", ...responseHeaders },
			});
		case "SuperJSON":
			return new Response(JSON.stringify(superjson.serialize(output.data)), {
				status: output.status,
				headers: { "content-type": "application/json", ...responseHeaders },
			});
		case "Text":
			return new Response(String(output.data), {
				status: output.status,
				headers: { "content-type": "text/plain", ...responseHeaders },
			});
		case "Blob":
			return new Response(output.data as Blob, {
				status: output.status,
				headers: responseHeaders,
			});
		case "ArrayBuffer":
			return new Response(output.data as ArrayBuffer, {
				status: output.status,
				headers: responseHeaders,
			});
		case "FormData":
			return new Response(output.data as FormData, {
				status: output.status,
				headers: responseHeaders,
			});
		case "ReadableStream":
			return new Response(output.data as ReadableStream, {
				status: output.status,
				headers: responseHeaders,
			});
		case "Void":
			return new Response(null, {
				status: output.status,
				headers: responseHeaders,
			});
		default:
			throw new Error(`Unknown response type: ${output.type}`);
	}
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
			...collectMiddlewareEntriesFromNode(mwDef, mwHandlers),
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
				...collectMiddlewareEntriesFromNode(childMwDef, childMwHandlers),
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
						const rawBody = contract.body
							? await resolveRequestBody(contract.body, context.req.raw)
							: undefined;

						const rawInput = {
							pathParams: context.req.param(),
							query: context.req.query(),
							headers: Object.fromEntries(context.req.raw.headers.entries()),
							body: rawBody,
						};
						const parseResult = await parseContractFields(contract, rawInput, "server");
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
						) => Promise<{
							type: string;
							status: number;
							data?: unknown;
							headers?: unknown;
						}>;
						const result = await handlerFn(
							parseResult.data,
							context,
							...additionalParams,
						);
						return buildResponseFromOutput(result, contract);
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
 */
export function createHonoRouteHandlers<TContracts, TContextParams extends HonoContextParams = []>(
	_contracts: TContracts,
	_options: HonoOptions<TContextParams>,
	handlers: HonoRouteHandlerTree<TContracts, TContextParams>,
): HonoRouteHandlerTree<TContracts, TContextParams> {
	return handlers;
}

/**
 * Creates type-safe middleware handlers for use with createHono.
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
 */
export function createHonoOptions<TContextParams extends HonoContextParams = []>(
	options: HonoOptions<TContextParams>,
): HonoOptions<TContextParams> {
	return options;
}

/**
 * Initializes a Hono server from contract and middlewares definitions.
 * @param app - Hono app instance
 * @param contracts - Contract definition from createContracts()
 * @param routeHandlers - Route handlers from createHonoRouteHandlers()
 * @param middleware - Optional middlewares definition
 * @param middlewareHandlers - Optional middleware handlers
 * @param options - Optional server configuration
 * @returns The configured Hono app
 */
export function initHono<
	TContracts,
	TMiddleware extends MiddlewaresDefinition<TContracts> = MiddlewaresDefinition<TContracts>,
	TContextParams extends HonoContextParams = [],
>(
	app: Hono,
	contracts: TContracts,
	routeHandlers: HonoRouteHandlerTree<TContracts, TContextParams>,
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
		contracts as Record<string, unknown>,
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
