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
					get: {
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
									name: z
										.string()
										.transform(async (value) => value.toUpperCase()),
								}),
								headers: z.object({
									"x-output-header": z.string(),
								}),
							},
						},
					},
					post: {
						pathParams: z.object({
							id: z.string(),
						}),
						body: z.object({
							name: z.string(),
						}),
						responses: {
							201: {
								body: z.object({
									id: z.string(),
									name: z.string(),
								}),
							},
						},
					},
				},
				router: {
					$postId: {
						contract: {
							get: {
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
	},
);

describe("initSvelteKit", () => {
	it("provides strongly typed route and method handlers", () => {
		const implementer = initSvelteKit(router);
		expectType<SvelteKitImplementer<typeof router>>(implementer);

		const userExports = implementer("/users/$id", {
			get: async (data: {
				pathParams: { id: string };
				headers: { "x-input-header": string };
			}) => {
				expectType<string>(data.pathParams.id);
				expectType<string>(data.headers["x-input-header"]);

				return {
					status: 200 as const,
					data: {
						id: data.pathParams.id,
						name: "john",
					},
					headers: {
						"x-output-header": "hello",
					},
				};
			},
			post: async (data: { pathParams: { id: string }; body: { name: string } }) => {
				expectType<string>(data.pathParams.id);
				expectType<string>(data.body.name);

				return {
					status: 201 as const,
					data: {
						id: data.pathParams.id,
						name: data.body.name,
					},
				};
			},
		});

		expectType<RequestHandler>(userExports.GET);
		expectType<RequestHandler>(userExports.POST);

		type UserRouteHandlers = Parameters<typeof implementer>[1];
		const invalidMethodHandlers: UserRouteHandlers = {
			// @ts-expect-error method not defined in route contract map should be rejected
			delete: async () => ({
				status: 200,
				data: {
					id: "x",
					name: "x",
				},
				headers: {
					"x-output-header": "x",
				},
			}),
		};
		void invalidMethodHandlers;

		// @ts-expect-error invalid route path should be rejected
		const invalidRoute: Parameters<typeof implementer>[0] = "/users/invalid";
		void invalidRoute;
	});

	it("parses incoming and outgoing values for nested routes", async () => {
		const implementer = initSvelteKit(router);

		const routeExports = implementer("/users/$id/$postId", {
			get: async (data: { pathParams: { id: string; postId: string } }) => {
				return {
					status: 200 as const,
					data: {
						id: data.pathParams.postId,
						title: "post title",
					},
				};
			},
		});

		const response = await routeExports.GET(
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
							get: {
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
			},
		);

		const implementer = initSvelteKit(bypassRouter, {
			bypassIncomingParse: true,
			bypassOutgoingParse: true,
		});

		const itemExports = implementer("/items/$id", {
			get: async (data: { pathParams: { id: string } }) => {
				return {
					status: 200 as const,
					data: {
						id: data.pathParams.id,
					},
					opts: {
						bypassOutgoingParse: false,
					},
				};
			},
		});

		const response = await itemExports.GET(
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
