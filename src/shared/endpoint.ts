import { JSONValue } from "hono/utils/types";
import z from "zod";

export type ZonoEndpoint = {
	method: ZonoEndpointMethod;
	path: `/${string}`;
	response: ZonoEndpointResponse;
	body?: ZonoEndpointBody;
	query?: ZonoEndpointQuery;
	headers?: ZonoEndpointHeaders;
	additionalPaths?: ZonoEndpointAdditionalPaths;
};

export type ZonoEndpointMethod = "get" | "post" | "put" | "delete" | "patch";

export type ZonoEndpointRecord = Record<string, ZonoEndpoint>;

export type ZonoEndpointResponse = z.ZodType<JSONValue>;

export type ZonoEndpointBodyOutput = JSONValue;

export type ZonoEndpointBody = z.ZodType<ZonoEndpointBodyOutput>;

export type ZonoEndpointQueryOutput = Partial<Record<string, Array<string>>>;

export type ZonoEndpointQuery = z.ZodType<ZonoEndpointQueryOutput>;

export type ZonoEndpointHeadersOutput = Partial<Record<string, string>>;

export type ZonoEndpointHeaders = z.ZodType<ZonoEndpointHeadersOutput>;

export type ZonoEndpointAdditionalPathsOutput = z.output<ZonoEndpointAdditionalPaths>;

export type ZonoEndpointAdditionalPaths = z.ZodTuple<Array<z.ZodType<string>>, null>;
