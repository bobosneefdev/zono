import { Context, Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import z from "zod";
import { ZonoContractAny, ZonoRouter } from "~/contract/types.js";
import { ZonoRouterImplementation } from "~/shared.js";

export function initHono<T extends ZonoRouter>(
	app: Hono,
	router: T,
	implementation: ZonoRouterImplementation<T, [Context]>,
) {
	applyZonoHandler(app, router, implementation);
}

function applyZonoHandler<
	TRouter extends ZonoRouter,
	TImplementation extends ZonoRouterImplementation<TRouter, [Context]>,
>(app: Hono, router: TRouter, implementations: TImplementation, prefix = "") {
	for (const key in router) {
		const implementation = implementations[key];
		const routerItem = router[key];
		const basePath = `${prefix}/${key}`;

		// Base case
		if (typeof implementation === "function") {
			const contract = routerItem as ZonoContractAny;

			const fullPath = `${basePath}${contract.path}`.replace(/\/+/g, "/");
			const method = contract.method.toUpperCase();
			app.on(method, fullPath, async (c) => {
				let pathParams: any;
				let query: any;
				let body: any;
				let headers: any;

				try {
					if (contract.pathParams) {
						pathParams = contract.pathParams.parse(c.req.param());
					}

					if (contract.query) {
						query = contract.query.parse(c.req.query());
					}

					if (contract.headers) {
						headers = contract.headers.parse(c.req.header());
					}

					if (contract.body) {
						// Try parsing JSON first, fallback to text/form data as needed, or let Hono handle based on content-type
						const contentType = c.req.header("content-type") || "";
						if (contentType.includes("application/json")) {
							body = contract.body.parse(await c.req.json());
						} else if (
							contentType.includes("multipart/form-data") ||
							contentType.includes("application/x-www-form-urlencoded")
						) {
							body = contract.body.parse(await c.req.parseBody());
						} else {
							body = contract.body.parse(await c.req.text());
						}
					}

					const response = await implementation({ pathParams, query, body, headers }, c);
					const status = response.status as keyof typeof contract.responses;

					const responseSpec = contract.responses[status];
					if (!responseSpec) {
						return c.json({ error: `Invalid response status: ${String(status)}` }, 500);
					}

					let resBody: any = response.data;
					if (responseSpec.body) {
						resBody = responseSpec.body.parse(resBody);
					}

					if (response.headers) {
						let resHeaders: Partial<Record<string, string>> = response.headers;
						if (responseSpec.headers) {
							resHeaders = responseSpec.headers.parse(resHeaders);
						}
						for (const [k, v] of Object.entries(resHeaders)) {
							c.header(k, String(v));
						}
					}

					if (resBody !== null && typeof resBody === "object") {
						return c.json(resBody, status as ContentfulStatusCode);
					}
					if (resBody !== undefined) {
						return c.text(String(resBody), status as ContentfulStatusCode);
					}

					return c.body(null, status);
				} catch (err: any) {
					if (err instanceof z.ZodError) {
						return c.json({ error: err.issues }, 400);
					}
					console.error("Zono Server Handler Error:", err);
					return c.body(null, 500);
				}
			});
		} else {
			// Recursive case
			const router = routerItem as ZonoRouter;
			applyZonoHandler(app, router, implementation, basePath);
		}
	}
}
