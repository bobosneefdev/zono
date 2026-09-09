# Zono

Contract-first, type-safe HTTP clients, servers, and gateways built on [Standard Schema](https://standardschema.dev/schema) and [Hono](https://hono.dev).

You declare your API once: routes, request and response schemas, middleware, error mode. Servers, clients, and gateways all derive their types from that one definition. There is no codegen step, and clients import the definition as a type only, so schemas stay out of client bundles.

```bash
bun add @bobosneefdev/zono zod
# hono is only needed where you run a server or gateway
bun add hono
```

## The API definition

Any Standard Schema v1 validator works in `schema` and `pathParams`, including async validators. The examples below use Zod; install your preferred validator alongside Zono.

For Effect v4 RC, install `effect@rc` instead of Zod and use its Standard Schema adapter:

```ts
import { Schema } from "effect";

const userSchema = Schema.toStandardSchemaV1(
    Schema.Struct({ id: Schema.String, name: Schema.String }),
);
// Use userSchema anywhere a contract accepts a schema.
```

Client requests infer schema input types; handlers receive validated output types, including request transforms. Response types infer schema outputs. Response validation checks handler/middleware data and headers without applying the parsed output to the serialized response, so return values already matching the declared output. Transport constraints still apply (for example, text responses must be strings and path parameters must be string records).

```ts
// api.ts
import { defineApi } from "@bobosneefdev/zono/contract";
import z from "zod";

const zUser = z.object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.date(),
});

export const api = defineApi({
    contracts: {
        SHAPE: {
            health: {
                CONTRACT: {
                    get: {
                        responses: {
                            200: { type: "JSON", schema: z.object({ ok: z.boolean() }) },
                        },
                    },
                },
            },
            users: {
                SHAPE: {
                    // Dynamic segments start with $ and require a matching pathParams schema.
                    $userId: {
                        CONTRACT: {
                            get: {
                                pathParams: z.object({ userId: z.uuid() }),
                                responses: {
                                    200: { type: "SuperJSON", schema: zUser.nullable() },
                                },
                            },
                        },
                    },
                },
            },
            search: {
                CONTRACT: {
                    // HTTP QUERY: a safe method with a request body.
                    query: {
                        body: {
                            type: "JSON",
                            schema: z.object({ filter: z.string() }),
                        },
                        responses: {
                            200: {
                                type: "JSON",
                                schema: z.object({ results: z.array(z.string()) }),
                            },
                        },
                    },
                },
            },
        },
    },
    middlewares: {
        MIDDLEWARE: {
            rateLimit: {
                429: { type: "JSON", schema: z.object({ retryAfter: z.number() }) },
            },
        },
    },
    // errorMode: "opaque" (default) | "detailed"
});
```

- Paths come from nested `SHAPE` keys: `/users/$userId`, `/search`, etc.
- Methods are `get`, `post`, `put`, `delete`, `patch`, `options`, `head`, and `query`.
- Body and response transports: `JSON`, `SuperJSON` (dates, maps, sets via [superjson](https://github.com/flightcontrolhq/superjson)), `Text`, `Blob`, `Bytes`, `FormData`, `URLSearchParams`, `Contentless`.
- Query and headers use `Standard` (plain string records) or structured `JSON`/`SuperJSON` transports.
- Middleware can attach at any contract path, root included. Attaching it to a path that doesn't exist in the contracts is a compile error.

## Server

`createApiHandlers` is curried: fix the API in the first call, pass handlers in the second. This lets TypeScript infer your application context from `createContext` and thread it through every handler while still checking response literals against the contract.

```ts
import { createApiHandlers, initHono } from "@bobosneefdev/zono/server";
import { Hono } from "hono";
import { api } from "./api.js";

const binding = createApiHandlers(api)({
    createContext: async (ctx) => {
        return { userId: ctx.req.header("x-user-id") };
    },
    contracts: {
        SHAPE: {
            health: {
                HANDLER: {
                    get: () => ({ status: 200, type: "JSON", data: { ok: true } }),
                },
            },
            users: {
                SHAPE: {
                    $userId: {
                        HANDLER: {
                            // data is typed from the contract
                            get: async (data, ctx, appContext) => ({
                                status: 200,
                                type: "SuperJSON",
                                data: await findUser(data.pathParams.userId, appContext.userId),
                            }),
                        },
                    },
                },
            },
            search: {
                HANDLER: {
                    query: async (data) => ({
                        status: 200,
                        type: "JSON",
                        data: { results: performSearch(data.body.filter) },
                    }),
                },
            },
        },
    },
    middlewares: {
        MIDDLEWARE: {
            rateLimit: async (ctx, next, appContext) => {
                if (await isLimited(appContext.userId)) {
                    return { status: 429, type: "JSON", data: { retryAfter: Date.now() + 1000 } };
                }
                await next();
            },
        },
    },
});

const app = new Hono();
initHono(app, binding, {
    // Observational only; it cannot replace the typed HTTP response.
    onError(error, ctx) {
        logger.error({ error, path: ctx.req.path });
    },
});
Bun.serve({ fetch: app.fetch, port: 3000 });
```

The compiler requires a handler for every contract method and every declared middleware, and rejects handlers for paths, methods, or middleware names that don't exist. Responses must match the declared status/transport/schema/header union. Runtime validation backs this up: a handler response that violates its contract becomes a `500` rather than a malformed response.

## Client

Clients need only the type of the API definition, so runtime schemas never reach client bundles.

```ts
import { createClient } from "@bobosneefdev/zono/client";
import type { api } from "./api.js";

const client = createClient<typeof api>("http://localhost:3000");

// No request components: data may be omitted.
const health = await client.fetch("/health", "get");

// Required components make the request argument required. Omitting it is a type error.
const user = await client.fetch("/users/$userId", "get", {
    pathParams: { userId: "8f14e45f-..." },
});

const results = await client.fetch("/search", "query", {
    body: { type: "JSON", data: { filter: "active" } },
});

if (results.status === 200) {
    results.data.results; // string[]
}
```

Every response is a discriminated union over the declared statuses, middleware responses along the route's path, and Zono's own error responses (see below). Narrowing on `status` types `data`.

`fetchConfig` returns the `[url, RequestInit]` tuple without sending, and `parseResponse` turns a raw `Response` back into the typed union:

```ts
const [url, init] = await client.fetchConfig("/health", "get");
const response = await fetch(url, init);
const parsed = await client.parseResponse("/health", "get", response);
```

`preRequest`/`postRequest` hooks wrap every request, for things like auth headers or logging:

```ts
const client = createClient<typeof api>(baseUrl, {
    preRequest: (url, init) => [url, withAuth(init)],
    postRequest: async (response) => response,
});
```

## Errors

The API definition sets one of two server error modes:

- `"opaque"` (default) returns fixed payloads that never expose exception messages, validation issues, or stacks:
  - `400` `{ message: "Invalid request" }` for request parsing/validation failures
  - `404` `{ message: "Not Found" }` for unmatched routes
  - `415` `{ message: "Unsupported media type" }` for declared media-type mismatches
  - `500` `{ message: "Internal server error" }` for thrown errors and response-contract violations
- `"detailed"` includes `message` and, where relevant, `issues` and `stack`. Use it for development, not production.

Clients infer the matching error union from the API definition. Pass `"none"` as the second generic to drop Zono-generated errors from the union:

```ts
const client = createClient<typeof api, "none">(baseUrl);
```

Both `initHono` and `initGateway` accept `onError(error, ctx)`. It is awaited, receives the original failure, and its own failures are swallowed, so it cannot change what the client receives.

## Media types

Request and response content types are deterministic:

| Transport | Request default | Response default |
|---|---|---|
| JSON / SuperJSON | `application/json` | `application/json` |
| Text | `text/plain; charset=utf-8` | `text/plain; charset=utf-8` |
| Blob | Blob's type, else `application/octet-stream` | same |
| Bytes | n/a | `application/octet-stream` |
| URLSearchParams | `application/x-www-form-urlencoded;charset=UTF-8` | n/a |
| FormData | runtime-generated multipart boundary | runtime-generated |
| Contentless | n/a | none |

Contracts may override the media type where Zono controls the header:

```ts
body: {
    type: "JSON",
    contentType: "application/query+json",
    schema: querySchema,
},
```

- Because clients are type-only, the declared `contentType` literal must also be passed in the request body input. The compiler enforces this.
- When a contract declares an explicit `contentType`, the server validates incoming requests against it (case-insensitive type/subtype; parameter order and whitespace ignored; declared parameter values must match) and returns a typed `415` on mismatch. Contracts using defaults stay permissive for third-party callers.
- Response overrides are checked for serializer compatibility: JSON/SuperJSON need `application/json` or a `+json` subtype, Text needs `text/*`, Blob/Bytes accept any valid media type.
- FormData never accepts a manual `content-type`; the runtime generates the boundary. A user-supplied `content-type` header on any other body must match the effective media type or the client throws before sending.

## Gateway

A gateway proxies selected routes from upstream Zono services under per-service path prefixes, with its own typed middleware layer.

```ts
import {
    createGatewayClient,
    createGatewayHandlers,
    createGatewayService,
    createGatewayServices,
    type GatewayMiddlewares,
    initGateway,
} from "@bobosneefdev/zono/gateway";

// The mask picks which contract routes the gateway exposes.
// Use SHAPE: true at any node to include all descendants recursively.
const searchService = createGatewayService({
    api,
    mask: {
        SHAPE: {
            search: { CONTRACT: true },
        },
    },
    baseUrl: "https://search.internal",
});

const services = createGatewayServices({ search: searchService });

// Optional gateway middleware, constrained by the masked service contracts.
const gatewayApi = {
    MIDDLEWARE: {
        gatewayAuth: {
            401: { type: "JSON", schema: z.object({ message: z.string() }) },
        },
    },
} as const satisfies GatewayMiddlewares<typeof services>;

const gatewayApp = new Hono();
initGateway(gatewayApp, services, {
    handlers: createGatewayHandlers(gatewayApi)({
        createContext: async (ctx) => ({ requestId: crypto.randomUUID() }),
        middlewares: {
            MIDDLEWARE: {
                gatewayAuth: async (ctx, next, appContext) => {
                    if (!(await isAuthed(ctx))) {
                        return { status: 401, type: "JSON", data: { message: "Unauthorized" } };
                    }
                    await next();
                },
            },
        },
    }),
    onError(error) {
        logger.error({ error });
    },
});
```

The gateway client is also type-only, keyed by service:

```ts
const gatewayClient = createGatewayClient<typeof services, typeof gatewayApi>(
    "https://gateway.example.com",
);

// Hits the gateway's /search/search route; paths stay unprefixed in code.
const results = await gatewayClient.search.fetch("/search", "query", {
    body: { type: "JSON", data: { filter: "active" } },
});
```

Masked-out routes are not registered on the gateway and do not appear on the client. Each routed service keeps its own API's error mode and middleware response types in the inferred union. Method, body, and content type pass through to the upstream unchanged.

## Package exports

| Subpath | Contents |
|---|---|
| `@bobosneefdev/zono/contract` | `defineApi`, `ApiDefinition`, contract types, derived helpers |
| `@bobosneefdev/zono/server` | `createApiHandlers`, `initHono`, handler types |
| `@bobosneefdev/zono/client` | `createClient`, client types |
| `@bobosneefdev/zono/middleware` | middleware tree/spec types |
| `@bobosneefdev/zono/gateway` | gateway services, handlers, client |
| `@bobosneefdev/zono/shared` | shared user-facing types (`ErrorMode`, `TypedFetch`, etc.) |

ESM-only. No schema library is a required peer dependency. `hono` is optional and only needed for servers and gateways. `@standard-schema/spec` provides the shared types; Zod and Effect are development dependencies for tests.

## License

MIT
