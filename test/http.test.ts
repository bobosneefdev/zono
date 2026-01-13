import z from "zod";
import { createZonoEndpointClientSuite } from "../src/client.js";
import {
	createZonoHttpServerMiddlewareHeaders,
	ZonoEndpointConvertersRecord,
	ZonoHttpServer,
	ZonoHttpServerHandlers,
} from "../src/server.js";
import { ZonoEndpointHeaders, ZonoEndpointRecord } from "../src/shared.js";

const PORT = 3000;

const KEY = "1234567890";

const ENDPOINTS = {
	basicGet: {
		method: "get",
		path: "/people",
		response: z.object({
			success: z.boolean(),
		}),
		additionalPaths: z.tuple([
			z.enum(["Bob", "Douglas", "Jeremy"]),
			z.enum({
				Value1: "1",
				Value2: "2",
				Value3: "3",
			}),
		]),
	},
	basicPost: {
		method: "post",
		path: "/people",
		response: z.object({
			success: z.boolean(),
		}),
		body: z.object({
			firstName: z.enum(["Bob", "Douglas", "Jeremy"]),
			lastName: z.enum(["Smith", "Jones", "Williams"]),
		}),
		headers: z.object({
			"x-api-key": z.literal(KEY),
		}),
	},
	nonStringQuery: {
		method: "get",
		path: "/nonStringQuery",
		response: z.object({
			success: z.boolean(),
		}),
		query: z.object({
			date: z.tuple([z.date().transform(String)]),
		}),
	},
	nonStringHeader: {
		method: "get",
		path: "/nonStringHeader",
		headers: z.object({
			"numerical-header": z.number().transform(String),
		}),
		response: z.object({
			success: z.boolean(),
		}),
	},
} as const satisfies ZonoEndpointRecord;

const ENDPOINT_HANDLERS: ZonoHttpServerHandlers<typeof ENDPOINTS> = {
	basicGet() {
		return {
			success: true,
			status: 200,
			data: {
				success: true,
			},
		};
	},
	basicPost() {
		return {
			success: true,
			status: 200,
			data: {
				success: true,
			},
		};
	},
	nonStringQuery(request) {
		return {
			success: true,
			status: 200,
			data: {
				success: !Number.isNaN(new Date(request.query.date[0]).getTime()),
			},
		};
	},
	nonStringHeader() {
		return {
			success: true,
			status: 200,
			data: {
				success: true,
			},
		};
	},
};

const zMiddlewareHeaders = z.object({
	/** Ensure that header keys are always lowercase! */
	authorization: z.number().transform(String),
}) satisfies ZonoEndpointHeaders;

const ENDPOINT_CONVERTERS: ZonoEndpointConvertersRecord<typeof ENDPOINTS> = {
	nonStringHeader: {
		headers(data) {
			return {
				"numerical-header": Number(data["numerical-header"]),
			};
		},
	},
	nonStringQuery: {
		query(data) {
			return {
				date: [new Date(data.date[0])],
			};
		},
	},
};

const SERVER = new ZonoHttpServer(
	ENDPOINTS,
	{
		bind: "0.0.0.0",
		port: PORT,
		basePath: "/v1",
		handlers: ENDPOINT_HANDLERS,
		converters: ENDPOINT_CONVERTERS,
		middlewareHeaders: createZonoHttpServerMiddlewareHeaders(zMiddlewareHeaders, {
			converter(input) {
				return {
					authorization: Number(input.authorization),
				};
			},
		}),
	},
	{
		openApiOptions: {
			title: "Test API",
			path: "/docs",
			version: "1.0.0",
			descriptions: {
				basicGet: { description: "This is just a test endpoint" },
			},
		},
		middleware: [
			async (ctx, next, headers) => {
				if (headers.authorization !== KEY) {
					console.log(headers);
					return ctx.json(
						{
							error: "Unauthorized",
						},
						401,
					);
				}
				await next();
				return undefined;
			},
		],
	},
);

const CLIENT = createZonoEndpointClientSuite(ENDPOINTS, {
	baseUrl: `http://localhost:${PORT}/v1`,
	middlewareHeaders: zMiddlewareHeaders,
});

describe("Local HTTP Server/Client", () => {
	beforeAll(async () => {
		SERVER.start();
	});

	afterAll(async () => {
		await SERVER.stop(true);
	});

	it("GET getPeople endpoint", async () => {
		const response = await CLIENT.basicGet.fetch({
			additionalPaths: ["Bob", "2"],
			middlewareHeaders: {
				authorization: Number(KEY),
			},
		});
		if (response.success) {
			expect(response.data.success).toBe(true);
		} else {
			const json = await response.response.json();
			console.error(response, json);
		}
		expect(response.success).toBe(true);
	});

	it("POST postPeople endpoint", async () => {
		const response = await CLIENT.basicPost.fetch({
			body: {
				firstName: "Bob",
				lastName: "Williams",
			},
			headers: {
				"x-api-key": KEY,
			},
			middlewareHeaders: {
				authorization: Number(KEY),
			},
		});
		if (response.success) {
			expect(response.data.success).toBe(true);
		} else {
			const json = await response.response.json();
			console.error(response, json);
		}
		expect(response.success).toBe(true);
	});

	it("GET nonStringQuery endpoint", async () => {
		const response = await CLIENT.nonStringQuery.fetch({
			query: {
				date: [new Date()],
			},
			middlewareHeaders: {
				authorization: Number(KEY),
			},
		});

		if (response.success) {
			expect(response.data.success).toBe(true);
		} else {
			const json = await response.response.json();
			console.error(response, json);
		}

		expect(response.success).toBe(true);
	});

	it("GET nonStringHeader endpoint", async () => {
		const response = await CLIENT.nonStringHeader.fetch({
			middlewareHeaders: {
				authorization: Number(KEY),
			},
			headers: {
				"numerical-header": 1,
			},
		});

		if (response.success) {
			expect(response.data.success).toBe(true);
		} else {
			const json = await response.response.json();
			console.error(response, json);
		}

		expect(response.success).toBe(true);
	});
});
