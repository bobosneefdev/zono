import type { Context, Hono } from "hono";
import type { ContractMethod } from "~/contract/contract.types.js";
import type { PossiblePromise } from "~/internal/util.types.js";

export type MiddlewareHandlerFn<TContextParams extends ReadonlyArray<unknown> = [Context]> = (
	ctx: Context,
	next: () => Promise<void>,
	...contextParams: TContextParams
) => PossiblePromise<void | Response>;

export type MiddlewareEntry<TContextParams extends ReadonlyArray<unknown> = [Context]> = {
	handler: MiddlewareHandlerFn<TContextParams>;
};

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
