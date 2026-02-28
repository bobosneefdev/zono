import { describe, expect, test } from "bun:test";
import z from "zod";
import { createRoutes } from "~/contract/routes.js";
import type { RouterShape } from "~/contract/shape.types.js";
import { createMiddleware } from "~/middleware/middleware.js";

const shape = {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: true,
				},
				$userId: {
					CONTRACT: true,
					ROUTER: {
						posts: {
							CONTRACT: true,
							ROUTER: {
								$postId: {
									CONTRACT: true,
								},
							},
						},
					},
				},
			},
		},
		health: {
			CONTRACT: true,
		},
	},
} as const satisfies RouterShape;

const zId = z.string().uuid();

const zUser = z.object({
	id: zId,
	name: z.string(),
	email: z.string().email(),
});

const zPost = z.object({
	id: zId,
	userId: zId,
	text: z.string(),
});

const routes = createRoutes(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								contentType: "application/json",
								schema: z.object({
									name: z.string(),
									email: z.string().email(),
								}),
							},
							responses: {
								201: {
									contentType: "application/json",
									schema: zUser,
								},
							},
						},
					},
				},
				$userId: {
					CONTRACT: {
						get: {
							pathParams: z.object({ userId: z.string() }),
							responses: {
								200: {
									contentType: "application/json",
									schema: zUser,
								},
							},
						},
					},
					ROUTER: {
						posts: {
							CONTRACT: {
								get: {
									pathParams: z.object({ userId: z.string() }),
									responses: {
										200: {
											contentType: "application/json",
											schema: z.array(zPost),
										},
									},
								},
							},
							ROUTER: {
								$postId: {
									CONTRACT: {
										get: {
											pathParams: z.object({
												userId: z.string(),
												postId: z.string(),
											}),
											responses: {
												200: {
													contentType: "application/json",
													schema: zPost,
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
		health: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							contentType: "application/json",
							schema: z.object({ status: z.string() }),
						},
					},
				},
			},
		},
	},
});

describe("createRoutes", () => {
	test("returns the definition as-is (identity)", () => {
		expect(routes.ROUTER).toBeDefined();
		expect(routes.ROUTER.users).toBeDefined();
		expect(routes.ROUTER.users.ROUTER.register.CONTRACT.post).toBeDefined();
		expect(routes.ROUTER.health.CONTRACT.get).toBeDefined();
	});

	test("preserves contract schemas", () => {
		const postContract = routes.ROUTER.users.ROUTER.register.CONTRACT.post!;
		expect(postContract.body).toBeDefined();
		expect(postContract.responses[201]).toBeDefined();
		expect(postContract.responses[201].contentType).toBe("application/json");
	});

	test("preserves nested route structure", () => {
		const userId = routes.ROUTER.users.ROUTER.$userId;
		expect(userId.CONTRACT.get).toBeDefined();
		expect(userId.ROUTER).toBeDefined();
		expect(userId.ROUTER.posts.CONTRACT.get).toBeDefined();
		expect(userId.ROUTER.posts.ROUTER.$postId.CONTRACT.get).toBeDefined();
	});

	test("validates contract body schemas at runtime", async () => {
		const bodySchema = routes.ROUTER.users.ROUTER.register.CONTRACT.post!.body!.schema;
		const validResult = bodySchema.safeParse({
			name: "John",
			email: "john@example.com",
		});
		expect(validResult.success).toBe(true);

		const invalidResult = bodySchema.safeParse({ name: 123 });
		expect(invalidResult.success).toBe(false);
	});

	test("supports top-level transform chains and validates nested transform rejection", async () => {
		const transformShape = {
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							CONTRACT: true,
						},
					},
				},
			},
		} as const satisfies RouterShape;

		const transformedRoutes = createRoutes(transformShape, {
			ROUTER: {
				users: {
					ROUTER: {
						register: {
							CONTRACT: {
								post: {
									body: {
										contentType: "application/json",
										schema: z
											.object({ name: z.string(), email: z.string().email() })
											.transform((input) => ({
												...input,
												name: input.name.trim(),
											}))
											.transform((input) => ({
												...input,
												name: input.name.toUpperCase(),
											})),
									},
									responses: {
										201: {
											contentType: "application/json",
											schema: z
												.object({
													id: z.string(),
													name: z.string(),
													email: z.string(),
												})
												.transform((user) => ({
													...user,
													name: user.name.toLowerCase(),
												})),
										},
									},
								},
							},
						},
					},
				},
			},
		});

		expect(transformedRoutes.ROUTER.users.ROUTER.register.CONTRACT.post).toBeDefined();

		expect(() =>
			createRoutes(transformShape, {
				ROUTER: {
					users: {
						ROUTER: {
							register: {
								CONTRACT: {
									post: {
										body: {
											contentType: "application/json",
											schema: z.object({
												name: z.string().transform((value) => value.trim()),
												email: z.string().email(),
											}),
										},
										responses: {
											201: {
												contentType: "application/json",
												schema: zUser,
											},
										},
									},
								},
							},
						},
					},
				},
			}),
		).toThrow("Nested .transform(...) is not supported in route contract schemas");
	});
});

describe("createMiddleware", () => {
	const middleware = createMiddleware(routes, {
		MIDDLEWARE: {
			rateLimit: {
				429: {
					contentType: "application/json",
					schema: z.object({ retryAfter: z.number() }),
				},
			},
		},
		ROUTER: {
			users: {
				ROUTER: {
					register: {
						MIDDLEWARE: {
							antiBot: {
								403: {
									contentType: "application/json",
									schema: z.object({ error: z.string() }),
								},
							},
						},
					},
				},
			},
		},
	});

	test("returns the definition as-is (identity)", () => {
		expect(middleware.MIDDLEWARE).toBeDefined();
		expect(middleware.MIDDLEWARE!.rateLimit).toBeDefined();
		expect(middleware.MIDDLEWARE!.rateLimit[429]).toBeDefined();
	});

	test("preserves nested middleware definitions", () => {
		const registerMw = (
			middleware.ROUTER as Record<
				string,
				{ ROUTER: Record<string, { MIDDLEWARE: Record<string, unknown> }> }
			>
		).users.ROUTER.register.MIDDLEWARE;
		expect(registerMw.antiBot).toBeDefined();
	});

	test("supports empty middleware (side-effect only)", () => {
		const sideEffectMiddleware = createMiddleware(routes, {
			ROUTER: {
				health: {
					MIDDLEWARE: {
						analytics: {},
					},
				},
			},
		});
		expect(
			(sideEffectMiddleware.ROUTER as Record<string, Record<string, unknown>>).health
				.MIDDLEWARE,
		).toBeDefined();
	});
});
