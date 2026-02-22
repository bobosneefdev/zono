import z from "zod";
import { createZonoClient } from "./dist/client.js";
import { createZonoContract, createZonoRouter, ZonoContractMethod } from "./dist/contract.js";
import { initZonoServer } from "./dist/hono.js";

const router = createZonoRouter({
	users: createZonoContract("/:id", {
		method: ZonoContractMethod.GET,
		pathParams: z.object({
			id: z.string(),
		}),
		responses: {
			200: {
				body: z.object({
					id: z.string(),
					name: z.string(),
					age: z.number().int(),
				}),
				headers: z.object({
					test: z.string(),
				}),
			},
		},
	}),
});

const server = initZonoServer(
	{
		port: 8080,
		bind: "0.0.0.0",
	},
	router,
	{
		users: async ({ pathParams }) => {
			return {
				status: 200,
				data: {
					id: pathParams.id,
					name: "John Doe",
					age: 21,
				},
				headers: {
					test: "asdf",
				},
			};
		},
	},
);

server.start();

const client = createZonoClient(router, {
	baseUrl: "http://localhost:8080",
	defaultHeaders: {
		Authorization: () => "Bearer 123",
	},
});

const _resp = await client.users({
	pathParams: {
		id: "123",
	},
});
