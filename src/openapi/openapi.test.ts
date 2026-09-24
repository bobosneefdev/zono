import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { parse } from "yaml";
import z from "zod";
import { defineApi } from "../contract/contract.js";
import { createGatewayService, createGatewayServices, initGateway } from "../gateway/gateway.js";
import { createApiHandlers, initHono } from "../server/server.js";
import { generateGatewayOpenApiYaml, generateServerOpenApiYaml } from "./openapi.js";

const api = defineApi({
	contracts: {
		SHAPE: {
			health: {
				CONTRACT: {
					get: {
						responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
					},
				},
			},
			users: {
				SHAPE: {
					$id: {
						CONTRACT: {
							get: {
								pathParams: z.object({ id: z.string() }),
								responses: {
									200: {
										type: "SuperJSON",
										schema: z.object({ createdAt: z.date() }),
									},
								},
								openapi: { summary: "Get user", operationId: "getUser" },
							},
						},
					},
				},
			},
			docs: {
				CONTRACT: {
					post: {
						body: { type: "JSON", schema: z.object({ name: z.string() }) },
						responses: { 201: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
					},
					head: { responses: { 204: { type: "Contentless" } } },
				},
			},
		},
	},
	middlewares: {
		MIDDLEWARE: {
			auth: { 401: { type: "JSON", schema: z.object({ message: z.string() }) } },
		},
	},
});

const binding = createApiHandlers(api)({
	createContext: () => ({}),
	contracts: {
		SHAPE: {
			health: {
				HANDLER: { get: () => ({ status: 200, type: "JSON", data: { ok: true } }) },
			},
			users: {
				SHAPE: {
					$id: {
						HANDLER: {
							get: () => ({
								status: 200,
								type: "SuperJSON",
								data: { createdAt: new Date(0) },
							}),
						},
					},
				},
			},
			docs: {
				HANDLER: {
					post: () => ({ status: 201, type: "JSON", data: { ok: true } }),
					head: () => ({ status: 204, type: "Contentless", data: undefined }),
				},
			},
		},
	},
	middlewares: {
		MIDDLEWARE: {
			auth: async (_ctx, next) => {
				await next();
			},
		},
	},
});

const services = createGatewayServices({
	users: createGatewayService({
		api,
		mask: { SHAPE: { users: { SHAPE: true } } },
		baseUrl: "http://localhost:12345",
	}),
});

describe("OpenAPI generation", () => {
	test("describes routes, metadata, middleware, and the SuperJSON envelope", () => {
		const doc = parse(generateServerOpenApiYaml(api, { title: "Users", version: "1" }));
		expect(doc.openapi).toBe("3.2.1");
		expect(doc.info).toEqual({ title: "Users", version: "1" });
		const get = doc.paths["/users/{id}"].get;
		expect(get.summary).toBe("Get user");
		expect(get.operationId).toBe("getUser");
		expect(get.parameters[0]).toMatchObject({ name: "id", in: "path", required: true });
		expect(get.responses["401"].content["application/json"]).toBeDefined();
		const responseSchema = get.responses["200"].content["application/json"].schema.$ref;
		const envelope = doc.components.schemas[responseSchema.split("/").at(-1)];
		expect(envelope.required).toContain("json");
		expect(envelope.properties.meta.properties.values).toBeDefined();
		expect(get.responses["500"]).toBeDefined();
		expect(get.responses["404"]).toBeUndefined();
		expect(doc.paths["/docs"].post.requestBody.content["application/json"]).toBeDefined();
	});

	test("gateway includes only masked routes", () => {
		const doc = parse(generateGatewayOpenApiYaml(services, { title: "Gateway", version: "1" }));
		expect(Object.keys(doc.paths)).toEqual(["/users/users/{id}"]);
		expect(doc.paths["/users/docs"]).toBeUndefined();
	});

	test("serves YAML and Swagger UI, and passes HEAD through", async () => {
		const app = new Hono();
		initHono(app, binding, {
			openapi: { yamlPath: "/docs", uiPath: "/ui", title: "Users", version: "1" },
		});
		const yaml = await app.request("/docs");
		expect(yaml.headers.get("content-type")).toContain("application/yaml");
		expect(parse(await yaml.text()).info.title).toBe("Users");
		const ui = await app.request("/ui");
		expect(ui.headers.get("content-type")).toContain("text/html");
		const html = await ui.text();
		expect(html).toContain('url:"/docs"');
		expect(html).toContain("swagger-ui-dist@5.33.0");
		const head = await app.request("/docs", { method: "HEAD" });
		expect(head.status).toBe(204);
	});

	test("gateway serves its own YAML and UI", async () => {
		const app = new Hono();
		initGateway(app, services, {
			openapi: { yamlPath: "/spec.yaml", uiPath: "/api-ui", title: "Gateway", version: "1" },
		});
		expect(
			parse(await (await app.request("/spec.yaml")).text()).paths["/users/users/{id}"],
		).toBeDefined();
		expect(await (await app.request("/api-ui")).text()).toContain('url:"/spec.yaml"');
	});

	test("reports unavailable ordinary JSON Schema conversion", () => {
		const broken = defineApi({
			contracts: {
				CONTRACT: {
					get: {
						responses: {
							200: {
								type: "JSON",
								schema: z.string().transform((value) => value.toUpperCase()),
							},
						},
					},
				},
			},
		});
		expect(() => generateServerOpenApiYaml(broken, { title: "Broken", version: "1" })).toThrow(
			"GET / response 200",
		);
	});

	test("combines response media types and header values at a shared status", () => {
		const collision = defineApi({
			contracts: {
				CONTRACT: {
					get: {
						responses: { 200: { type: "JSON", schema: z.object({ ok: z.boolean() }) } },
					},
				},
			},
			middlewares: { MIDDLEWARE: { cached: { 200: { type: "Text", schema: z.string() } } } },
		});
		const doc = parse(
			generateServerOpenApiYaml(collision, { title: "Collision", version: "1" }),
		);
		const response = doc.paths["/"].get.responses["200"];
		expect(Object.keys(response.content).sort()).toEqual(["application/json", "text/plain"]);
		expect(response.headers["x-zono-response-type"].schema.oneOf).toHaveLength(2);
	});

	test("documents HTTP QUERY and rejects duplicate operation IDs", () => {
		const queryApi = defineApi({
			contracts: {
				CONTRACT: {
					query: {
						body: { type: "JSON", schema: z.object({ q: z.string() }) },
						responses: {
							200: { type: "JSON", schema: z.object({ found: z.boolean() }) },
						},
					},
				},
			},
		});
		const queryDoc = parse(
			generateServerOpenApiYaml(queryApi, { title: "Query", version: "1" }),
		);
		expect(queryDoc.paths["/"].query.requestBody.content["application/json"]).toBeDefined();

		const duplicate = defineApi({
			contracts: {
				CONTRACT: {
					get: {
						responses: { 200: { type: "Contentless" } },
						openapi: { operationId: "duplicate" },
					},
					post: {
						responses: { 204: { type: "Contentless" } },
						openapi: { operationId: "duplicate" },
					},
				},
			},
		});
		expect(() =>
			generateServerOpenApiYaml(duplicate, { title: "Duplicate", version: "1" }),
		).toThrow("Duplicate OpenAPI operationId");
	});
});

const checkOpenApiPathTypes = (): void => {
	const app = new Hono();
	// @ts-expect-error Exact GET route collision
	initHono(app, binding, { openapi: { yamlPath: "/users/$id", title: "T", version: "1" } });
	// @ts-expect-error Static GET route collision
	initHono(app, binding, { openapi: { yamlPath: "/health", title: "T", version: "1" } });
	// @ts-expect-error Dynamic GET route collision
	initHono(app, binding, { openapi: { yamlPath: "/users/example", title: "T", version: "1" } });
	initHono(app, binding, {
		// @ts-expect-error UI collides with YAML endpoint
		openapi: { yamlPath: "/spec", uiPath: "/spec", title: "T", version: "1" },
	});
	initHono(app, binding, {
		// @ts-expect-error UI collides with a dynamic GET route
		openapi: { yamlPath: "/spec", uiPath: "/users/example", title: "T", version: "1" },
	});
	// @ts-expect-error Widened paths cannot be proven free
	initHono(app, binding, { openapi: { yamlPath: "/spec" as string, title: "T", version: "1" } });
	// @ts-expect-error Network-path reference is not an endpoint path
	initHono(app, binding, { openapi: { yamlPath: "//external", title: "T", version: "1" } });
	initGateway(app, services, {
		// @ts-expect-error Gateway GET route collision
		openapi: { yamlPath: "/users/users/example", title: "T", version: "1" },
	});
	initGateway(app, services, { openapi: { yamlPath: "/users/docs", title: "T", version: "1" } });
};
void checkOpenApiPathTypes;
