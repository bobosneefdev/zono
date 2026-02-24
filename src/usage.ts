// NOT A MODULE, JUST A SANDBOX FOR TESTING AS I DEVELOP

import { Hono } from "hono";
import z from "zod";
import { createClient } from "./client/index.js";
import { initHono } from "./hono/index.js";
import { createRouter } from "./router/index.js";
import { initSvelteKit } from "./sveltekit/index.js";

const zUser = z.null(); // example/placeholder schema
const zFilter = z.null(); // example/placeholder schema

const router = createRouter(
	{
		users: {
			type: "router",
			router: {
				$discordId: {
					type: "contract",
					router: {
						filters: {
							type: "contract",
							router: {
								$filterId: {
									type: "contract",
								},
							},
						},
					},
				},
			},
		},
	},
	{
		users: {
			$discordId: {
				contract: {
					get: {
						pathParams: z.object({
							discordId: z.string(),
						}),
						responses: {
							200: {
								contentType: "application/json",
								body: zUser,
							},
						},
					},
				},
				router: {
					filters: {
						contract: {
							get: {
								pathParams: z.object({
									discordId: z.string(),
								}),
								responses: {
									200: {
										contentType: "application/json",
										body: z.array(zFilter),
									},
								},
							},
						},
						router: {
							$filterId: {
								contract: {
									get: {
										pathParams: z.object({
											discordId: z.string(),
											filterId: z.string(),
										}),
										responses: {
											200: {
												contentType: "application/json",
												body: zFilter,
											},
										},
									},
									post: {
										pathParams: z.object({
											discordId: z.string(),
											filterId: z.string(),
										}),
										body: zFilter,
										responses: {
											204: {
												contentType: null,
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
);

// HONO

const app = new Hono();

initHono(app, router, {
	users: {
		$discordId: {
			handler: {
				get: async (_input) => {
					return {
						status: 200,
						data: null,
					};
				},
			},
			router: {
				filters: {
					handler: {
						get: async (_input) => {
							return {
								status: 200,
								data: [null],
							};
						},
					},
					router: {
						$filterId: {
							handler: {
								get: async (_input) => {
									return {
										status: 200,
										data: null,
									};
								},
								post: async (_input) => {
									return {
										status: 204,
									};
								},
							},
						},
					},
				},
			},
		},
	},
});

Bun.serve({
	fetch: app.fetch,
	port: 3000,
});

console.log("Server is running on http://localhost:3000");

// SVELTEKIT
const implement = initSvelteKit(router, {
	getHandlerParams: (event) => [event],
});

implement("/users/$discordId", {
	get: async (_data) => {
		return {
			status: 200,
			data: null,
		};
	},
});

// CLIENT

const client = createClient(router, {
	baseUrl: "http://localhost:3000",
});

(async () => {
	const _resp = await client.post("/users/$discordId/filters/$filterId", {
		pathParams: {
			discordId: "123",
			filterId: "456",
		},
		body: null,
	});
})();
