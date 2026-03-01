import z from "zod";
import type { JsonValue, RouteContractSchema } from "~/internal/util.types.js";

type EnumValues<T extends Record<string, string>> = `${T[keyof T]}`;
type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

/**
 * Defines the contract for a single HTTP endpoint including request/response schemas.
 */
export type Contract = {
	responses: ContractResponses;
	body?: ContractBody;
	query?: ContractQuery;
	headers?: ContractHeaders;
	pathParams?: ContractPathParams;
};

/** Map of HTTP status codes to their response definitions */
export type ContractResponses = Record<number, ContractResponse>;

/** A single response definition with optional headers and body schema */
export type ContractResponse = { headers?: ContractHeaders } & (
	| ContractJsonResponse
	| ContractTextResponse
	| ContractBytesResponse
	| ContractResponseContentless
);

/** Content types for JSON responses */
export enum JsonContentType {
	JSON = "application/json",
}

/** JSON response definition with schema */
export type ContractJsonResponse = {
	contentType: EnumValues<typeof JsonContentType>;
	schema: RouteContractSchema<z.ZodType<JsonValue, JsonValue>>;
};

/** Content types for text responses */
export enum TextContentType {
	PLAIN = "text/plain",
	HTML = "text/html",
	CSV = "text/csv",
	XML = "text/xml",
	JS = "text/javascript",
	CSS = "text/css",
}

/** Text response definition with string schema */
export type ContractTextResponse = {
	contentType: EnumValues<typeof TextContentType>;
	schema: RouteContractSchema<z.ZodType<string, string>>;
};

/** Content types for binary responses */
export enum BytesContentType {
	OCTET_STREAM = "application/octet-stream",
	MSGPACK = "application/x-msgpack",
	PROTOBUF = "application/x-protobuf",
}

/** Binary response definition with Uint8Array schema */
export type ContractBytesResponse = {
	contentType: EnumValues<typeof BytesContentType>;
	schema: RouteContractSchema<z.ZodType<Uint8Array, Uint8Array>>;
};

/** Content types for form data request bodies */
export enum FormDataContentType {
	FORM_DATA = "multipart/form-data",
	FORM_URLENCODED = "application/x-www-form-urlencoded",
}

/** Form data request body definition */
export type ContractFormDataBody = {
	contentType: EnumValues<typeof FormDataContentType>;
	schema: RouteContractSchema<z.ZodType<FormData, FormData>>;
};

/** Response with no body content (e.g., 204 No Content) */
export type ContractResponseContentless = {
	contentType: null;
	schema?: undefined;
};

/** JSON request body definition */
export type ContractJsonBody = {
	contentType: EnumValues<typeof JsonContentType>;
	schema: RouteContractSchema<z.ZodType<JsonValue, JsonValue>>;
};

/** Text request body definition */
export type ContractTextBody = {
	contentType: EnumValues<typeof TextContentType>;
	schema: RouteContractSchema<z.ZodType<string, string>>;
};

/** Binary request body definition */
export type ContractBytesBody = {
	contentType: EnumValues<typeof BytesContentType>;
	schema: RouteContractSchema<z.ZodType<Uint8Array, Uint8Array>>;
};

/** Union of all possible request body types */
export type ContractBody =
	| ContractJsonBody
	| ContractTextBody
	| ContractBytesBody
	| ContractFormDataBody;

/** Supported HTTP methods */
export type ContractMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

/** Map of HTTP methods to their contract definitions */
export type ContractMethodMap<TContract extends Contract = Contract> = Partial<
	Record<ContractMethod, TContract>
>;

/** Union of query parameter types (standard or JSON-encoded) */
export type ContractQuery = ContractQueryStandard | ContractQueryJson;

/** JSON-encoded query parameters */
export type ContractQueryJson = {
	type: "json";
	schema: RouteContractSchema<z.ZodType<JsonValue, JsonValue>>;
};

/** Standard URL query parameters */
export type ContractQueryStandard = {
	type: "standard";
	schema: RouteContractSchema<z.ZodType<Record<string, ContractQueryStandardValue>>>;
};

/** Valid values for standard query parameters */
export type ContractQueryStandardValue = string | Array<string> | undefined;

/** Request headers schema using Zod object */
export type ContractHeaders = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

/** URL path parameters schema */
export type ContractPathParams = RouteContractSchema<
	z.ZodType<Record<string, string>, Record<string, string>>
>;

/** Extracts valid response status codes from a contract */
export type ContractResponseStatuses<TContract extends Contract> = Extract<
	keyof TContract["responses"],
	number
>;

/** A node in the router shape tree - either a contract endpoint or nested router */
export type ShapeNode = {
	CONTRACT?: true;
	ROUTER?: Record<string, ShapeNode>;
};

/** Root router shape defining the structure of route contracts */
export type RouterShape = {
	ROUTER: Record<string, ShapeNode>;
};
