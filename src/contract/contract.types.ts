import { JSONValue } from "hono/utils/types";
import z from "zod";
import type { EnumValues, PossibleZodOptional } from "~/lib/util.types.js";

export type Contract = {
	responses: ContractResponses;
	payload?: ContractPayload;
	query?: ContractQuery;
	headers?: ContractHeaders;
	pathParams?: ContractPathParams;
};

export type ContractResponses = Record<number, ContractResponse>;

export type ContractResponse = { headers?: ContractHeaders } & (
	| ContractJsonBody
	| ContractTextBody
	| ContractBytesBody
	| ContractResponseContentless
);

export enum JsonContentType {
	JSON = "application/json",
}

export type ContractJsonBody = {
	contentType: EnumValues<typeof JsonContentType>;
	schema: z.ZodType<JSONValue, JSONValue>;
};

export enum TextContentType {
	PLAIN = "text/plain",
	HTML = "text/html",
	CSV = "text/csv",
	XML = "text/xml",
	JS = "text/javascript",
	CSS = "text/css",
}

export type ContractTextBody = {
	contentType: EnumValues<typeof TextContentType>;
	schema: z.ZodType<string, string>;
};

export enum BytesContentType {
	OCTET_STREAM = "application/octet-stream",
	MSGPACK = "application/x-msgpack",
	PROTOBUF = "application/x-protobuf",
}

export type ContractBytesBody = {
	contentType: EnumValues<typeof BytesContentType>;
	schema: z.ZodType<Uint8Array, Uint8Array>;
};

export enum FormDataContentType {
	FORM_DATA = "multipart/form-data",
	FORM_URLENCODED = "application/x-www-form-urlencoded",
}

export type ContractFormDataBody = {
	contentType: EnumValues<typeof FormDataContentType>;
	schema: z.ZodType<FormData, FormData>;
};

export type ContractResponseContentless = {
	contentType: null;
	schema?: undefined;
};

export type ContractPayload =
	| ContractJsonBody
	| ContractTextBody
	| ContractBytesBody
	| ContractFormDataBody;

export type ContractMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ContractMethodMap<TContract extends Contract = Contract> = Partial<
	Record<ContractMethod, TContract>
>;

export type ContractQuery = ContractQueryStandard | ContractQueryJson;

export type ContractQueryJson = {
	type: "json";
	schema: z.ZodType<JSONValue, JSONValue>;
};

export type ContractQueryStandard = {
	type: "standard";
	schema: z.ZodType<Record<string, ContractQueryStandardValue>>;
};

export type ContractQueryStandardValue = PossibleZodOptional<
	z.ZodType<string, string> | z.ZodType<Array<string>, Array<string>>
>;

export type ContractHeaders = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

export type ContractPathParams = z.ZodType<Record<string, string>, Record<string, string>>;
