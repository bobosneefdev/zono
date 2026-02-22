import { expect, test } from "bun:test";
import z from "zod";
import { ZonoContractMethod } from "~/contract/enums.js";
import { createZonoContract, createZonoRouter } from "~/contract/factory.js";

test("createZonoContract successfully creates a contract", () => {
	const contract = createZonoContract("/:id", {
		method: ZonoContractMethod.GET,
		responses: {
			"200": {
				body: z.object({
					name: z.string(),
					age: z.number().int(),
				}),
			},
		},
		pathParams: z.object({
			id: z.string(),
		}),
	});

	expect(contract.path).toBe("/:id");
	expect(contract.method).toBe(ZonoContractMethod.GET);
});

test("createZonoRouter successfully creates a router", () => {
	const router = createZonoRouter({
		users: {
			get: createZonoContract("/:id", {
				method: ZonoContractMethod.GET,
				responses: {},
				pathParams: z.object({
					id: z.string(),
				}),
			}),
		},
	});

	expect(router.users.get.path).toBe("/:id");
});

test("createZonoContract works for all HTTP methods", () => {
	const methods = [
		ZonoContractMethod.POST,
		ZonoContractMethod.PUT,
		ZonoContractMethod.DELETE,
		ZonoContractMethod.PATCH,
		ZonoContractMethod.OPTIONS,
		ZonoContractMethod.HEAD,
	] as const;

	for (const method of methods) {
		const contract = createZonoContract("", {
			method,
			responses: {},
		});
		expect(contract.method).toBe(method);
	}
});

test("createZonoContract on a static route preserves body, query, and headers", () => {
	const bodySchema = z.object({ name: z.string() });
	const querySchema = z.object({ search: z.string().optional() });
	const headersSchema = z.object({ authorization: z.string() });

	const contract = createZonoContract("", {
		method: ZonoContractMethod.POST,
		responses: {
			201: { body: z.object({ id: z.string() }) },
		},
		body: bodySchema,
		query: querySchema,
		headers: headersSchema,
	});

	expect(contract.path).toBe("");
	expect(contract.body).toBe(bodySchema);
	expect(contract.query).toBe(querySchema);
	expect(contract.headers).toBe(headersSchema);
});

test("createZonoRouter preserves deeply-nested sub-routers", () => {
	const router = createZonoRouter({
		api: {
			v1: {
				users: {
					list: createZonoContract("", {
						method: ZonoContractMethod.GET,
						responses: {},
					}),
					detail: createZonoContract("/:id", {
						method: ZonoContractMethod.GET,
						responses: {},
						pathParams: z.object({ id: z.string() }),
					}),
				},
			},
		},
	});

	expect(router.api.v1.users.list.path).toBe("");
	expect(router.api.v1.users.detail.path).toBe("/:id");
	expect(router.api.v1.users.detail.method).toBe(ZonoContractMethod.GET);
});

test("createZonoContract preserves the responses object by reference", () => {
	const responseSpec = {
		200: { body: z.object({ id: z.string() }) },
		404: { body: z.object({ error: z.string() }) },
	};

	const contract = createZonoContract("/:id", {
		method: ZonoContractMethod.GET,
		responses: responseSpec,
		pathParams: z.object({ id: z.string() }),
	});

	expect(contract.responses).toBe(responseSpec);
});

test("createZonoContract attaches the exact pathParams schema instance", () => {
	const pathSchema = z.object({ id: z.string(), slug: z.string() });

	const contract = createZonoContract("/:id/:slug", {
		method: ZonoContractMethod.GET,
		responses: {},
		pathParams: pathSchema,
	});

	expect(contract.pathParams).toBe(pathSchema);
});

test("createZonoContract does not attach pathParams on a static route", () => {
	const contract = createZonoContract("", {
		method: ZonoContractMethod.GET,
		responses: {},
	});

	// pathParams should be undefined/absent on a route with no dynamic segments
	expect((contract as any).pathParams).toBeUndefined();
});
