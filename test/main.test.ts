import z from "zod";
import { ZonoEndpoint, ZonoEndpointAny } from "../src/classes/endpoint";

const ENDPOINTS = {
    test: new ZonoEndpoint({
        method: "get",
        path: "/items",
        response: z.null(),
        additionalPaths: z.tuple([
            z.enum(["skins", "cases"]),
            z.string(),
        ]),
    })
} satisfies Record<string, ZonoEndpointAny>;