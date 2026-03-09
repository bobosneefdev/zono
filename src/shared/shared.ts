import superjson from "superjson";
import type { ZodType } from "zod";

export const ZONO_RESPONSE_TYPE_HEADER = "x-zono-response-type";
export const ZONO_RESPONSE_SOURCE_HEADER = "x-zono-response-source";
export const ZONO_SUPERJSON_HEADER = "x-zono-superjson";

export type ApiShape = {
	CONTRACT?: true;
	SHAPE?: Record<string, ApiShape>;
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

export type InferSchemaData<TSpec> = TSpec extends { schema: ZodType<infer TOutput, unknown> }
	? TOutput
	: undefined;

export type StatusMapToResponseUnion<
	TStatuses extends Record<number, { type: SerializedResponseType }>,
> = {
	[TStatus in keyof TStatuses & number]: {
		status: TStatus;
		type: TStatuses[TStatus]["type"];
		data: InferSchemaData<TStatuses[TStatus]>;
	};
}[keyof TStatuses & number];

export type FetchResponse<TResponse> = TResponse extends unknown
	? Omit<TResponse, "type"> & { response: Response }
	: never;

export type FetchRoute = {
	path: string;
	method: string;
	request: unknown;
	response: unknown;
};

export type TypedFetch<TRoute extends FetchRoute> = <
	TPath extends TRoute["path"],
	TMethod extends Extract<TRoute, { path: TPath }>["method"],
>(
	path: TPath,
	method: TMethod,
	data?: Extract<TRoute, { path: TPath; method: TMethod }>["request"],
) => Promise<Extract<TRoute, { path: TPath; method: TMethod }>["response"]>;

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
}): Response => {
	const headers = new Headers(args.headers);
	headers.set(ZONO_RESPONSE_TYPE_HEADER, args.type);
	headers.set(ZONO_RESPONSE_SOURCE_HEADER, args.source);

	switch (args.type) {
		case "JSON": {
			headers.set("content-type", "application/json");
			return new Response(JSON.stringify(args.data ?? null), {
				status: args.status,
				headers,
			});
		}
		case "SuperJSON": {
			headers.set("content-type", "application/json");
			headers.set(ZONO_SUPERJSON_HEADER, "1");
			return new Response(superjson.stringify(args.data), { status: args.status, headers });
		}
		case "Text": {
			headers.set("content-type", "text/plain; charset=utf-8");
			return new Response(String(args.data ?? ""), { status: args.status, headers });
		}
		case "Contentless": {
			return new Response(null, { status: args.status, headers });
		}
		case "FormData": {
			if (!(args.data instanceof FormData)) {
				throw new Error("FormData response type requires FormData instance");
			}
			return new Response(args.data, { status: args.status, headers });
		}
		case "Blob": {
			if (!(args.data instanceof Blob)) {
				throw new Error("Blob response type requires Blob instance");
			}
			return new Response(args.data, { status: args.status, headers });
		}
		case "Bytes": {
			headers.set("content-type", "application/octet-stream");
			if (!(args.data instanceof Uint8Array)) {
				throw new Error("Bytes response type requires Uint8Array instance");
			}
			return new Response(args.data.slice(), { status: args.status, headers });
		}
	}
};

export const parseSerializedResponse = async (
	response: Response,
): Promise<{ type: SerializedResponseType; source: SerializedResponseSource; data: unknown }> => {
	const type = inferResponseType(response);
	const sourceHeader = response.headers.get(ZONO_RESPONSE_SOURCE_HEADER);
	const source: SerializedResponseSource =
		sourceHeader === "contract" || sourceHeader === "middleware" || sourceHeader === "error"
			? sourceHeader
			: response.status >= 400
				? "error"
				: "contract";

	if (type === "Contentless") {
		return { type, source, data: undefined };
	}

	if (type === "Text") {
		return { type, source, data: await response.text() };
	}

	if (type === "Bytes") {
		return { type, source, data: new Uint8Array(await response.arrayBuffer()) };
	}

	if (type === "Blob") {
		return { type, source, data: await response.blob() };
	}

	if (type === "FormData") {
		return { type, source, data: await response.formData() };
	}

	if (type === "SuperJSON") {
		return { type, source, data: superjson.parse(await response.text()) };
	}

	const responseText = await response.text();
	if (responseText.length === 0) {
		return { type: "JSON", source, data: undefined };
	}
	return { type: "JSON", source, data: JSON.parse(responseText) };
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
