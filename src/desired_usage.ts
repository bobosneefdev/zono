// NOT A MODULE, JUST A SANDBOX FOR TESTING AS I DEVELOP

import z from "zod";
import { createRouter } from "./contract.js";

const zUser = z.null(); // example/placeholder schema
const zFilter = z.null(); // example/placeholder schema

const _router = createRouter(
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
										// TODO: add content type to contract responses, if contentType is not null, then body is a required key with z.ZodType as value
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
												// TODO: add content type to contract responses, if contentType is not null, then body is a required key with z.ZodType as value
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
												// TODO: if contentType is null, then body is an optional key with undefined value
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
