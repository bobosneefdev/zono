import z from "zod";
import { ZonoEndpointHeadersDefinition } from "../lib_types.js";
import { PossiblyOptionalPathHeadersQuerySchema } from "../internal_types.js";

/**
 * @param schemas Array of schemas. Higher index schemas will override lower index schemas.
 * @returns Combined schema
 */
export function combineHeadersSchema(schemas: Array<ZonoEndpointHeadersDefinition | undefined>): ZonoEndpointHeadersDefinition | undefined {
    const shape: Record<string, PossiblyOptionalPathHeadersQuerySchema> = {};
    let anyPopulated = false;
    for (const schema of schemas) {
        if (!schema) continue;
        anyPopulated = true;
        for (const [key, value] of Object.entries(schema.shape)) {
            shape[key] = value;
        }
    }
    return anyPopulated ? z.object(shape) : undefined;
}