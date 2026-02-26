import { describe, expect, it } from "bun:test";
import type { RequestHandler } from "@sveltejs/kit";
import z from "zod";
import { createRouter } from "~/router/index.js";
import { initSvelteKit } from "~/sveltekit/index.js";
import type { SvelteKitImplementer } from "~/sveltekit/sveltekit.types.js";

function expectType<T>(_value: T): void {}

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;

function createEvent(args: {
	url: string;
	method: string;
	params: Record<string, string>;
	headers?: Record<string, string>;
	body?: unknown;
	rawBody?: BodyInit;
}): Parameters<RequestHandler>[0] {
	return {
		url: new URL(args.url),
		params: args.params,
		request: new Request(args.url, {
			method: args.method,
			headers: args.headers,
			body: args.rawBody ?? (args.body !== undefined ? JSON.stringify(args.body) : undefined),
		}),
	} as unknown as Parameters<RequestHandler>[0];
}

const router = createRouter(
	{
		users: {
			TYPE: "router",
			ROUTER: {
				$id: {
					TYPE: "contract",
					ROUTER: {
						$postId: {
							TYPE: "contract",
						},
					},
				},
			},
		},
	},
	{
		users: {
			$id: {
				CONTRACT: {
					get: {
						pathParams: z.object({
							id: z.string(),
						}),
						headers: z.object({
							"x-input-header": z.string(),
						}),
						responses: {
							200: {
								contentType: "application/json",
								schema: z.object({
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
						payload: {
							contentType: "application/json",
							schema: z.object({
								name: z.string(),
							}),
						},
						responses: {
							201: {
								contentType: "application/json",
								schema: z.object({
									id: z.string(),
									name: z.string(),
								}),
							},
						},
					},
				},
				ROUTER: {
					$postId: {
						CONTRACT: {
							get: {
								pathParams: z.object({
									id: z.string(),
									postId: z.string(),
								}),
								responses: {
									200: {
										contentType: "application/json",
										schema: z.object({
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
		const implementer = initSvelteKit(router, {
			transformParams: (event) => [event],
		});
		expectType<SvelteKitImplementer<typeof router, [Parameters<RequestHandler>[0]]>>(
			implementer,
		);

		const userExports = implementer("/users/$id", {
			get: async (data) => {
				type _assertDataNotAny = AssertFalse<IsAny<typeof data>>;
				const _dataNotAny: _assertDataNotAny = false;
				void _dataNotAny;

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
			post: async (data) => {
				expectType<string>(data.pathParams.id);
				expectType<string>(data.payload.name);

				return {
					status: 201 as const,
					data: {
						id: data.pathParams.id,
						name: data.payload.name,
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
		const implementer = initSvelteKit(router, {
			transformParams: (event) => [event],
		});

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

	it("passes explicit handler params from transformParams", async () => {
		const implementer = initSvelteKit(router, {
			transformParams: (event) => [event],
		});
		type EventGetHandler = Parameters<typeof implementer>[1]["get"];
		type EventPostHandler = Parameters<typeof implementer>[1]["post"];

		let receivedEvent: Parameters<RequestHandler>[0] | undefined;
		const getHandler: EventGetHandler = async (data, event) => {
			receivedEvent = event;
			return {
				status: 200 as const,
				data: {
					id: data.pathParams.id,
					name: "john",
				},
				headers: {
					"x-output-header": "ok",
				},
			};
		};
		const postHandler: EventPostHandler = async (data) => {
			return {
				status: 201 as const,
				data: {
					id: data.pathParams.id,
					name: data.payload.name,
				},
			};
		};

		const routeExports = implementer("/users/$id", {
			get: getHandler,
			post: postHandler,
		});

		const event = createEvent({
			url: "http://localhost/users/123",
			method: "GET",
			params: { id: "123" },
			headers: { "x-input-header": "yes" },
		});

		const response = await routeExports.GET(event);
		expect(response.status).toBe(200);
		expect(receivedEvent).toBe(event);
	});

	it("supports custom transformParams tuple injection", async () => {
		const implementer = initSvelteKit<typeof router, [Request, string]>(router, {
			transformParams: (event) => [event.request, event.url.pathname],
		});
		type CustomGetHandler = Parameters<typeof implementer>[1]["get"];
		type CustomPostHandler = Parameters<typeof implementer>[1]["post"];

		const getHandler: CustomGetHandler = async (data, request, pathname) => {
			expect(request.method).toBe("GET");
			expect(pathname).toBe("/users/123");
			return {
				status: 200 as const,
				data: {
					id: data.pathParams.id,
					name: "john",
				},
				headers: {
					"x-output-header": "ok",
				},
			};
		};

		const postHandler: CustomPostHandler = async (data, request, pathname) => {
			expect(request.method).toBe("GET");
			expect(pathname).toBe("/users/123");
			return {
				status: 201 as const,
				data: {
					id: data.pathParams.id,
					name: data.payload.name,
				},
			};
		};

		const routeExports = implementer("/users/$id", {
			get: getHandler,
			post: postHandler,
		});

		const validGetHandler: CustomGetHandler = async (data, request, pathname) => {
			expectType<string>(pathname);
			expectType<Request>(request);
			return {
				status: 200 as const,
				data: {
					id: data.pathParams.id,
					name: "john",
				},
				headers: {
					"x-output-header": "ok",
				},
			};
		};
		void validGetHandler;

		const event = createEvent({
			url: "http://localhost/users/123",
			method: "GET",
			params: { id: "123" },
			headers: { "x-input-header": "yes" },
		});

		const response = await routeExports.GET(event);
		expect(response.status).toBe(200);

		// @ts-expect-error custom tuple must be respected by handler signatures
		const invalidGetHandler: CustomGetHandler = async (
			data,
			_event: Parameters<RequestHandler>[0],
		) => {
			return {
				status: 200 as const,
				data: {
					id: data.pathParams.id,
					name: "john",
				},
				headers: {
					"x-output-header": "ok",
				},
			};
		};
		void invalidGetHandler;
	});

	it("supports bypassIncomingParse and bypassOutgoingParse options with per-response override", async () => {
		const bypassRouter = createRouter(
			{
				items: {
					TYPE: "router",
					ROUTER: {
						$id: {
							TYPE: "contract",
						},
					},
				},
			},
			{
				items: {
					$id: {
						CONTRACT: {
							get: {
								pathParams: z.object({
									id: z.string().regex(/^\d+$/),
								}),
								responses: {
									200: {
										contentType: "application/json",
										schema: z.object({
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
			transformParams: (event) => [event],
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

	it("parses multipart FormData request bodies", async () => {
		const formRouter = createRouter(
			{
				uploads: {
					TYPE: "contract",
				},
			},
			{
				uploads: {
					CONTRACT: {
						post: {
							payload: {
								contentType: "multipart/form-data",
								schema: z.instanceof(FormData),
							},
							responses: {
								200: {
									contentType: "application/json",
									schema: z.object({
										name: z.string(),
									}),
								},
							},
						},
					},
				},
			},
		);

		const implementer = initSvelteKit(formRouter, {
			transformParams: (event) => [event],
		});

		const routeExports = implementer("/uploads", {
			post: async (data) => ({
				status: 200 as const,
				data: {
					name: String(data.payload.get("name") ?? ""),
				},
			}),
		});

		const formData = new FormData();
		formData.set("name", "Jane");

		const response = await routeExports.POST(
			createEvent({
				url: "http://localhost/uploads",
				method: "POST",
				params: {},
				rawBody: formData,
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: "Jane",
		});
	});
});
