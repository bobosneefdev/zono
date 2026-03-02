import { describe, expect, test } from "bun:test";
import z from "zod";
import type { RouterShape } from "~/contract/contract.types.js";
import { createContracts } from "~/contract/contracts.js";
import { createMiddlewares } from "~/middleware/middleware.js";

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

const contracts = createContracts(shape, {
	ROUTER: {
		users: {
			ROUTER: {
				register: {
					CONTRACT: {
						post: {
							body: {
								type: "JSON",
								schema: z.object({
									name: z.string(),
									email: z.string().email(),
								}),
							},
							responses: {
								201: {
									type: "JSON",
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
									type: "JSON",
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
											type: "JSON",
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
													type: "JSON",
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
							type: "JSON",
							schema: z.object({ status: z.string() }),
						},
					},
				},
			},
		},
	},
});

describe("createContracts", () => {
	test("returns the definition as-is (identity)", () => {
		expect(contracts.ROUTER).toBeDefined();
		expect(contracts.ROUTER.users).toBeDefined();
		expect(contracts.ROUTER.users.ROUTER.register.CONTRACT.post).toBeDefined();
		expect(contracts.ROUTER.health.CONTRACT.get).toBeDefined();
	});

	test("preserves contract schemas", () => {
		const postContract = contracts.ROUTER.users.ROUTER.register.CONTRACT.post!;
		expect(postContract.body).toBeDefined();
		expect(postContract.responses[201]).toBeDefined();
		expect(postContract.responses[201].type).toBe("JSON");
	});

	test("preserves nested route structure", () => {
		const userId = contracts.ROUTER.users.ROUTER.$userId;
		expect(userId.CONTRACT.get).toBeDefined();
		expect(userId.ROUTER).toBeDefined();
		expect(userId.ROUTER.posts.CONTRACT.get).toBeDefined();
		expect(userId.ROUTER.posts.ROUTER.$postId.CONTRACT.get).toBeDefined();
	});

	test("validates contract body schemas at runtime", async () => {
		const bodySchema = contracts.ROUTER.users.ROUTER.register.CONTRACT.post!.body!.schema;
		const validResult = bodySchema.safeParse({
			name: "John",
			email: "john@example.com",
		});
		expect(validResult.success).toBe(true);

		const invalidResult = bodySchema.safeParse({ name: 123 });
		expect(invalidResult.success).toBe(false);
	});

	test("supports non-JSON body and response definitions", () => {
		const multiTypeShape = {
			ROUTER: {
				files: {
					CONTRACT: true,
				},
			},
		} as const satisfies RouterShape;

		const multiTypeContracts = createContracts(multiTypeShape, {
			ROUTER: {
				files: {
					CONTRACT: {
						post: {
							body: {
								type: "FormData",
								schema: z.instanceof(FormData),
							},
							responses: {
								201: {
									type: "Blob",
									schema: z.instanceof(Blob),
								},
							},
						},
					},
				},
			},
		});

		expect(multiTypeContracts.ROUTER.files.CONTRACT.post?.body?.type).toBe("FormData");
		expect(multiTypeContracts.ROUTER.files.CONTRACT.post?.responses[201].type).toBe("Blob");
	});
});

describe("createMiddlewares", () => {
	const middleware = createMiddlewares(contracts, {
		MIDDLEWARE: {
			rateLimit: {
				429: {
					type: "JSON",
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
									type: "JSON",
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
		const sideEffectMiddleware = createMiddlewares(contracts, {
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
