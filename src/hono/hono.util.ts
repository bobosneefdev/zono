import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Contract, ContractMethod, ContractResponses } from "~/contract/contract.types.js";
import type { ServerHandlerOutput } from "~/internal/handler.types.js";
import { buildContractResponse } from "~/internal/server.js";

export type MiddlewareEntry =
	| { type: "vanilla"; handler: MiddlewareHandler }
	| {
			type: "typed";
			handler: (
				ctx: Context,
				next: () => Promise<void>,
			) => Promise<void | { status: number; data?: unknown }>;
			responses: ContractResponses;
	  };

export function normalizeBasePath(basePath: string | undefined): string {
	if (basePath == null || basePath === "") return "";
	const trimmed = basePath.trim().replace(/\/+$/, "");
	if (trimmed === "") return "";
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isTypedMiddlewareReturn(value: unknown): value is { status: number; data?: unknown } {
	return (
		typeof value === "object" &&
		value !== null &&
		"status" in value &&
		typeof (value as { status: unknown }).status === "number"
	);
}

export async function executeMiddlewareChain(
	context: Context,
	middleware: Array<MiddlewareEntry>,
	finalHandler: (context: Context) => Promise<Response>,
): Promise<Response> {
	const dispatch = async (index: number): Promise<void> => {
		if (index >= middleware.length) {
			const response = await finalHandler(context);
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

		const entry = middleware[index];
		if (entry.type === "vanilla") {
			const middlewareResponse = await entry.handler(context, async () => {
				await dispatch(index + 1);
			});
			if (middlewareResponse instanceof Response) {
				context.res = middlewareResponse;
			}
			return;
		}

		const typedResult = await entry.handler(context, async () => {
			await dispatch(index + 1);
		});

		if (isTypedMiddlewareReturn(typedResult)) {
			const syntheticContract: Contract = { responses: entry.responses };
			const response = await buildContractResponse(
				syntheticContract,
				typedResult as ServerHandlerOutput<Contract>,
				false,
			);
			context.res = response;
		}
	};

	await dispatch(0);

	if (context.res instanceof Response) {
		return context.res;
	}

	throw new Error("Middleware chain completed without producing a response");
}

export function registerHonoRoute(
	app: Hono,
	method: ContractMethod,
	path: string,
	handler: (context: Context) => Promise<Response>,
): void {
	switch (method) {
		case "get":
			app.get(path, handler);
			return;
		case "post":
			app.post(path, handler);
			return;
		case "put":
			app.put(path, handler);
			return;
		case "delete":
			app.delete(path, handler);
			return;
		case "patch":
			app.patch(path, handler);
			return;
		case "options":
			app.options(path, handler);
			return;
		case "head":
			app.on("HEAD", path, handler);
			return;
		default:
			throw new Error(`Unsupported HTTP method: ${method}`);
	}
}
