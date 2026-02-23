import type { Context, Hono } from "hono";
import type { Contract, ContractMethod, ContractMethodMap } from "~/contract/types.js";
import type {
	InitHonoOptions,
	ServerHandlerInput,
	ServerHandlerOutput,
	ServerHandlerTree,
} from "~/hono/types.js";
import { dotPathToParamPath } from "~/internal/router_runtime.js";
import { buildContractResponse, parseContractInput } from "~/internal/server_runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function parseRequestInput<TContract extends Contract>(
	contract: TContract,
	context: Context,
	bypassIncomingParse: boolean,
): Promise<ServerHandlerInput<TContract>> {
	return await parseContractInput(
		contract,
		{
			pathParams: context.req.param(),
			query: context.req.query(),
			headers: Object.fromEntries(context.req.raw.headers.entries()),
			body: contract.body ? await context.req.json() : undefined,
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

type RouteRegistration = {
	path: string;
	method: ContractMethod;
	contract: Contract;
	handler: (
		context: Context,
		options: Required<InitHonoOptions<Array<unknown>>>,
	) => Promise<Response>;
};

const contractMethodOrder: Array<ContractMethod> = [
	"get",
	"post",
	"put",
	"delete",
	"patch",
	"options",
	"head",
];

function getContractMethods(contractMap: ContractMethodMap): Array<ContractMethod> {
	const methods: Array<ContractMethod> = [];
	for (const method of contractMethodOrder) {
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

		if ("contract" in value && isRecord(value.contract) && "handler" in handlerNode) {
			const path = dotPathToParamPath(nodePath);
			const contractMap = value.contract as ContractMethodMap;
			const handlerMap = handlerNode.handler;

			if (!isRecord(handlerMap)) {
				throw new Error(`Missing handler map for route: ${path}`);
			}

			for (const method of getContractMethods(contractMap)) {
				const contract = contractMap[method];
				if (!contract) {
					continue;
				}

				const resolvedHandler = handlerMap[method];
				if (typeof resolvedHandler !== "function") {
					throw new Error(`Missing handler function for ${method.toUpperCase()} ${path}`);
				}

				registrations.push({
					path,
					method,
					contract,
					handler: async (
						context: Context,
						options: Required<InitHonoOptions<Array<unknown>>>,
					) => {
						const input = await parseRequestInput(
							contract,
							context,
							options.bypassIncomingParse,
						);
						const handlerParams = options.getHandlerParams(context);
						const result = await resolvedHandler(input, ...handlerParams);
						return await buildResponse(
							contract,
							result as ServerHandlerOutput<Contract>,
							options.bypassOutgoingParse,
						);
					},
				});
			}
		}

		const routerChild =
			"contract" in value
				? "router" in value && isRecord(value.router)
					? value.router
					: undefined
				: value;

		const handlerChild =
			"handler" in handlerNode
				? "router" in handlerNode && isRecord(handlerNode.router)
					? handlerNode.router
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
	options: Required<InitHonoOptions<Array<unknown>>>,
): void {
	const routeHandler = (context: Context): Promise<Response> =>
		registration.handler(context, options);

	switch (registration.method) {
		case "get":
			app.get(registration.path, routeHandler);
			return;
		case "post":
			app.post(registration.path, routeHandler);
			return;
		case "put":
			app.put(registration.path, routeHandler);
			return;
		case "delete":
			app.delete(registration.path, routeHandler);
			return;
		case "patch":
			app.patch(registration.path, routeHandler);
			return;
		case "options":
			app.options(registration.path, routeHandler);
			return;
		case "head":
			app.on("HEAD", registration.path, routeHandler);
			return;
		default:
			throw new Error(`Unsupported HTTP method: ${registration.method}`);
	}
}

export function initHono<TRouter, TParams extends Array<unknown> = [Context]>(
	app: Hono,
	router: TRouter,
	handlers: ServerHandlerTree<TRouter, TParams>,
	options?: InitHonoOptions<TParams>,
): Hono {
	const resolvedOptions: Required<InitHonoOptions<Array<unknown>>> = {
		bypassIncomingParse: options?.bypassIncomingParse ?? false,
		bypassOutgoingParse: options?.bypassOutgoingParse ?? false,
		getHandlerParams: (context) =>
			options?.getHandlerParams
				? (options.getHandlerParams(context) as Array<unknown>)
				: [context],
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

export * from "~/hono/types.js";
