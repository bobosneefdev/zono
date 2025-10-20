import z from "zod";
import { ZonoEndpoint } from "./classes/endpoint.js";
import { PathHeadersQuerySchema, PossibleZodArray, PossibleZodOptional } from "./internal_types.js";

export type ZonoEndpointHeadersDefinition = z.ZodObject<Record<string, PossibleZodOptional<PathHeadersQuerySchema>>>;

export type ZonoEndpointQueryDefinition = z.ZodObject<Record<string, PossibleZodOptional<PossibleZodArray<PathHeadersQuerySchema>>>>;

export type ZonoEndpointAdditionalPathsDefinition = z.ZodTuple<Array<PathHeadersQuerySchema>>;

export type ZonoEndpointClientOptions = {
    baseUrl: string;
    globalHeaders?: ZonoEndpointHeadersDefinition;
}

export type ZonoEndpointClientCallData<
    T extends ZonoEndpoint,
    U extends ZonoEndpointClientOptions
> = (
    T["definition"]["body"] extends z.ZodType
        ? { body: z.input<T["definition"]["body"]> }
        : {}
) & (
    T["definition"]["query"] extends z.ZodType
        ? { query: z.output<T["definition"]["query"]> }
        : {}
) & (
    U["globalHeaders"] extends z.ZodType
        ? { headers: z.output<U["globalHeaders"]> }
        : {}
) & (
    T["definition"]["headers"] extends z.ZodType
        ? { headers: z.output<T["definition"]["headers"]> }
        : {}
) & (
    T["definition"]["additionalPaths"] extends z.ZodType
        ? { additionalPaths: z.output<T["definition"]["additionalPaths"]> }
        : {}
);

export type ZonoSocketDefinition = {
    /** Schemas of events that are emitted from the server */
    serverEvents: Record<string, z.ZodType>;
    /** Schemas of events that are emitted from the client */
    clientEvents: Record<string, z.ZodType>;
};
