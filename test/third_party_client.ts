import z from "zod";
import { ZonoEndpoint, ZonoEndpointClient } from "../src/classes/endpoint";
import { ZonoClient } from "../src/classes/client";

const BASE_URL = "https://web.pirateswap.com";

export const thirdPartyApi = {
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
};

const client = new ZonoClient(thirdPartyApi, {
    baseUrl: BASE_URL,
    globalHeaders: z.object({
        Authorization: z.string(),
    }),
}).build();

client.getInventory(
    {
        headers: {
            Authorization: "",
        },
        query: {
            orderBy: "price",
            sortOrder: "DESC",
            page: 1,
            results: 100,
            onlyTradeLocked: false,
        },
    },
);