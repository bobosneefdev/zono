import { describe, expect, it } from "bun:test";
import type { RequestHandler } from "@sveltejs/kit";
import z from "zod";
import { createRouter } from "~/contract/index.js";
import { initSvelteKit } from "~/sveltekit/index.js";
import type { SvelteKitImplementer } from "~/sveltekit/types.js";

function expectType<T>(_value: T): void {}

function createEvent(args: {
	url: string;
	method: string;
	params: Record<string, string>;
	headers?: Record<string, string>;
	body?: unknown;
}): Parameters<RequestHandler>[0] {
	return {
		url: new URL(args.url),
		params: args.params,
		request: new Request(args.url, {
			method: args.method,
			headers: args.headers,
			body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
		}),
	} as unknown as Parameters<RequestHandler>[0];
}

const router = createRouter(
	{
		users: {
			type: "router",
			router: {
				$id: {
					type: "contract",
					router: {
						$postId: {
							type: "contract",
						},
					},
				},
			},
		},
	},
	{
		users: {
			$id: {
				contract: {
					method: "get",
					pathParams: z.object({
						id: z.string(),
					}),
					headers: z.object({
						"x-input-header": z.string(),
					}),
					responses: {
						200: {
							body: z.object({
								id: z.string(),
								name: z.string().transform(async (value) => value.toUpperCase()),
							}),
							headers: z.object({
								"x-output-header": z.string(),
							}),
						},
					},
				},
				router: {
					$postId: {
						contract: {
							method: "get",
							pathParams: z.object({
								id: z.string(),
								postId: z.string(),
							}),
							responses: {
								200: {
									body: z.object({
										id: z.string(),
										title: z
											.string()
											.transform(async (value) => value.toUpperCase()),
									}),
								},
							},
						},
					},
				},
			},
		},
	},
);

describe("initSvelteKit", () => {
	it("provides strongly typed route and handler contracts", () => {
		const implementer = initSvelteKit(router);
		expectType<SvelteKitImplementer<typeof router>>(implementer);

		const getUser = implementer("/users/$id", async (data) => {
			expectType<string>(data.pathParams.id);
			expectType<string>(data.headers["x-input-header"]);

			return {
				status: 200,
				data: {
					id: data.pathParams.id,
					name: "john",
				},
				headers: {
					"x-output-header": "hello",
				},
			};
		});

		expectType<RequestHandler>(getUser);

		// @ts-expect-error invalid route path should be rejected
		const invalidRoute: Parameters<typeof implementer>[0] = "/users/invalid";
		void invalidRoute;
	});

	it("parses incoming and outgoing values for nested routes", async () => {
		const implementer = initSvelteKit(router);

		const getPost = implementer("/users/$id/$postId", async (data) => {
			return {
				status: 200,
				data: {
					id: data.pathParams.postId,
					title: "post title",
				},
			};
		});

		const response = await getPost(
			createEvent({
				url: "http://localhost/users/123/abc",
				method: "GET",
				params: { id: "123", postId: "abc" },
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: "abc",
			title: "POST TITLE",
		});
	});

	it("supports bypassIncomingParse and bypassOutgoingParse options with per-response override", async () => {
		const bypassRouter = createRouter(
			{
				items: {
					type: "router",
					router: {
						$id: {
							type: "contract",
						},
					},
				},
			},
			{
				items: {
					$id: {
						contract: {
							method: "get",
							pathParams: z.object({
								id: z.string().regex(/^\d+$/),
							}),
							responses: {
								200: {
									body: z.object({
										id: z
											.string()
											.transform(async (value) => value.toUpperCase()),
									}),
								},
							},
						},
					},
				},
			},
		);

		const implementer = initSvelteKit(bypassRouter, {
			bypassIncomingParse: true,
			bypassOutgoingParse: true,
		});

		const getItem = implementer("/items/$id", async (data) => {
			return {
				status: 200,
				data: {
					id: data.pathParams.id,
				},
				opts: {
					bypassOutgoingParse: false,
				},
			};
		});

		const response = await getItem(
			createEvent({
				url: "http://localhost/items/abc",
				method: "GET",
				params: { id: "abc" },
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: "ABC" });
	});
});
