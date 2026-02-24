import { JSONValue } from "hono/utils/types";
import z from "zod";
import type { EnumValues, PossibleZodOptional } from "~/lib/util.types.js";

export type Contract = {
	responses: ContractResponses;
	pathParams?: z.ZodType<Record<string, string>>;
	body?: z.ZodType;
	query?: ContractQuery;
	headers?: ContractHeaders;
};

export type ContractMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ContractMethodMap<TContract extends Contract = Contract> = Partial<
	Record<ContractMethod, TContract>
>;

export type ContractHeaders = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

export enum JsonContentType {
	JSON = "application/json",
}

export enum TextContentType {
	PLAIN = "text/plain",
	HTML = "text/html",
	CSV = "text/csv",
	XML = "text/xml",
	JS = "text/javascript",
	CSS = "text/css",
}

export enum BytesContentType {
	OCTET_STREAM = "application/octet-stream",
	MSGPACK = "application/x-msgpack",
	PROTOBUF = "application/x-protobuf",
}

export type ContractResponseJson = {
	contentType: JsonContentType | EnumValues<typeof JsonContentType>;
	body: z.ZodType<JSONValue, JSONValue>;
	headers?: ContractHeaders;
};

export type ContractResponseText = {
	contentType: TextContentType | EnumValues<typeof TextContentType>;
	body: z.ZodType<string, string>;
	headers?: ContractHeaders;
};

export type ContractResponseBytes = {
	contentType: BytesContentType | EnumValues<typeof BytesContentType>;
	body: z.ZodType<Uint8Array, Uint8Array>;
	headers?: ContractHeaders;
};

export type ContractResponseContentless = {
	contentType: null;
	body?: undefined;
	headers?: ContractHeaders;
};

export type ContractResponse =
	| ContractResponseJson
	| ContractResponseText
	| ContractResponseBytes
	| ContractResponseContentless;

export type ContractResponses = Record<number, ContractResponse>;

export type ContractQuery = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;
