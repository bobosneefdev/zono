import z from "zod";
import { ZonoEndpoint } from "./classes/endpoint";
import { PossiblyOptionalStringOrNumberSchema, StringNumberBooleanSchema } from "./internal_types";

export type ZonoEndpointHeadersDefinition = z.ZodObject<Record<string, PossiblyOptionalStringOrNumberSchema>>;

export type ZonoEndpointQueryDefinition = z.ZodObject<Record<string, PossiblyOptionalStringOrNumberSchema>>;

export type ZonoEndpointAdditionalPathsDefinition = z.ZodTuple<Array<StringNumberBooleanSchema>>;

export type ZonoEndpointClientOptions = {
    baseUrl: string;
    globalHeaders?: ZonoEndpointHeadersDefinition;
}

export type ZonoEndpointClientCallData<
    T extends ZonoEndpoint,
    U extends ZonoEndpointClientOptions
> = (
    T["definition"]["body"] extends z.ZodType
        ? { body: z.infer<T["definition"]["body"]> }
        : {}
) & (
    T["definition"]["query"] extends z.ZodType
        ? { query: z.infer<T["definition"]["query"]> }
        : {}
) & (
    U["globalHeaders"] extends z.ZodType
        ? { headers: z.infer<U["globalHeaders"]> }
        : {}
) & (
    T["definition"]["headers"] extends z.ZodType
        ? { headers: z.infer<T["definition"]["headers"]> }
        : {}
) & (
    T["definition"]["additionalPaths"] extends z.ZodType
        ? { additionalPaths: z.infer<T["definition"]["additionalPaths"]> }
        : {}
);

export type ZonoSocketDefinition = {
    /** Schemas of events that are emitted from the server */
    serverEvents: Record<string, z.ZodType>;
    /** Schemas of events that are emitted from the client */
    clientEvents: Record<string, z.ZodType>;
};