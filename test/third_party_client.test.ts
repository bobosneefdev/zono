import z from "zod";
import { ZonoEndpoint, ZonoEndpointAny, ZonoEndpointClient } from "../src/classes/endpoint";
import { ZonoClient } from "../src/classes/client";

const BASE_URL = "https://web.pirateswap.com";

export const THIRD_PARTY_API = {
    getInventory: new ZonoEndpoint({
        method: "get",
        path: "/inventory/ExchangerInventory",
        response: z.object({
            items: z.array(z.object({
                /** Identical format to our uniformName */
                marketHashName: z.string(),
                marketNameHashCode: z.number().int(),
                float: z.number().positive().lt(1).nullable(),
                pattern: z.number().int().nullable(),
                /** Balance dollars */
                price: z.number(),
                inspectInGameLink: z.string(),
                keyChains: z
                    .array(
                        z.object({
                            /** missing prefix */
                            name: z.string(),
                        }),
                    )
                    .nullable(),
                stickers: z.array(
                    z.object({
                        /** missing prefix */
                        name: z.string(),
                    }),
                ),
                paintIndex: z.number().int().nullable(),
                tradeableAfter: z.iso.datetime(),
            })),
        }),
        query: z.object({
            orderBy: z.enum(["price"]),
            sortOrder: z.enum(["DESC", "ASC"]),
            page: z.number().int().min(1),
            results: z.literal(100),
            onlyTradeLocked: z.boolean().optional(),
        }),
    }),
} satisfies Record<string, ZonoEndpointAny>;

const CLIENT = new ZonoClient(THIRD_PARTY_API, { baseUrl: BASE_URL }).build();

describe(
    "Third Party Client",
    () => {
        it("GET /inventory/ExchangerInventory", async () => {
            const response = await CLIENT.getInventory({
                query: {
                    page: 1,
                    orderBy: "price",
                    results: 100,
                    sortOrder: "DESC",
                    onlyTradeLocked: false,
                },
            });
            expect(response.data.items.length).toBe(100);
        })
    },
)