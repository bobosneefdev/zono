import z from "zod";
import { ZonoEndpointAdditionalPathsDefinition, ZonoEndpointHeadersDefinition, ZonoEndpointQueryDefinition } from "../lib_types";

export class ZonoEndpoint<T extends ZonoEndpointDefinition = ZonoEndpointDefinition> {
    readonly definition: T;
    readonly path: `/${string}`;

    constructor(definition: T) {
        this.definition = definition;
        this.path = this.createPath(definition);
    }

    private createPath(definition: T): `/${string}` {
        let path = definition.path;

        if (definition.additionalPaths) {
            const pathParts = definition.additionalPaths?._zod.def.items ?? [];
            for (let i = 0; i < pathParts.length; i++) {
                path += `/:${i}`;
            }
        }
        
        return path;
    }
}

export type ZonoEndpointRecord<T extends Record<string, ZonoEndpoint> = Record<string, ZonoEndpoint>> = T;

export type ZonoEndpointDefinition = {
    method: "get" | "post" | "put" | "delete" | "patch";
    path: `/${string}`;
    body?: z.ZodType;
    query?: ZonoEndpointQueryDefinition;
    headers?: ZonoEndpointHeadersDefinition;
    additionalPaths?: ZonoEndpointAdditionalPathsDefinition;
    response: z.ZodType;
}