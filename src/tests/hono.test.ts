import { expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import { createZonoClient } from "~/client.js";
import { ZonoContractMethod } from "~/contract/enums.js";
import { createZonoContract, createZonoRouter } from "~/contract/factory.js";
import { applyZonoRouterToHono } from "~/hono.js";

// ---------------------------------------------------------------------------
// Context passing
// ---------------------------------------------------------------------------

test("basic usage", async () => {
	const router = createZonoRouter({
		posts: createZonoContract("/:userId/:postId", {
			method: ZonoContractMethod.GET,
			responses: {
				200: {
					body: z.object({
						likes: z.number().int(),
						shares: z.number().int(),
						views: z.number().int(),
					}),
				},
			},
			pathParams: z.object({
				userId: z.string(),
				postId: z.string(),
			}),
		}),
	});

	const app = new Hono();

	applyZonoRouterToHono(app, router, {
		async posts() {
			return {
				status: 200,
				data: {
					likes: 121,
					shares: 11,
					views: 1725,
				},
			};
		},
	});

	Bun.serve({
		port: 6969,
		fetch: app.fetch,
	});

	const client = createZonoClient(router, {
		baseUrl: "http://localhost:6969",
	});

	const resp = await client.posts({
		pathParams: {
			postId: crypto.randomUUID(),
			userId: crypto.randomUUID(),
		},
	});

	expect(resp.status).toBe(200);
	expect(resp.data).toEqual({ likes: 121, shares: 11, views: 1725 });
});
