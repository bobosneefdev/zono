# Zono

Type-safe HTTP contracts with shared runtime validation across contract definitions, server handlers, and client calls.

## Core model: route nodes contain method maps

Contract route nodes now define a `contract` object keyed by HTTP method (`get`, `post`, `put`, `delete`, `patch`, `options`, `head`).

```ts
import z from "zod";
import { createRouter } from "@bobosneefdev/zono/contract";

export const router = createRouter(
	{
		users: {
			type: "router",
			router: {
				$id: {
					type: "contract",
				},
			},
		},
	},
	{
		users: {
			$id: {
				contract: {
					get: {
						pathParams: z.object({ id: z.string() }),
						responses: {
							200: {
								body: z.object({ id: z.string(), name: z.string() }),
							},
						},
					},
					post: {
						pathParams: z.object({ id: z.string() }),
						body: z.object({ name: z.string() }),
						responses: {
							201: {
								body: z.object({ id: z.string(), name: z.string() }),
							},
						},
					},
				},
			},
		},
	},
);
```

This allows multiple verbs on the same route path (`/users/$id` in the example above).

## Hono: handler maps by method

`initHono` now expects each contract node to provide a `handler` map keyed by method.

```ts
import { Hono } from "hono";
import { initHono } from "@bobosneefdev/zono/hono";

const app = new Hono();

initHono(app, router, {
	users: {
		$id: {
			handler: {
				get: async (input) => ({
					status: 200,
					data: {
						id: input.pathParams.id,
						name: "John",
					},
				}),
				post: async (input) => ({
					status: 201,
					data: {
						id: input.pathParams.id,
						name: input.body.name,
					},
				}),
			},
		},
	},
});
```

## Client: verb-specific calls

`createClient` exposes verb-specific methods (`get`, `post`, `put`, `delete`, `patch`, `options`, `head`).

```ts
import { createClient } from "@bobosneefdev/zono/client";

const client = createClient(router, {
	baseUrl: "http://localhost:3000",
});

const getUser = await client.get("/users/$id", {
	pathParams: { id: "123" },
});

const createUser = await client.post("/users/$id", {
	pathParams: { id: "123" },
	body: { name: "Alice" },
});
```

The old generic `fetch` method is removed; use the verb-specific methods instead.

## SvelteKit: implement method maps and return HTTP exports

`initSvelteKit(router)` returns an `implement(route, handlersByMethod)` function.
`implement` accepts method-keyed handlers and returns SvelteKit exports like `{ GET, POST, ... }`.

```ts
import { initSvelteKit } from "@bobosneefdev/zono/sveltekit";

const implement = initSvelteKit(router);

export const { GET, POST } = implement("/users/$id", {
	get: async (input) => ({
		status: 200,
		data: {
			id: input.pathParams.id,
			name: "John",
		},
	}),
	post: async (input) => ({
		status: 201,
		data: {
			id: input.pathParams.id,
			name: input.body.name,
		},
	}),
});
```

## Breaking API summary

- Route contracts are method maps at each contract node (`contract.get`, `contract.post`, ...).
- Hono integration expects handler maps (`handler.get`, `handler.post`, ...).
- Client requests are verb-specific (`client.get(...)`, `client.post(...)`, ...).
- Generic client `fetch` is removed.
- SvelteKit uses `implement(route, handlersByMethod)` and returns `{ GET, POST, ... }`.
