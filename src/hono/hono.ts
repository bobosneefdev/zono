import type { Context, Hono } from "hono";
import type { ErrorMode } from "~/contract/contract.error.js";
import { parseContractFields } from "~/contract/contract.parse.js";
import type {
	Contract,
	ContractMethod,
	ContractMethodMap,
	ContractResponses,
} from "~/contract/contract.types.js";
import type { HonoHandlers, HonoOptions } from "~/hono/hono.types.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import { resolveRequestBody } from "~/internal/request_body.util.js";
import { buildContractResponse, buildValidationErrorResponse } from "~/internal/server.js";
import { getContractMethods, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";
import { routerDotPathToParamPath } from "~/router/router.resolve.js";
import type { MiddlewareContractMap } from "~/router/router.types.js";
import {
	executeMiddlewareChain,
	type MiddlewareEntry,
	normalizeBasePath,
	registerHonoRoute,
} from "./hono.util.js";

async function parseRequestBody(context: Context): Promise<unknown> {
	const contentType = context.req.header("content-type") ?? "";
	return resolveRequestBody(
		contentType,
		() => context.req.json(),
		() => context.req.formData(),
	);
}

async function parseRequestInput(
	contract: Contract,
	context: Context,
	bypassIncomingParse: boolean,
) {
	return await parseContractFields(
		contract,
		{
			pathParams: context.req.param(),
			query: context.req.query(),
			headers: Object.fromEntries(context.req.raw.headers.entries()),
			payload: contract.payload ? await parseRequestBody(context) : undefined,
		},
		bypassIncomingParse,
	);
}

async function buildResponse<TContract extends Contract>(
	contract: TContract,
	result: ServerHandlerOutput<TContract>,
	defaultBypassOutgoingParse: boolean,
): Promise<Response> {
	return await buildContractResponse(contract, result, defaultBypassOutgoingParse);
}

type ResolvedHonoOptions = Required<Omit<HonoOptions<Array<unknown>>, "basePath" | "errorMode">> & {
	basePath: string;
	errorMode: ErrorMode;
};

type RouteRegistration = {
	path: string;
	method: ContractMethod;
	contract: Contract;
	middleware: Array<MiddlewareEntry>;
	handler: (context: Context, options: ResolvedHonoOptions) => Promise<Response>;
};

function collectMiddlewareEntries(
	routerNode: Record<string, unknown>,
	handlerNode: Record<string, unknown>,
	path: string,
): Array<MiddlewareEntry> {
	const entries: Array<MiddlewareEntry> = [];
	const middleware = handlerNode.MIDDLEWARE;
	const routerMiddleware = routerNode.MIDDLEWARE as MiddlewareContractMap | undefined;

	if (middleware === undefined || routerMiddleware === undefined) {
		return entries;
	}

	if (!isRecord(middleware)) {
		throw new Error(`Middleware must be a record of typed handlers: ${path}`);
	}

	for (const [name, handler] of Object.entries(middleware)) {
		if (handler === null) continue;
		const responses = routerMiddleware[name];
		if (!isRecord(responses) || typeof handler !== "function") continue;
		entries.push({
			type: "typed",
			handler: handler as (
				ctx: Context,
				next: () => Promise<void>,
			) => Promise<void | { status: number; data?: unknown }>,
			responses: responses as ContractResponses,
		});
	}

	return entries;
}

function collectRoutes(
	router: Record<string, unknown>,
	handlers: Record<string, unknown>,
	dotPathPrefix = "",
	accumulatedMiddleware: Array<MiddlewareEntry> = [],
): Array<RouteRegistration> {
	const registrations: Array<RouteRegistration> = [];

	let effectiveMiddleware = accumulatedMiddleware;
	// Collect root-level MIDDLEWARE before iterating route keys
	if (dotPathPrefix === "" && router.MIDDLEWARE && handlers.MIDDLEWARE) {
		effectiveMiddleware = [
			...effectiveMiddleware,
			...collectMiddlewareEntries(
				router as Record<string, unknown>,
				{ MIDDLEWARE: handlers.MIDDLEWARE } as Record<string, unknown>,
				"/",
			),
		];
	}

	for (const [key, value] of Object.entries(router)) {
		if (key === "MIDDLEWARE") continue;

		const nodePath = dotPathPrefix.length > 0 ? `${dotPathPrefix}.${key}` : key;
		const handlerNode = handlers[key];

		if (!isRecord(value) || !isRecord(handlerNode)) {
			continue;
		}

		const pathForMw = routerDotPathToParamPath(nodePath);
		const levelMiddleware = collectMiddlewareEntries(value, handlerNode, pathForMw);
		const currentPathMiddleware = [...effectiveMiddleware, ...levelMiddleware];

		if (isContractNode(value) && "HANDLER" in handlerNode) {
			const path = pathForMw;
			const contractMap = value.CONTRACT as ContractMethodMap;
			const handlerMap = handlerNode.HANDLER;

			if (!isRecord(handlerMap)) {
				throw new Error(`Missing handler map for path ${path}`);
			}

			for (const method of getContractMethods(contractMap)) {
				const contract = contractMap[method];
				if (!contract) continue;

				const resolvedHandler = handlerMap[method];
				if (typeof resolvedHandler !== "function") {
					throw new Error(`Missing handler function for ${method.toUpperCase()} ${path}`);
				}

				registrations.push({
					path,
					method,
					contract,
					middleware: currentPathMiddleware,
					handler: async (context: Context, options: ResolvedHonoOptions) => {
						const parseResult = await parseRequestInput(
							contract,
							context,
							options.bypassIncomingParse,
						);
						if (!parseResult.success) {
							return buildValidationErrorResponse(
								parseResult.issues,
								options.errorMode,
							);
						}
						const handlerParams = options.transformParams(context);
						const result = await resolvedHandler(parseResult.data, ...handlerParams);
						return await buildResponse(
							contract,
							result as ServerHandlerOutput<Contract>,
							options.bypassOutgoingParse,
						);
					},
				});
			}
		}

		const routerChild = isContractNode(value)
			? isRouterNode(value)
				? value.ROUTER
				: undefined
			: value;

		const handlerChild =
			"HANDLER" in handlerNode
				? isRouterNode(handlerNode)
					? handlerNode.ROUTER
					: undefined
				: handlerNode;

		if (routerChild && handlerChild) {
			registrations.push(
				...collectRoutes(
					routerChild as Record<string, unknown>,
					handlerChild as Record<string, unknown>,
					nodePath,
					currentPathMiddleware,
				),
			);
		}
	}

	return registrations;
}

function registerRoute(
	app: Hono,
	registration: RouteRegistration,
	options: ResolvedHonoOptions,
): void {
	const path = options.basePath ? `${options.basePath}${registration.path}` : registration.path;

	registerHonoRoute(app, registration.method, path, (context) =>
		executeMiddlewareChain(context, registration.middleware, (ctx) =>
			registration.handler(ctx, options),
		),
	);
}

export function initHono<TRouter, TParams extends Array<unknown> = [Context]>(
	app: Hono,
	router: TRouter,
	handlers: HonoHandlers<TRouter, TParams>,
	options?: HonoOptions<TParams>,
): Hono {
	const resolvedOptions: ResolvedHonoOptions = {
		basePath: normalizeBasePath(options?.basePath),
		bypassIncomingParse: options?.bypassIncomingParse ?? false,
		bypassOutgoingParse: options?.bypassOutgoingParse ?? false,
		errorMode: options?.errorMode ?? "hidden",
		transformParams: options?.transformParams ?? ((...args) => args),
	};

	const registrations = collectRoutes(
		router as Record<string, unknown>,
		handlers as Record<string, unknown>,
	);

	for (const registration of registrations) {
		registerRoute(app, registration, resolvedOptions);
	}

	return app;
}
