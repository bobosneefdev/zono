# Zono

TypeScript + Zod end-to-end type-safe HTTP contracts, clients, and server adapters.

Define routes once, then reuse that contract everywhere:

- request/response validation at runtime
- end-to-end static types across server and client
- framework adapters for production integration

## Why Zono

Zono is contract-first. You describe your API shape and schemas with Zod, then generate strongly typed building blocks for:

- route contracts (`createRoutes`)
- server handlers (Hono adapter)
- client calls (`createClient`)
- middleware contracts and gateway composition

## Features

- Contract-first API design built on Zod schemas
- End-to-end type safety from input parsing to response bodies
- Typed HTTP client generated from route contracts
- Hono route + middleware adapters
- Hono gateway utilities for service aggregation/proxying
- Middleware contract composition for reusable error/response models

## Install

```bash
bun add @bobosneefdev/zono zod
```

Adapter peer dependencies as needed:

- `hono` for `@bobosneefdev/zono/hono` and `@bobosneefdev/zono/hono-gateway`
- `@sveltejs/kit` for `@bobosneefdev/zono/sveltekit`

## Quick Start (server + gateway + client)

This quick start reflects the style used in `src/examples/example.ts`, and shows a relatable flow:

- an **ordering service** (your real backend)
- a **gateway** (single entrypoint in front of one or more services)
- a **typed client** calling both

Route and middleware handlers return native Hono responses via context helpers like `ctx.json`.

```ts
import { Hono } from "hono";
import z from "zod";
import type { RouterShape } from "@bobosneefdev/zono/contract";
import { createRoutes } from "@bobosneefdev/zono/contract";
import { createClient } from "@bobosneefdev/zono/client";
import {
  createHonoMiddlewareHandlers,
  createHonoOptions,
  createHonoRouteHandlers,
  initHono,
} from "@bobosneefdev/zono/hono";
import {
  createGatewayOptions,
  generateHonoGatewayRoutesAndMiddleware,
  initHonoGateway,
} from "@bobosneefdev/zono/hono-gateway";
import { createMiddleware } from "@bobosneefdev/zono/middleware";

const shape = {
  ROUTER: {
    menu: { CONTRACT: true },
    orders: {
      ROUTER: {
        create: { CONTRACT: true },
        $orderId: { CONTRACT: true },
      },
    },
    health: { CONTRACT: true },
  },
} as const satisfies RouterShape;

const menuItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().int().positive(),
});

const orderSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string(),
  quantity: z.number().int().positive(),
  status: z.enum(["received", "preparing", "ready"]),
  etaMinutes: z.number().int().nonnegative(),
});

const routes = createRoutes(shape, {
  ROUTER: {
    menu: {
      CONTRACT: {
        get: {
          responses: {
            200: {
              contentType: "application/json",
              schema: z.object({ items: z.array(menuItemSchema) }),
            },
          },
        },
      },
    },
    orders: {
      ROUTER: {
        create: {
          CONTRACT: {
            post: {
              body: {
                contentType: "application/json",
                schema: z.object({
                  itemId: z.string(),
                  quantity: z.number().int().positive(),
                }),
              },
              responses: {
                201: {
                  contentType: "application/json",
                  schema: orderSchema,
                },
              },
            },
          },
        },
        $orderId: {
          CONTRACT: {
            get: {
              pathParams: z.object({ orderId: z.string().uuid() }),
              responses: {
                200: {
                  contentType: "application/json",
                  schema: orderSchema,
                },
                404: {
                  contentType: "application/json",
                  schema: z.object({ message: z.string() }),
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
              schema: z.object({ status: z.literal("ok") }),
            },
          },
        },
      },
    },
  },
});

const middleware = createMiddleware(routes, {
  MIDDLEWARE: {
    rateLimit: {
      429: {
        contentType: "application/json",
        schema: z.object({ retryAfterSeconds: z.number().int().positive() }),
      },
    },
  },
});

const honoOptions = createHonoOptions({
  errorMode: "public",
});

const ordersDb = new Map<string, z.infer<typeof orderSchema>>();

const honoRouteHandlers = createHonoRouteHandlers(routes, honoOptions, {
  ROUTER: {
    menu: {
      HANDLER: {
        get: async (_input, ctx) =>
          ctx.json(
            {
              items: [
                { id: "latte", name: "Caffè Latte", priceCents: 550 },
                { id: "espresso", name: "Espresso", priceCents: 350 },
              ],
            },
            200,
          ),
      },
    },
    orders: {
      ROUTER: {
        create: {
          HANDLER: {
            post: async (input, ctx) => {
              const order = {
                orderId: crypto.randomUUID(),
                itemId: input.body.itemId,
                quantity: input.body.quantity,
                status: "received" as const,
                etaMinutes: 12,
              };

              ordersDb.set(order.orderId, order);
              return ctx.json(order, 201);
            },
          },
        },
        $orderId: {
          HANDLER: {
            get: async (input, ctx) => {
              const order = ordersDb.get(input.pathParams.orderId);
              if (!order) {
                return ctx.json({ message: "Order not found" }, 404);
              }

              return ctx.json(order, 200);
            },
          },
        },
      },
    },
    health: {
      HANDLER: {
        get: async (_input, ctx) => ctx.json({ status: "ok" as const }, 200),
      },
    },
  },
});

const honoMiddlewareHandlers = createHonoMiddlewareHandlers(middleware, honoOptions, {
  MIDDLEWARE: {
    rateLimit: async (_ctx, next) => {
      await next();
    },
  },
});

const orderingServiceApp = new Hono();
initHono(
  orderingServiceApp,
  routes,
  honoRouteHandlers,
  middleware,
  honoMiddlewareHandlers,
  honoOptions,
);

Bun.serve({
  fetch: orderingServiceApp.fetch,
  port: 3000,
});

const { routes: gatewayRoutes, middleware: gatewayMiddleware } =
  generateHonoGatewayRoutesAndMiddleware({
    orderingService: {
      routes,
      middleware,
    },
  });

const gatewayOptions = createGatewayOptions(gatewayRoutes, {
  services: {
    orderingService: "http://localhost:3000",
  },
});

const gatewayAuditMiddleware = createMiddleware(gatewayRoutes, {
  MIDDLEWARE: {
    requestLogging: {},
  },
});

const gatewayAuditHandlers = createHonoMiddlewareHandlers(
  gatewayAuditMiddleware,
  gatewayOptions,
  {
    MIDDLEWARE: {
      requestLogging: async (ctx, next) => {
        console.log(`[gateway] ${ctx.req.method} ${ctx.req.path}`);
        await next();
      },
    },
  },
);

const gatewayApp = new Hono();
initHonoGateway(
  gatewayApp,
  gatewayRoutes,
  gatewayAuditMiddleware,
  gatewayAuditHandlers,
  gatewayOptions,
);

Bun.serve({
  fetch: gatewayApp.fetch,
  port: 4000,
});

const serviceClient = createClient(routes, {
  baseUrl: "http://localhost:3000",
  middleware: [middleware],
  serverErrorMode: "public",
});

const gatewayClient = createClient(gatewayRoutes, {
  baseUrl: "http://localhost:4000",
  middleware: [gatewayMiddleware, gatewayAuditMiddleware],
  serverErrorMode: "public",
});

const directOrder = await serviceClient.orders.create.post({
  body: { itemId: "latte", quantity: 2 },
});

if (directOrder.status === 201) {
  console.log("Direct service order ID:", directOrder.body.orderId);
}

const gatewayOrder = await gatewayClient.orderingService.orders.create.post({
  body: { itemId: "espresso", quantity: 1 },
});

if (gatewayOrder.status === 201) {
  console.log("Gateway order ID:", gatewayOrder.body.orderId);

  const fetched = await gatewayClient.orderingService.orders.$orderId.get({
    pathParams: { orderId: gatewayOrder.body.orderId },
  });

  if (fetched.status === 200) {
    console.log("Gateway fetched order status:", fetched.body.status);
  }
}
```

## Transforms (important schema rule)

Route contract schemas support **top-level** `.transform(...)` chains while preserving HTTP-safe wire schemas.

- ✅ Top-level transform chains are allowed (sync + async)
- ❌ Nested transforms inside object properties are not allowed
- ✅ Invalid nested transforms fail fast at contract construction

Directional behavior:

- Client request input validates against the HTTP-safe/base input schema
- Server handler input receives transformed output
- Server handler return validates against HTTP-safe/base response schema
- Client response parsing applies full response schema (including top-level transforms)

Allowed:

```ts
const routes = createRoutes(shape, {
  ROUTER: {
    transforms: {
      CONTRACT: {
        post: {
          body: {
            contentType: "application/json",
            schema: z
              .object({ name: z.string() })
              .transform(async (input) => ({ name: input.name.trim() }))
              .transform((input) => ({ normalized: input.name.toUpperCase() })),
          },
          responses: {
            200: {
              contentType: "application/json",
              schema: z.object({ message: z.string() }).transform(async (body) => ({
                message: `${body.message}!`,
                id: crypto.randomUUID(),
              })),
            },
          },
        },
      },
    },
  },
});
```

Rejected (nested transform):

```ts
z.object({
  name: z.string().transform((value) => value.trim()), // not allowed
});
```

## Package Surface

Zono exports focused subpath modules:

- `@bobosneefdev/zono/contract` — route contracts + shared contract utilities
- `@bobosneefdev/zono/client` — typed HTTP client
- `@bobosneefdev/zono/server` — server handler and response utilities
- `@bobosneefdev/zono/middleware` — middleware contract utilities
- `@bobosneefdev/zono/hono` — Hono adapter
- `@bobosneefdev/zono/hono-gateway` — Hono gateway composition utilities
- `@bobosneefdev/zono/sveltekit` — SvelteKit adapter

## Examples

- Full end-to-end reference: `src/examples/example.ts`

## License

MIT — see `LICENSE`.
