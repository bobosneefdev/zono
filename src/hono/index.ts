import type { Context, Hono } from "hono";
import type { Contract } from "~/contract/types.js";
import type {
	InitHonoOptions,
	ServerHandlerInput,
	ServerHandlerOutput,
	ServerHandlerTree,
} from "~/hono/types.js";

function dotPathToHonoPath(dotPath: string): string {
	if (!dotPath) {
		return "/";
	}

	const segments = dotPath.split(".").filter(Boolean);
	const mapped = segments.map((segment) => {
		if (segment.startsWith("$")) {
			return `:${segment.slice(1)}`;
		}

		return segment;
	});

	return `/${mapped.join("/")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function parseRequestInput<TContract extends Contract>(
	contract: TContract,
	context: Context,
	bypassIncomingParse: boolean,
): Promise<ServerHandlerInput<TContract>> {
	const parsed: Record<string, unknown> = {};

	if (contract.pathParams) {
		const rawPathParams = context.req.param();
		parsed.pathParams = bypassIncomingParse
			? rawPathParams
			: await contract.pathParams.parseAsync(rawPathParams);
	}

	if (contract.query) {
		const rawQuery = context.req.query();
		parsed.query = bypassIncomingParse ? rawQuery : await contract.query.parseAsync(rawQuery);
	}

	if (contract.headers) {
		const rawHeaders = Object.fromEntries(context.req.raw.headers.entries());
		parsed.headers = bypassIncomingParse
			? rawHeaders
			: await contract.headers.parseAsync(rawHeaders);
	}

	if (contract.body) {
		const rawBody = await context.req.json();
		parsed.body = bypassIncomingParse ? rawBody : await contract.body.parseAsync(rawBody);
	}

	return parsed as ServerHandlerInput<TContract>;
}

async function buildResponse<TContract extends Contract>(
	contract: TContract,
	result: ServerHandlerOutput<TContract>,
): Promise<Response> {
	const statusDefinition = contract.responses[result.status];
	if (!statusDefinition) {
		throw new Error(`Unexpected response status: ${result.status}`);
	}

	const bypassOutgoingParse = result.opts?.bypassOutgoingParse ?? false;

	let responseBody: unknown;
	if (statusDefinition.body) {
		const rawData = "data" in result ? result.data : undefined;
		responseBody = bypassOutgoingParse
			? rawData
			: await statusDefinition.body.parseAsync(rawData);
	}

	let responseHeaders: HeadersInit | undefined;
	if (statusDefinition.headers) {
		const rawHeaders = "headers" in result ? result.headers : undefined;
		const parsedHeaders = bypassOutgoingParse
			? rawHeaders
			: await statusDefinition.headers.parseAsync(rawHeaders);
		responseHeaders = isRecord(parsedHeaders)
			? (Object.entries(parsedHeaders).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				) as HeadersInit)
			: undefined;
	}

	if (responseBody === undefined) {
		return new Response(null, {
			status: result.status,
			headers: responseHeaders,
		});
	}

	return Response.json(responseBody, {
		status: result.status,
		headers: responseHeaders,
	});
}

type RouteRegistration = {
	path: string;
	contract: Contract;
	handler: (
		context: Context,
		options: Required<InitHonoOptions<Array<unknown>>>,
	) => Promise<Response>;
};

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
			const contract = value.contract as Contract;
			const resolvedHandler = handlerNode.handler;
			if (typeof resolvedHandler !== "function") {
				throw new Error(
					`Missing handler function for route: ${dotPathToHonoPath(nodePath)}`,
				);
			}

			registrations.push({
				path: dotPathToHonoPath(nodePath),
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
					return await buildResponse(contract, result as ServerHandlerOutput<Contract>);
				},
			});
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

	switch (registration.contract.method) {
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
			throw new Error(`Unsupported HTTP method: ${registration.contract.method}`);
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
