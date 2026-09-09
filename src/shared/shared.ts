import type { StandardSchemaV1 } from "@standard-schema/spec";
import superjson from "superjson";

export const ZONO_RESPONSE_TYPE_HEADER = "x-zono-response-type";
export const ZONO_RESPONSE_SOURCE_HEADER = "x-zono-response-source";
export const ZONO_SUPERJSON_HEADER = "x-zono-superjson";
export const ZONO_QUERY_DATA_KEY = "_zono";
export const ZONO_HEADER_DATA_HEADER = "x-zono-data";
export const ZONO_HEADER_DATA_TYPE_HEADER = "x-zono-data-type";

export const HTTP_METHODS = [
	"get",
	"post",
	"put",
	"delete",
	"patch",
	"options",
	"head",
	"query",
] as const;

export type HTTPMethod = (typeof HTTP_METHODS)[number];

const HTTP_METHOD_SET: ReadonlySet<string> = new Set(HTTP_METHODS);

export const isHTTPMethod = (value: string): value is HTTPMethod => {
	return HTTP_METHOD_SET.has(value);
};

export const METHODS_WITHOUT_FETCH_BODY: ReadonlySet<HTTPMethod> = new Set(["get", "head"]);

export type ErrorMode = "opaque" | "detailed";

export type ClientErrorMode = ErrorMode | "none";

export type OpaqueValidationErrorData = {
	message: "Invalid request";
};

export type OpaqueUnsupportedMediaTypeData = {
	message: "Unsupported media type";
};

export type OpaqueNotFoundErrorData = {
	message: "Not Found";
};

export type OpaqueInternalErrorData = {
	message: "Internal server error";
};

export type DetailedErrorData = {
	message: string;
	issues?: Array<unknown>;
	stack?: string;
};

export type ErrorResponse<TErrorMode extends ErrorMode> =
	| {
			status: 400;
			type: "JSON";
			data: TErrorMode extends "opaque" ? OpaqueValidationErrorData : DetailedErrorData;
			headers?: undefined;
	  }
	| {
			status: 404;
			type: "JSON";
			data: TErrorMode extends "opaque" ? OpaqueNotFoundErrorData : DetailedErrorData;
			headers?: undefined;
	  }
	| {
			status: 415;
			type: "JSON";
			data: TErrorMode extends "opaque" ? OpaqueUnsupportedMediaTypeData : DetailedErrorData;
			headers?: undefined;
	  }
	| {
			status: 500;
			type: "JSON";
			data: TErrorMode extends "opaque" ? OpaqueInternalErrorData : DetailedErrorData;
			headers?: undefined;
	  };

export class RequestValidationError extends Error {
	readonly issues: ReadonlyArray<unknown>;

	constructor(message: string, issues: ReadonlyArray<unknown>) {
		super(message);
		this.name = "RequestValidationError";
		this.issues = issues;
	}
}

export class UnsupportedMediaTypeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedMediaTypeError";
	}
}

export type RequestArguments<TRequest> = EmptyObject extends TRequest
	? [data?: TRequest]
	: [data: TRequest];

const getDetailedErrorData = (error: unknown, fallbackMessage: string): DetailedErrorData => {
	if (error instanceof RequestValidationError) {
		return {
			message: error.message,
			issues: [...error.issues],
			stack: error.stack,
		};
	}
	if (error instanceof Error) {
		return {
			message: error.message,
			stack: error.stack,
		};
	}
	return {
		message: fallbackMessage,
		issues: [error],
	};
};

export const makeErrorRuntimeResponse = (
	error: unknown,
	errorMode: ErrorMode,
): RuntimeResponseLike => {
	if (error instanceof RequestValidationError) {
		return {
			status: 400,
			type: "JSON",
			data:
				errorMode === "opaque"
					? { message: "Invalid request" }
					: getDetailedErrorData(error, "Invalid request"),
		};
	}
	if (error instanceof UnsupportedMediaTypeError) {
		return {
			status: 415,
			type: "JSON",
			data:
				errorMode === "opaque"
					? { message: "Unsupported media type" }
					: getDetailedErrorData(error, "Unsupported media type"),
		};
	}
	return {
		status: 500,
		type: "JSON",
		data:
			errorMode === "opaque"
				? { message: "Internal server error" }
				: getDetailedErrorData(error, "Internal server error"),
	};
};

export const makeNotFoundRuntimeResponse = (): RuntimeResponseLike => {
	return {
		status: 404,
		type: "JSON",
		data: { message: "Not Found" },
	};
};

export type ParsedMediaType = {
	type: string;
	subtype: string;
	parameters: Record<string, string>;
};

export const parseMediaType = (value: string): ParsedMediaType | undefined => {
	const [essence, ...rawParameters] = value.split(";");
	const trimmedEssence = (essence ?? "").trim().toLowerCase();
	const slashIndex = trimmedEssence.indexOf("/");
	if (slashIndex <= 0 || slashIndex === trimmedEssence.length - 1) {
		return undefined;
	}

	const parameters: Record<string, string> = {};
	for (const rawParameter of rawParameters) {
		const equalsIndex = rawParameter.indexOf("=");
		if (equalsIndex <= 0) {
			continue;
		}
		const parameterName = rawParameter.slice(0, equalsIndex).trim().toLowerCase();
		const parameterValue = rawParameter
			.slice(equalsIndex + 1)
			.trim()
			.replace(/^"(.*)"$/, "$1");
		if (parameterName.length > 0) {
			parameters[parameterName] = parameterValue;
		}
	}

	return {
		type: trimmedEssence.slice(0, slashIndex),
		subtype: trimmedEssence.slice(slashIndex + 1),
		parameters,
	};
};

/**
 * Checks whether an incoming media type satisfies a declared media type.
 * Type/subtype comparison is case-insensitive; every parameter explicitly
 * declared must be present on the incoming value with a matching value.
 */
export const mediaTypeSatisfies = (declared: string, incoming: string): boolean => {
	const declaredParsed = parseMediaType(declared);
	const incomingParsed = parseMediaType(incoming);
	if (!declaredParsed || !incomingParsed) {
		return false;
	}
	if (
		declaredParsed.type !== incomingParsed.type ||
		declaredParsed.subtype !== incomingParsed.subtype
	) {
		return false;
	}
	for (const [parameterName, parameterValue] of Object.entries(declaredParsed.parameters)) {
		const incomingValue = incomingParsed.parameters[parameterName];
		if (incomingValue === undefined) {
			return false;
		}
		if (incomingValue.toLowerCase() !== parameterValue.toLowerCase()) {
			return false;
		}
	}
	return true;
};

export const mediaTypesEquivalent = (left: string, right: string): boolean => {
	return mediaTypeSatisfies(left, right) && mediaTypeSatisfies(right, left);
};

export type BodyTransportType =
	| "JSON"
	| "SuperJSON"
	| "Text"
	| "Blob"
	| "URLSearchParams"
	| "FormData";

type TransportContentTypePolicy = {
	/** Whether the contract may declare a custom `contentType` for this transport. */
	supportsCustomContentType: boolean;
	/** Default media type, or undefined when the runtime must not set the header itself. */
	defaultContentType: (data: unknown) => string | undefined;
	/** Whether a custom media type is compatible with this transport's serializer. */
	isCompatibleContentType: (mediaType: ParsedMediaType) => boolean;
};

const blobDefaultContentType = (data: unknown): string => {
	return data instanceof Blob && data.type.length > 0 ? data.type : "application/octet-stream";
};

const isJsonCompatible = (mediaType: ParsedMediaType): boolean => {
	return (
		(mediaType.type === "application" && mediaType.subtype === "json") ||
		mediaType.subtype.endsWith("+json")
	);
};

const JSON_CONTENT_TYPE_POLICY: TransportContentTypePolicy = {
	supportsCustomContentType: true,
	defaultContentType: () => "application/json",
	isCompatibleContentType: isJsonCompatible,
};

const TEXT_CONTENT_TYPE_POLICY: TransportContentTypePolicy = {
	supportsCustomContentType: true,
	defaultContentType: () => "text/plain; charset=utf-8",
	isCompatibleContentType: (mediaType) => mediaType.type === "text",
};

const BINARY_CONTENT_TYPE_POLICY: TransportContentTypePolicy = {
	supportsCustomContentType: true,
	defaultContentType: blobDefaultContentType,
	isCompatibleContentType: () => true,
};

const FORM_DATA_CONTENT_TYPE_POLICY: TransportContentTypePolicy = {
	supportsCustomContentType: false,
	// The runtime must generate the multipart boundary itself.
	defaultContentType: () => undefined,
	isCompatibleContentType: () => false,
};

export const REQUEST_CONTENT_TYPE_POLICIES: Record<BodyTransportType, TransportContentTypePolicy> =
	{
		JSON: JSON_CONTENT_TYPE_POLICY,
		SuperJSON: JSON_CONTENT_TYPE_POLICY,
		Text: TEXT_CONTENT_TYPE_POLICY,
		Blob: BINARY_CONTENT_TYPE_POLICY,
		URLSearchParams: {
			supportsCustomContentType: true,
			defaultContentType: () => "application/x-www-form-urlencoded;charset=UTF-8",
			isCompatibleContentType: () => true,
		},
		FormData: FORM_DATA_CONTENT_TYPE_POLICY,
	};

export const RESPONSE_CONTENT_TYPE_POLICIES: Record<
	SerializedResponseType,
	TransportContentTypePolicy
> = {
	JSON: JSON_CONTENT_TYPE_POLICY,
	SuperJSON: JSON_CONTENT_TYPE_POLICY,
	Text: TEXT_CONTENT_TYPE_POLICY,
	Blob: BINARY_CONTENT_TYPE_POLICY,
	Bytes: {
		supportsCustomContentType: true,
		defaultContentType: () => "application/octet-stream",
		isCompatibleContentType: () => true,
	},
	FormData: FORM_DATA_CONTENT_TYPE_POLICY,
	Contentless: {
		supportsCustomContentType: false,
		defaultContentType: () => undefined,
		isCompatibleContentType: () => false,
	},
};

export const resolveResponseContentType = (
	responseType: SerializedResponseType,
	customContentType: string | undefined,
	data: unknown,
): string | undefined => {
	const policy = RESPONSE_CONTENT_TYPE_POLICIES[responseType];
	if (customContentType === undefined) {
		return policy.defaultContentType(data);
	}
	if (!policy.supportsCustomContentType) {
		throw new Error(`${responseType} responses do not support a custom content type`);
	}
	const parsed = parseMediaType(customContentType);
	if (!parsed || !policy.isCompatibleContentType(parsed)) {
		throw new Error(
			`Content type '${customContentType}' is not compatible with ${responseType} responses`,
		);
	}
	return customContentType;
};

export const resolveRequestContentType = (
	bodyType: BodyTransportType,
	customContentType: string | undefined,
	data: unknown,
): string | undefined => {
	const policy = REQUEST_CONTENT_TYPE_POLICIES[bodyType];
	if (customContentType === undefined) {
		return policy.defaultContentType(data);
	}
	if (!policy.supportsCustomContentType) {
		throw new Error(`${bodyType} bodies do not support a custom content type`);
	}
	return customContentType;
};

export type SerializedResponseType =
	| "JSON"
	| "SuperJSON"
	| "Text"
	| "Contentless"
	| "FormData"
	| "Blob"
	| "Bytes";

export type SerializedResponseSource = "contract" | "middleware" | "error";

export type DynamicSegmentKey = `$${string}`;

export type IsDynamicSegment<TKey extends string> = TKey extends DynamicSegmentKey ? true : false;

export type EmptyObject = Record<never, never>;

export type Prettify<T> = T extends (...args: Array<unknown>) => unknown
	? T
	: {
			[Key in keyof T]: T[Key];
		};

export type Expand<T> = Prettify<T>;

export type ExpandUnion<T> = T extends unknown ? Expand<T> : never;

export type InferSchemaData<TSpec> = TSpec extends {
	schema: StandardSchemaV1<unknown, infer TOutput>;
}
	? TOutput
	: undefined;

export type InferSchemaInput<TSpec> = TSpec extends {
	schema: StandardSchemaV1<infer TInput, unknown>;
}
	? TInput
	: undefined;

export type InferResponseHeadersData<TSpec> = TSpec extends { headers: infer THeadersSpec }
	? InferSchemaData<THeadersSpec>
	: undefined;

type ResponseHeadersField<TSpec> = TSpec extends { headers: infer THeadersSpec }
	? { headers: InferSchemaData<THeadersSpec> }
	: { headers?: undefined };

export type StatusMapToResponseUnion<
	TStatuses extends Record<number, { type: SerializedResponseType }>,
> = {
	[TStatus in keyof TStatuses & number]: Expand<
		{
			status: TStatus;
			type: TStatuses[TStatus]["type"];
			data: InferSchemaData<TStatuses[TStatus]>;
		} & ResponseHeadersField<TStatuses[TStatus]>
	>;
}[keyof TStatuses & number];

export type FetchResponse<TResponse> = TResponse extends unknown
	? Expand<Omit<TResponse, "type"> & { response: Response }>
	: never;

export type FetchRoute = {
	path: string;
	method: string;
	request: unknown;
	response: unknown;
};

export type MaybePromise<T> = T | Promise<T>;
export type FetchConfig = [string, RequestInit];

type FetchRouteAtPath<TRoute extends FetchRoute, TPath extends TRoute["path"]> = Extract<
	TRoute,
	{ path: TPath }
>;

type FetchRouteAtPathAndMethod<
	TRoute extends FetchRoute,
	TPath extends TRoute["path"],
	TMethod extends FetchRouteAtPath<TRoute, TPath>["method"],
> = Extract<TRoute, { path: TPath; method: TMethod }>;

export type TypedFetch<TRoute extends FetchRoute> = <
	TPath extends TRoute["path"],
	TMethod extends FetchRouteAtPath<TRoute, TPath>["method"],
>(
	path: TPath,
	method: TMethod,
	...request: RequestArguments<FetchRouteAtPathAndMethod<TRoute, TPath, TMethod>["request"]>
) => Promise<FetchRouteAtPathAndMethod<TRoute, TPath, TMethod>["response"]>;

export type TypedFetchConfig<TRoute extends FetchRoute> = <
	TPath extends TRoute["path"],
	TMethod extends FetchRouteAtPath<TRoute, TPath>["method"],
>(
	path: TPath,
	method: TMethod,
	...request: RequestArguments<FetchRouteAtPathAndMethod<TRoute, TPath, TMethod>["request"]>
) => MaybePromise<FetchConfig>;

export type TypedParseResponse<TRoute extends FetchRoute> = <
	TPath extends TRoute["path"],
	TMethod extends FetchRouteAtPath<TRoute, TPath>["method"],
>(
	path: TPath,
	method: TMethod,
	response: Response,
) => Promise<FetchRouteAtPathAndMethod<TRoute, TPath, TMethod>["response"]>;

export type RequestParts = {
	pathParams?: unknown;
	query?: unknown;
	headers?: unknown;
	body?: unknown;
};

export type RuntimeResponseLike = {
	status: number;
	type: SerializedResponseType;
	data: unknown;
	headers?: unknown;
};

type ResponseSpecLike = {
	type: SerializedResponseType;
	schema?: StandardSchemaV1;
	contentType?: string;
	headers?: {
		type: "Standard" | "JSON" | "SuperJSON";
		schema: StandardSchemaV1;
	};
};

export type MapFetchRouteResponse<TRoute, TExtraResponse> = TRoute extends {
	path: infer TPath extends string;
	method: infer TMethod extends string;
	request: infer TRequest;
	response: infer TResponse;
}
	? {
			path: TPath;
			method: TMethod;
			request: TRequest;
			response: FetchResponse<TResponse | TExtraResponse>;
		}
	: never;

export const createFetchConfig = (
	baseUrl: string,
	path: string,
	method: string,
	data?: unknown,
): [string, RequestInit] => {
	const requestParts = toRequestParts(data);
	const resolvedPath = interpolatePathTemplate(
		path,
		toPathParamsRecord(requestParts?.pathParams),
	);
	const url = new URL(resolvedPath, baseUrl);
	const headers = new Headers();

	if (requestParts?.query !== undefined) {
		const query = requestParts.query as { type: string; data: unknown };
		if (query.type === "Standard") {
			appendQueryParams(url, query.data as Record<string, unknown>);
		} else if (query.data !== undefined) {
			url.searchParams.set(
				ZONO_QUERY_DATA_KEY,
				serializeStructuredData(query.type, query.data),
			);
		}
	}

	if (requestParts?.headers !== undefined) {
		const requestHeaders = requestParts.headers as { type: string; data: unknown };
		if (requestHeaders.type === "Standard") {
			for (const [key, value] of normalizeHeaderValues(
				requestHeaders.data as Record<string, unknown>,
			).entries()) {
				headers.set(key, value);
			}
		} else if (requestHeaders.data !== undefined) {
			headers.set(
				ZONO_HEADER_DATA_HEADER,
				serializeStructuredData(requestHeaders.type, requestHeaders.data),
			);
		}
	}

	const init: RequestInit = {
		method: method.toUpperCase(),
		headers,
	};

	if (requestParts?.body !== undefined) {
		const body = requestParts.body as {
			type: BodyTransportType;
			data: unknown;
			contentType?: string;
		};
		switch (body.type) {
			case "FormData":
			case "Blob":
			case "Text":
				init.body = body.data as FormData | Blob | string;
				break;
			case "URLSearchParams":
				init.body = (body.data as URLSearchParams).toString();
				break;
			case "SuperJSON":
				init.body = superjson.stringify(body.data);
				break;
			case "JSON":
				init.body = JSON.stringify(body.data);
				break;
		}

		const userContentType = headers.get("content-type");
		if (body.type === "FormData") {
			// The fetch runtime must generate the multipart boundary itself.
			if (userContentType !== null) {
				throw new Error(
					"FormData bodies generate their own content-type header and cannot accept one from request headers",
				);
			}
		} else {
			const effectiveContentType = resolveRequestContentType(
				body.type,
				body.contentType,
				body.data,
			);
			if (effectiveContentType !== undefined) {
				if (
					userContentType !== null &&
					!mediaTypesEquivalent(userContentType, effectiveContentType)
				) {
					throw new Error(
						`Request header content-type '${userContentType}' conflicts with the contract's effective media type '${effectiveContentType}'`,
					);
				}
				headers.set("content-type", effectiveContentType);
			}
		}
	}

	return [url.toString(), init];
};

export const parseFetchResponse = async (
	response: Response,
): Promise<{
	status: number;
	response: Response;
	data: unknown;
	headers: unknown;
}> => {
	const responseCopy = response.clone();
	const parsed = await parseSerializedResponse(response);
	return {
		status: response.status,
		response: responseCopy,
		data: parsed.data,
		headers: parsed.headers,
	};
};

type StructuredDataType = "Standard" | "JSON" | "SuperJSON";

type StructuredDataSpec = { type: StructuredDataType };

export const toHonoPath = (pathTemplate: string): string => {
	if (pathTemplate === "/") {
		return "/";
	}
	return pathTemplate.replace(/\$([a-zA-Z0-9_]+)/g, (_raw: string, paramName: string) => {
		return `:${paramName}`;
	});
};

export const interpolatePathTemplate = (
	pathTemplate: string,
	pathParams?: Record<string, string>,
): string => {
	if (!pathParams) {
		return pathTemplate;
	}
	return pathTemplate.replace(/\$([a-zA-Z0-9_]+)/g, (_raw: string, paramName: string) => {
		const value = pathParams[paramName];
		if (value === undefined) {
			throw new Error(`Missing path param: ${paramName}`);
		}
		return encodeURIComponent(value);
	});
};

export const serializeStructuredData = (type: string, data: unknown): string => {
	return type === "SuperJSON" ? superjson.stringify(data) : JSON.stringify(data);
};

const encodeStructuredValue = (value: unknown): string => {
	return typeof value === "string" ? value : JSON.stringify(value);
};

const appendEncodedEntries = (
	target: { set: (key: string, value: string) => void },
	values?: Record<string, unknown>,
): void => {
	if (!values) {
		return;
	}
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) {
			continue;
		}
		target.set(key, encodeStructuredValue(value));
	}
};

export const appendQueryParams = (url: URL, query?: Record<string, unknown>): void => {
	appendEncodedEntries(url.searchParams, query);
};

export const normalizeHeaderValues = (headers?: Record<string, unknown>): Headers => {
	const output = new Headers();
	appendEncodedEntries(output, headers);
	return output;
};

const inferResponseType = (response: Response): SerializedResponseType => {
	const explicitType = response.headers.get(ZONO_RESPONSE_TYPE_HEADER);
	if (
		explicitType === "JSON" ||
		explicitType === "SuperJSON" ||
		explicitType === "Text" ||
		explicitType === "Contentless" ||
		explicitType === "FormData" ||
		explicitType === "Blob" ||
		explicitType === "Bytes"
	) {
		return explicitType;
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("text/plain")) {
		return "Text";
	}
	if (contentType.includes("application/octet-stream")) {
		return "Bytes";
	}
	if (contentType.includes("application/json")) {
		return response.headers.get(ZONO_SUPERJSON_HEADER) === "1" ? "SuperJSON" : "JSON";
	}
	if (response.status === 204 || response.status === 205) {
		return "Contentless";
	}
	return "JSON";
};

export const createSerializedResponse = (args: {
	status: number;
	type: SerializedResponseType;
	data: unknown;
	source: SerializedResponseSource;
	headers?: HeadersInit;
	contentType?: string;
}): Response => {
	const headers = new Headers(args.headers);
	headers.set(ZONO_RESPONSE_TYPE_HEADER, args.type);
	headers.set(ZONO_RESPONSE_SOURCE_HEADER, args.source);

	const contentType = resolveResponseContentType(args.type, args.contentType, args.data);
	if (contentType !== undefined) {
		headers.set("content-type", contentType);
	}

	switch (args.type) {
		case "JSON": {
			return new Response(JSON.stringify(args.data ?? null), {
				status: args.status,
				headers,
			});
		}
		case "SuperJSON": {
			headers.set(ZONO_SUPERJSON_HEADER, "1");
			return new Response(superjson.stringify(args.data), { status: args.status, headers });
		}
		case "Text": {
			return new Response(String(args.data ?? ""), { status: args.status, headers });
		}
		case "Contentless": {
			return new Response(null, { status: args.status, headers });
		}
		case "FormData": {
			if (!(args.data instanceof FormData)) {
				throw new Error("FormData response type requires FormData instance");
			}
			// The Response constructor generates the multipart boundary header.
			return new Response(args.data, { status: args.status, headers });
		}
		case "Blob": {
			if (!(args.data instanceof Blob)) {
				throw new Error("Blob response type requires Blob instance");
			}
			return new Response(args.data, { status: args.status, headers });
		}
		case "Bytes": {
			if (!(args.data instanceof Uint8Array)) {
				throw new Error("Bytes response type requires Uint8Array instance");
			}
			return new Response(args.data.slice(), { status: args.status, headers });
		}
	}
};

const parseResponseHeadersData = (
	headers: Headers,
): { type: "Standard" | "JSON" | "SuperJSON"; data: unknown } | undefined => {
	const type = headers.get(ZONO_HEADER_DATA_TYPE_HEADER) as
		| "Standard"
		| "JSON"
		| "SuperJSON"
		| null;
	if (type !== "Standard" && type !== "JSON" && type !== "SuperJSON") {
		return undefined;
	}

	const payload = headers.get(ZONO_HEADER_DATA_HEADER) ?? undefined;
	if (payload === undefined) {
		return { type, data: undefined };
	}

	return {
		type,
		data: type === "Standard" ? JSON.parse(payload) : parseStructuredDataValue(type, payload),
	};
};

export const parseSerializedResponse = async (
	response: Response,
): Promise<{
	type: SerializedResponseType;
	source: SerializedResponseSource;
	data: unknown;
	headers: unknown;
}> => {
	const type = inferResponseType(response);
	const sourceHeader = response.headers.get(ZONO_RESPONSE_SOURCE_HEADER);
	const source: SerializedResponseSource =
		sourceHeader === "contract" || sourceHeader === "middleware" || sourceHeader === "error"
			? sourceHeader
			: response.status >= 400
				? "error"
				: "contract";
	const parsedHeaders = parseResponseHeadersData(response.headers);
	const responseHeaders = parsedHeaders?.data;

	if (type === "Contentless") {
		return { type, source, data: undefined, headers: responseHeaders };
	}

	if (type === "Text") {
		return { type, source, data: await response.text(), headers: responseHeaders };
	}

	if (type === "Bytes") {
		return {
			type,
			source,
			data: new Uint8Array(await response.arrayBuffer()),
			headers: responseHeaders,
		};
	}

	if (type === "Blob") {
		return { type, source, data: await response.blob(), headers: responseHeaders };
	}

	if (type === "FormData") {
		return { type, source, data: await response.formData(), headers: responseHeaders };
	}

	if (type === "SuperJSON") {
		return {
			type,
			source,
			data: superjson.parse(await response.text()),
			headers: responseHeaders,
		};
	}

	const responseText = await response.text();
	if (responseText.length === 0) {
		return { type: "JSON", source, data: undefined, headers: responseHeaders };
	}
	return { type: "JSON", source, data: JSON.parse(responseText), headers: responseHeaders };
};

export const isRecordObject = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

export const getPathSegments = (pathTemplate: string): Array<string> => {
	return pathTemplate.split("/").filter(Boolean);
};

export const ensurePath = (path: string): string => {
	if (path.length === 0) {
		return "/";
	}
	return path.startsWith("/") ? path : `/${path}`;
};

export const joinPath = (prefix: string, segment: string): string => {
	const normalizedPrefix = prefix === "/" ? "" : prefix;
	return ensurePath(`${normalizedPrefix}/${segment}`.replace(/\/+/g, "/"));
};

export const findExactShapePathNode = (
	root: unknown,
	pathTemplate: string,
	missingShapeMessage: (path: string) => string,
	missingSegmentMessage: (segment: string, path: string) => string,
): Record<string, unknown> => {
	let current = root;
	for (const segment of getPathSegments(pathTemplate)) {
		if (!isRecordObject(current) || !isRecordObject(current.SHAPE)) {
			throw new Error(missingShapeMessage(pathTemplate));
		}
		const next = current.SHAPE[segment];
		if (!isRecordObject(next)) {
			throw new Error(missingSegmentMessage(segment, pathTemplate));
		}
		current = next;
	}

	if (!isRecordObject(current)) {
		throw new Error(missingShapeMessage(pathTemplate));
	}

	return current;
};

export const collectShapePathNodes = (root: unknown, pathTemplate: string): Array<unknown> => {
	const nodes: Array<unknown> = [root];
	let current = root;

	for (const segment of getPathSegments(pathTemplate)) {
		if (!isRecordObject(current) || !isRecordObject(current.SHAPE)) {
			break;
		}
		const next = current.SHAPE[segment];
		if (next === undefined) {
			break;
		}
		nodes.push(next);
		current = next;
	}

	return nodes;
};

export const getResponseSpecParser = (
	responseSpec: ResponseSpecLike,
): StandardSchemaV1 | undefined => {
	return responseSpec.schema;
};

export const validateResponseAgainstStatusMap = async (
	statusMap: Record<number, ResponseSpecLike>,
	response: RuntimeResponseLike,
	label: string,
): Promise<void> => {
	const responseSpec = statusMap[response.status];
	if (!responseSpec) {
		throw new Error(`${label} returned undeclared status: ${response.status}`);
	}
	if (responseSpec.type !== response.type) {
		throw new Error(
			`${label} returned mismatched response type. Expected ${responseSpec.type}, received ${response.type}`,
		);
	}
	if (!responseSpec.headers) {
		if (response.headers !== undefined) {
			throw new Error(`${label} returned undeclared response headers`);
		}
	} else {
		const headersParseResult = await responseSpec.headers.schema["~standard"].validate(
			response.headers,
		);
		if (headersParseResult.issues) {
			throw new Error(`${label} response headers validation failed`);
		}
	}

	const parser = getResponseSpecParser(responseSpec);
	if (!parser) {
		return;
	}

	const parseResult = await parser["~standard"].validate(response.data);
	if (parseResult.issues) {
		throw new Error(`${label} response data validation failed`);
	}
};

export const toRequestParts = (value: unknown): RequestParts | undefined => {
	if (!isRecordObject(value)) {
		return undefined;
	}
	return {
		pathParams: value.pathParams,
		query: value.query,
		headers: value.headers,
		body: value.body,
	};
};

export const toRecordObject = (value: unknown): Record<string, unknown> | undefined => {
	return isRecordObject(value) ? value : undefined;
};

export const toPathParamsRecord = (value: unknown): Record<string, string> | undefined => {
	if (!isRecordObject(value)) {
		return undefined;
	}
	const output: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") {
			throw new Error(`Path param '${key}' must be a string`);
		}
		output[key] = item;
	}
	return output;
};

export const getRequestQueryObject = (url: URL): Record<string, string | undefined> => {
	const query: Record<string, string | undefined> = {};
	for (const [key, value] of url.searchParams.entries()) {
		query[key] = value;
	}
	return query;
};

export const getRequestHeadersObject = (headers: Headers): Record<string, string | undefined> => {
	const output: Record<string, string | undefined> = {};
	for (const [key, value] of headers.entries()) {
		output[key] = value;
	}
	return output;
};

const parseStructuredDataValue = (type: StructuredDataType, value: string): unknown => {
	if (type === "Standard") {
		return value;
	}
	if (type === "SuperJSON") {
		return superjson.parse(value);
	}
	return JSON.parse(value);
};

const parseStructuredRecordInput = (
	spec: StructuredDataSpec,
	rawRecord: Record<string, string | undefined>,
): Record<string, unknown> | Record<string, string | undefined> => {
	if (spec.type === "Standard") {
		return rawRecord;
	}

	const parsedRecord: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rawRecord)) {
		parsedRecord[key] =
			value === undefined ? undefined : parseStructuredDataValue(spec.type, value);
	}
	return parsedRecord;
};

const parseStructuredSlotInput = (
	spec: Exclude<StructuredDataSpec, { type: "Standard" }>,
	value: string | undefined,
): unknown => {
	if (value === undefined) {
		return undefined;
	}
	return parseStructuredDataValue(spec.type, value);
};

export const parseQueryInput = (
	querySpec: {
		type: "Standard" | "JSON" | "SuperJSON";
	},
	requestUrl: URL,
): unknown => {
	if (querySpec.type === "JSON" || querySpec.type === "SuperJSON") {
		return parseStructuredSlotInput(
			querySpec,
			requestUrl.searchParams.get(ZONO_QUERY_DATA_KEY) ?? undefined,
		);
	}
	return parseStructuredRecordInput(querySpec, getRequestQueryObject(requestUrl));
};

export const parseHeadersInput = (
	headersSpec: {
		type: "Standard" | "JSON" | "SuperJSON";
	},
	headers: Headers,
): unknown => {
	if (headersSpec.type === "JSON" || headersSpec.type === "SuperJSON") {
		return parseStructuredSlotInput(
			headersSpec,
			headers.get(ZONO_HEADER_DATA_HEADER) ?? undefined,
		);
	}
	return parseStructuredRecordInput(headersSpec, getRequestHeadersObject(headers));
};

export const parseBodyInput = async (
	bodySpec: {
		type: SerializedResponseType | "URLSearchParams";
	},
	request: Request,
): Promise<unknown> => {
	switch (bodySpec.type) {
		case "JSON":
			return request.json();
		case "SuperJSON":
			return superjson.parse(await request.text());
		case "FormData":
			return request.formData();
		case "URLSearchParams":
			return new URLSearchParams(await request.text());
		case "Text":
			return request.text();
		case "Blob":
			return request.blob();
		case "Bytes":
		case "Contentless":
			return undefined;
	}
};

export const registerHonoRoute = (
	app: import("hono").Hono,
	method: string,
	pathTemplate: string,
	handler: (ctx: import("hono").Context) => Promise<Response>,
): void => {
	if (method.toLowerCase() === "head") {
		app.use(toHonoPath(pathTemplate), async (ctx, next) => {
			if (ctx.req.method === "HEAD") {
				return handler(ctx);
			}
			await next();
		});
		return;
	}
	app.on(method.toUpperCase(), toHonoPath(pathTemplate), handler);
};

export const toSerializedRuntimeResponse = (
	response: RuntimeResponseLike,
	source: SerializedResponseSource,
): Response => {
	return createSerializedResponse({
		status: response.status,
		type: response.type,
		data: response.data,
		source,
	});
};

const getSerializedResponseHeaders = (
	headersSpec: ResponseSpecLike["headers"],
	headersData: unknown,
): Headers | undefined => {
	if (!headersSpec || headersData === undefined) {
		return undefined;
	}

	const headers = new Headers();

	if (headersSpec.type === "Standard") {
		for (const [key, value] of normalizeHeaderValues(
			headersData as Record<string, unknown>,
		).entries()) {
			headers.set(key, value);
		}
	}

	headers.set(ZONO_HEADER_DATA_TYPE_HEADER, headersSpec.type);
	headers.set(ZONO_HEADER_DATA_HEADER, serializeStructuredData(headersSpec.type, headersData));
	return headers;
};

export const validateAndSerializeResponse = async (
	statusMap: Record<number, ResponseSpecLike>,
	response: RuntimeResponseLike,
	label: string,
	source: SerializedResponseSource,
): Promise<Response> => {
	await validateResponseAgainstStatusMap(statusMap, response, label);
	return createSerializedResponse({
		status: response.status,
		type: response.type,
		data: response.data,
		headers: getSerializedResponseHeaders(
			statusMap[response.status]?.headers,
			response.headers,
		),
		contentType: statusMap[response.status]?.contentType,
		source,
	});
};
