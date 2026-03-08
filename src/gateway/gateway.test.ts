import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import z from "zod";
import type { Contracts } from "../contract/contract.types.js";
import type { Middlewares } from "../middleware/middleware.types.js";
import { createSerializedResponse, parseSerializedResponse } from "../shared/shared.js";
import type { Shape } from "../shared/shared.types.js";
import {
	createGatewayClient,
	createGatewayService,
	createGatewayServices,
	initGateway,
} from "./gateway.js";
import type { GatewayServiceShape } from "./gateway.types.js";

const servers: Array<{ stop: () => void }> = [];

const startServer = (app: Hono): string => {
	const server = Bun.serve({ fetch: app.fetch, port: 0 });
	servers.push(server);
	return `http://localhost:${server.port}`;
};

afterEach(() => {
	while (servers.length > 0) {
		servers.pop()?.stop();
	}
});

const serviceShape = {
	SHAPE: {
		echo: { CONTRACT: true },
	},
} as const satisfies Shape;

const serviceContracts = {
	SHAPE: {
		echo: {
			CONTRACT: {
				get: {
					responses: {
						200: {
							type: "JSON",
							body: z.object({ query: z.string(), header: z.string() }),
						},
					},
				},
				post: {
					responses: {
						201: { type: "Text", body: z.string() },
					},
				},
			},
		},
	},
} as const satisfies Contracts<typeof serviceShape>;

const serviceMiddlewares = {
	MIDDLEWARE: {},
} as const satisfies Middlewares<typeof serviceShape>;

describe("gateway runtime", () => {
	test("proxies GET to upstream and preserves status headers serialized body", async () => {
		const upstreamApp = new Hono();
		upstreamApp.get("/echo", (ctx) => {
			return createSerializedResponse({
				status: 200,
				type: "JSON",
				source: "contract",
				headers: { "x-upstream": "1" },
				data: {
					query: ctx.req.query("q") ?? "",
					header: ctx.req.header("x-test") ?? "",
				},
			});
		});

		const upstreamUrl = startServer(upstreamApp);
		const gatewayShape = {
			SHAPE: {
				echo: { CONTRACT: true },
			},
		} as const satisfies GatewayServiceShape<typeof serviceShape>;
		const service = createGatewayService(
			gatewayShape,
			serviceContracts,
			serviceMiddlewares,
			"public",
			upstreamUrl,
		);

		const gatewayApp = new Hono();
		initGateway(gatewayApp, createGatewayServices({ service }));
		const response = await fetch(`${startServer(gatewayApp)}/echo?q=abc`, {
			headers: { "x-test": "ok" },
		});
		const parsed = await parseSerializedResponse(response);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-upstream")).toBe("1");
		expect(parsed.source).toBe("contract");
		expect(parsed.data).toEqual({ query: "abc", header: "ok" });
	});

	test("forwards POST body", async () => {
		const upstreamApp = new Hono();
		upstreamApp.post("/echo", async (ctx) => {
			const body = await ctx.req.text();
			return createSerializedResponse({
				status: 201,
				type: "Text",
				source: "contract",
				data: `body:${body}`,
			});
		});

		const service = createGatewayService(
			{ SHAPE: { echo: { CONTRACT: true } } },
			serviceContracts,
			serviceMiddlewares,
			"public",
			startServer(upstreamApp),
		);
		const gatewayApp = new Hono();
		initGateway(gatewayApp, createGatewayServices({ service }));
		const gatewayUrl = startServer(gatewayApp);

		const post = await fetch(`${gatewayUrl}/echo`, {
			method: "POST",
			body: "hello",
			headers: { "content-type": "text/plain" },
		});
		const parsedPost = await parseSerializedResponse(post);
		expect(post.status).toBe(201);
		expect(parsedPost.type).toBe("Text");
		expect(parsedPost.data).toBe("body:hello");
	});

	test("createGatewayClient caches service clients", () => {
		const gatewayClient =
			createGatewayClient<
				ReturnType<
					typeof createGatewayServices<{ users: ReturnType<typeof createGatewayService> }>
				>
			>("http://localhost:9999");

		const first = gatewayClient.users;
		const second = gatewayClient.users;
		expect(first).toBe(second);
	});
});

const gatewayShapeTyped = {
	SHAPE: {
		echo: { CONTRACT: true },
	},
} as const satisfies GatewayServiceShape<typeof serviceShape>;
void gatewayShapeTyped;

const typeOnly = (_cb: () => void): void => {};

typeOnly(() => {
	const service = createGatewayService(
		{ SHAPE: { echo: { CONTRACT: true } } },
		serviceContracts,
		serviceMiddlewares,
		"public",
		"http://localhost",
	);
	const services = createGatewayServices({ users: service });
	const client = createGatewayClient<typeof services>("http://localhost");

	void client.users.fetch("/echo", "get");

	// @ts-expect-error invalid path for service contracts
	void client.users.fetch("/missing", "get");

	// @ts-expect-error method not defined on route
	void client.users.fetch("/echo", "put");
});
