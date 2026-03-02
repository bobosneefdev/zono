import type { SuperJSONValue } from "superjson";
import z from "zod";
import type { JsonValue } from "~/internal/util.types.js";

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

/** A single response definition with optional headers */
export type ContractResponse = { headers?: ContractHeaders } & (
	| { type: "JSON"; schema: z.ZodType<JsonValue, JsonValue> }
	| { type: "SuperJSON"; schema: z.ZodType<SuperJSONValue, SuperJSONValue> }
	| { type: "Text"; schema: z.ZodType<string, string> }
	| { type: "Blob"; schema: z.ZodType<Blob, Blob> }
	| { type: "ArrayBuffer"; schema: z.ZodType<ArrayBuffer, ArrayBuffer> }
	| { type: "FormData"; schema: z.ZodType<FormData, FormData> }
	| { type: "ReadableStream"; schema: z.ZodType<ReadableStream, ReadableStream> }
	| { type: "Void"; schema?: undefined }
);

/** JSON request body definition */
export type ContractBodyJSON = {
	type: "JSON";
	schema: z.ZodType<JsonValue, JsonValue>;
};

/** SuperJSON request body definition */
export type ContractBodySuperJSON = {
	type: "SuperJSON";
	schema: z.ZodType<SuperJSONValue, SuperJSONValue>;
};

/** String (text/plain) request body definition */
export type ContractBodyString = {
	type: "String";
	schema: z.ZodType<string, string>;
};

/** URLSearchParams request body definition */
export type ContractBodyURLSearchParams = {
	type: "URLSearchParams";
	schema: z.ZodType<URLSearchParams, URLSearchParams>;
};

/** FormData request body definition */
export type ContractBodyFormData = {
	type: "FormData";
	schema: z.ZodType<FormData, FormData>;
};

/** Blob request body definition */
export type ContractBodyBlob = {
	type: "Blob";
	schema: z.ZodType<Blob, Blob>;
};

/** Uint8Array (binary) request body definition */
export type ContractBodyUint8Array = {
	type: "Uint8Array";
	schema: z.ZodType<Uint8Array, Uint8Array>;
};

/** Union of all possible request body types */
export type ContractBody =
	| ContractBodyJSON
	| ContractBodySuperJSON
	| ContractBodyString
	| ContractBodyURLSearchParams
	| ContractBodyFormData
	| ContractBodyBlob
	| ContractBodyUint8Array;

/** Supported HTTP methods */
export type ContractMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

/** Map of HTTP methods to their contract definitions */
export type ContractMethodMap<TContract extends Contract = Contract> = Partial<
	Record<ContractMethod, TContract>
>;

/** Standard URL query parameters (string or string array values) */
export type ContractQueryStandard = {
	type: "Standard";
	schema: z.ZodType<
		Record<string, string | Array<string> | undefined>,
		Record<string, string | Array<string> | undefined>
	>;
};

/** SuperJSON-encoded query parameters (supports Dates, Maps, Sets, etc.) */
export type ContractQuerySuperJSON = {
	type: "SuperJSON";
	schema: z.ZodType<Record<string, SuperJSONValue>, Record<string, SuperJSONValue>>;
};

/** Union of query parameter types */
export type ContractQuery = ContractQueryStandard | ContractQuerySuperJSON;

/** Standard HTTP headers (string values only) */
export type ContractHeadersStandard = {
	type: "Standard";
	schema: z.ZodType<Record<string, string>, Record<string, string>>;
};

/** SuperJSON-encoded headers (supports complex values via x-zono-superjson-headers) */
export type ContractHeadersSuperJSON = {
	type: "SuperJSON";
	schema: z.ZodType<Record<string, SuperJSONValue>, Record<string, SuperJSONValue>>;
};

/** Union of header types */
export type ContractHeaders = ContractHeadersStandard | ContractHeadersSuperJSON;

/** URL path parameters schema */
export type ContractPathParams = z.ZodType<Record<string, string>, Record<string, string>>;

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
