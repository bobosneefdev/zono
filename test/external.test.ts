import z from "zod";
import { ZonoEndpoint, ZonoEndpointRecord } from "../src/classes/endpoint";
import { createZonoEndpointClientSuite } from "../src/lib_util/create_endpoint_client_suite";

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
                inspectInGameLink: z.string().nullable(),
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
                tradeableAfter: z.iso.datetime().optional(),
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
} satisfies ZonoEndpointRecord;

const CLIENT = createZonoEndpointClientSuite(THIRD_PARTY_API, { baseUrl: BASE_URL });

describe(
    "Third Party Client",
    () => {
        it("GET /inventory/ExchangerInventory", async () => {
            const response = await CLIENT.getInventory.axios({
                query: {
                    page: 1,
                    orderBy: "price",
                    results: 100,
                    sortOrder: "DESC",
                    onlyTradeLocked: false,
                },
            });
            if (response.success) {
                expect(response.data.items.length).toBe(100);
            }
            else {
                console.error(response);
            }
            expect(response.success).toBe(true);
        });
    },
)