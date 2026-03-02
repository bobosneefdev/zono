import type { Context, Hono } from "hono";
import superjson from "superjson";
import type { ContractMethod } from "~/contract/contract.types.js";
import { isMiddlewareNode } from "~/internal/util.js";
import type { PossiblePromise } from "~/internal/util.types.js";

export type MiddlewareHandlerFn<TContextParams extends ReadonlyArray<unknown> = [Context]> = (
	ctx: Context,
	next: () => Promise<void>,
	...contextParams: TContextParams
) => PossiblePromise<void | Response | { type: string; status: number; data?: unknown }>;

export type MiddlewareEntry<TContextParams extends ReadonlyArray<unknown> = [Context]> = {
	handler: MiddlewareHandlerFn<TContextParams>;
};

/**
 * Builds an HTTP Response from a middleware return object { type, status, data? }.
 */
function buildResponseFromMiddlewareReturn(result: {
	type: string;
	status: number;
	data?: unknown;
}): Response {
	switch (result.type) {
		case "JSON":
			return new Response(JSON.stringify(result.data), {
				status: result.status,
				headers: { "content-type": "application/json" },
			});
		case "SuperJSON":
			return new Response(JSON.stringify(superjson.serialize(result.data)), {
				status: result.status,
				headers: { "content-type": "application/json" },
			});
		case "Text":
			return new Response(String(result.data), {
				status: result.status,
				headers: { "content-type": "text/plain" },
			});
		case "Blob":
			return new Response(result.data as Blob, { status: result.status });
		case "ArrayBuffer":
			return new Response(result.data as ArrayBuffer, { status: result.status });
		case "FormData":
			return new Response(result.data as FormData, { status: result.status });
		case "ReadableStream":
			return new Response(result.data as ReadableStream, { status: result.status });
		case "Void":
			return new Response(null, { status: result.status });
		default:
			throw new Error(`Unknown middleware response type: ${result.type}`);
	}
}

/**
 * Collects MiddlewareEntry objects from a single MIDDLEWARE node pair (def + handlers).
 * Shared by hono.ts and hono_gateway.ts to avoid duplication.
 */
export function collectMiddlewareEntriesFromNode(
	mwDefNode: unknown,
	mwHandlerNode: unknown,
): Array<MiddlewareEntry<ReadonlyArray<unknown>>> {
	const entries: Array<MiddlewareEntry<ReadonlyArray<unknown>>> = [];
	if (!isMiddlewareNode(mwDefNode) || !isMiddlewareNode(mwHandlerNode)) return entries;
	for (const name of Object.keys(mwDefNode.MIDDLEWARE)) {
		const handler = mwHandlerNode.MIDDLEWARE[name];
		if (handler == null || typeof handler !== "function") continue;
		entries.push({ handler: handler as MiddlewareEntry<ReadonlyArray<unknown>>["handler"] });
	}
	return entries;
}

export function normalizeBasePath(basePath: string | undefined): string {
	if (basePath == null || basePath === "") return "";
	const trimmed = basePath.trim().replace(/\/+$/, "");
	if (trimmed === "") return "";
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function executeMiddlewareChain<TContextParams extends ReadonlyArray<unknown>>(
	context: Context,
	middleware: Array<MiddlewareEntry<TContextParams>>,
	finalHandler: (context: Context, contextParams: TContextParams) => Promise<Response>,
	contextParams: TContextParams,
): Promise<Response> {
	const dispatch = async (index: number): Promise<void> => {
		if (index >= middleware.length) {
			const response = await finalHandler(context, contextParams);
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
		const typedResult = await entry.handler(
			context,
			async () => {
				await dispatch(index + 1);
			},
			...contextParams,
		);

		if (typedResult instanceof Response) {
			context.res = typedResult;
		} else if (typedResult != null && typeof typedResult === "object") {
			// MiddlewareReturn — build a Response from the typed return object
			context.res = buildResponseFromMiddlewareReturn(
				typedResult as { type: string; status: number; data?: unknown },
			);
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
