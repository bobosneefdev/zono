import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/contract.types.js";
import type { HonoHandlers, HonoOptions } from "~/hono/hono.types.js";
import {
	buildContractResponse,
	buildValidationErrorResponse,
	parseContractInput,
} from "~/internal/server.js";
import type { ErrorMode, ServerHandlerOutput } from "~/internal/server.types.js";
import { CONTRACT_METHOD_ORDER, isContractNode, isRecord, isRouterNode } from "~/internal/util.js";
import { routerDotPathToParamPath } from "~/router/router.resolve.js";

function normalizeBasePath(basePath: string | undefined): string {
	if (basePath == null || basePath === "") return "";
	const trimmed = basePath.trim().replace(/\/+$/, "");
	if (trimmed === "") return "";
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function parseRequestBody(context: Context): Promise<unknown> {
	const contentType = context.req.header("content-type") ?? "";
	if (contentType.toLowerCase().includes("application/json")) {
		return await context.req.json();
	}

	return await context.req.formData();
}

async function parseRequestInput(
	contract: Contract,
	context: Context,
	bypassIncomingParse: boolean,
) {
	return await parseContractInput(
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

type ResolvedHonoOptions = Required<Omit<HonoOptions<Array<unknown>>, "basePath">> & {
	basePath: string;
	errorMode: ErrorMode;
};

type RouteRegistration = {
	path: string;
	method: ContractMethod;
	contract: Contract;
	middleware: Array<MiddlewareHandler>;
	handler: (context: Context, options: ResolvedHonoOptions) => Promise<Response>;
};

function getContractMethods(contractMap: ContractMethodMap): Array<ContractMethod> {
	const methods: Array<ContractMethod> = [];
	for (const method of CONTRACT_METHOD_ORDER) {
		if (contractMap[method]) {
			methods.push(method);
		}
	}

	return methods;
}

function collectRoutes(
	router: Record<string, unknown>,
	handlers: Record<string, unknown>,
	dotPathPrefix = "",
): Array<RouteRegistration> {
	const registrations: Array<RouteRegistration> = [];

	for (const [key, value] of Object.entries(router)) {
		const nodePath = dotPathPrefix.length > 0 ? `${dotPathPrefix}.${key}` : key;
		const handlerNode = handlers[key];

		if (!isRecord(value) || !isRecord(handlerNode)) {
			continue;
		}

		if (isContractNode(value) && "HANDLER" in handlerNode) {
			const path = routerDotPathToParamPath(nodePath);
			const contractMap = value.CONTRACT as ContractMethodMap;
			const handlerMap = handlerNode.HANDLER;
			const middleware = handlerNode.MIDDLEWARE;

			if (!isRecord(handlerMap)) {
				throw new Error(`Missing handler map for path ${path}`);
			}

			if (middleware !== undefined && !Array.isArray(middleware)) {
				throw new Error(`Middleware for route must be an array: ${path}`);
			}

			const validatedMiddleware: Array<MiddlewareHandler> = Array.isArray(middleware)
				? middleware
				: [];

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
					middleware: validatedMiddleware,
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
			registrations.push(...collectRoutes(routerChild, handlerChild, nodePath));
		}
	}

	return registrations;
}

function registerRoute(
	app: Hono,
	registration: RouteRegistration,
	options: ResolvedHonoOptions,
): void {
	const middlewareChain = [...options.globalMiddleware, ...registration.middleware];
	const routeHandler = async (context: Context): Promise<Response> => {
		const dispatch = async (index: number): Promise<void> => {
			if (index >= middlewareChain.length) {
				const response = await registration.handler(context, options);
				const mergedHeaders = new Headers(context.res.headers);
				for (const [key, value] of response.headers.entries()) {
					mergedHeaders.set(key, value);
				}

				context.res = new Response(response.body, {
					status: response.status,
					headers: mergedHeaders,
				});
				return;
			}

			const middleware = middlewareChain[index];
			const middlewareResponse = await middleware(context, async () => {
				await dispatch(index + 1);
			});

			if (middlewareResponse instanceof Response) {
				context.res = middlewareResponse;
			}
		};

		await dispatch(0);

		if (context.res instanceof Response) {
			return context.res;
		}

		throw new Error("Middleware chain completed without producing a response");
	};

	const path = options.basePath ? `${options.basePath}${registration.path}` : registration.path;

	switch (registration.method) {
		case "get":
			app.get(path, routeHandler);
			return;
		case "post":
			app.post(path, routeHandler);
			return;
		case "put":
			app.put(path, routeHandler);
			return;
		case "delete":
			app.delete(path, routeHandler);
			return;
		case "patch":
			app.patch(path, routeHandler);
			return;
		case "options":
			app.options(path, routeHandler);
			return;
		case "head":
			app.on("HEAD", path, routeHandler);
			return;
		default:
			throw new Error(`Unsupported HTTP method: ${registration.method}`);
	}
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
		globalMiddleware: options?.globalMiddleware ?? [],
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
