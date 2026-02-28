import z from "zod";
import type { JsonValue, RouteContractSchema } from "~/internal/util.types.js";

type EnumValues<T extends Record<string, string>> = `${T[keyof T]}`;
type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

export type Contract = {
	responses: ContractResponses;
	body?: ContractBody;
	query?: ContractQuery;
	headers?: ContractHeaders;
	pathParams?: ContractPathParams;
};

export type ContractResponses = Record<number, ContractResponse>;

export type ContractResponse = { headers?: ContractHeaders } & (
	| ContractJsonResponse
	| ContractTextResponse
	| ContractBytesResponse
	| ContractResponseContentless
);

export enum JsonContentType {
	JSON = "application/json",
}

export type ContractJsonResponse = {
	contentType: EnumValues<typeof JsonContentType>;
	schema: RouteContractSchema<z.ZodType<JsonValue, JsonValue>>;
};

export enum TextContentType {
	PLAIN = "text/plain",
	HTML = "text/html",
	CSV = "text/csv",
	XML = "text/xml",
	JS = "text/javascript",
	CSS = "text/css",
}

export type ContractTextResponse = {
	contentType: EnumValues<typeof TextContentType>;
	schema: RouteContractSchema<z.ZodType<string, string>>;
};

export enum BytesContentType {
	OCTET_STREAM = "application/octet-stream",
	MSGPACK = "application/x-msgpack",
	PROTOBUF = "application/x-protobuf",
}

export type ContractBytesResponse = {
	contentType: EnumValues<typeof BytesContentType>;
	schema: RouteContractSchema<z.ZodType<Uint8Array, Uint8Array>>;
};

export enum FormDataContentType {
	FORM_DATA = "multipart/form-data",
	FORM_URLENCODED = "application/x-www-form-urlencoded",
}

export type ContractFormDataBody = {
	contentType: EnumValues<typeof FormDataContentType>;
	schema: RouteContractSchema<z.ZodType<FormData, FormData>>;
};

export type ContractResponseContentless = {
	contentType: null;
	schema?: undefined;
};

export type ContractJsonBody = {
	contentType: EnumValues<typeof JsonContentType>;
	schema: RouteContractSchema<z.ZodType<JsonValue, JsonValue>>;
};

export type ContractTextBody = {
	contentType: EnumValues<typeof TextContentType>;
	schema: RouteContractSchema<z.ZodType<string, string>>;
};

export type ContractBytesBody = {
	contentType: EnumValues<typeof BytesContentType>;
	schema: RouteContractSchema<z.ZodType<Uint8Array, Uint8Array>>;
};

export type ContractBody =
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
	schema: RouteContractSchema<z.ZodType<JsonValue, JsonValue>>;
};

export type ContractQueryStandard = {
	type: "standard";
	schema: RouteContractSchema<z.ZodType<Record<string, ContractQueryStandardValue>>>;
};

export type ContractQueryStandardValue = string | Array<string> | undefined;

export type ContractHeaders = z.ZodObject<
	Record<string, PossibleZodOptional<z.ZodType<string, string>>>
>;

export type ContractPathParams = RouteContractSchema<
	z.ZodType<Record<string, string>, Record<string, string>>
>;

export type ContractResponseStatuses<TContract extends Contract> = Extract<
	keyof TContract["responses"],
	number
>;
