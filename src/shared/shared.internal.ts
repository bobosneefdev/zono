import superjson from "superjson";
import type { ZodTypeAny } from "zod";
import {
	getRequestHeadersObject,
	getRequestQueryObject,
	type SerializedResponseType,
	toHonoPath,
} from "./shared.js";

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
	headers?: HeadersInit;
};

type ResponseSpecLike = {
	type: SerializedResponseType;
	schema?: ZodTypeAny;
};

export type Prettify<Type> = Type extends (...args: Array<unknown>) => unknown
	? Type
	: {
			[Key in keyof Type]: Type[Key];
		};

export type HumanReadableFetchResponse<TResponse> = TResponse extends {
	status: infer TStatus;
	data: infer TData;
}
	? Prettify<{
			status: TStatus;
			data: TData;
			response: Response;
		}>
	: never;

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
			response: HumanReadableFetchResponse<TResponse | TExtraResponse>;
		}
	: never;

type StructuredDataSpec = { type: "Standard" | "JSON" | "SuperJSON" };

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

export const getResponseSpecParser = (responseSpec: ResponseSpecLike): ZodTypeAny | undefined => {
	return responseSpec.schema;
};

export const validateResponseAgainstStatusMap = (
	statusMap: Record<number, ResponseSpecLike>,
	response: RuntimeResponseLike,
	label: string,
): void => {
	const responseSpec = statusMap[response.status];
	if (!responseSpec) {
		throw new Error(`${label} returned undeclared status: ${response.status}`);
	}
	if (responseSpec.type !== response.type) {
		throw new Error(
			`${label} returned mismatched response type. Expected ${responseSpec.type}, received ${response.type}`,
		);
	}

	const parser = getResponseSpecParser(responseSpec);
	if (!parser) {
		return;
	}

	const parseResult = parser.safeParse(response.data);
	if (!parseResult.success) {
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

const parseStructuredDataValue = (spec: StructuredDataSpec, value: string): unknown => {
	if (spec.type === "Standard") {
		return value;
	}
	if (spec.type === "SuperJSON") {
		return superjson.parse(value);
	}
	return JSON.parse(value);
};

export const parseQueryInput = (
	querySpec: {
		type: "Standard" | "JSON" | "SuperJSON";
	},
	requestUrl: URL,
): unknown => {
	const baseQuery = getRequestQueryObject(requestUrl);
	if (querySpec.type === "Standard") {
		return baseQuery;
	}

	const parsedQuery: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(baseQuery)) {
		parsedQuery[key] =
			value === undefined ? undefined : parseStructuredDataValue(querySpec, value);
	}
	return parsedQuery;
};

export const parseHeadersInput = (
	headersSpec: {
		type: "Standard" | "JSON" | "SuperJSON";
	},
	headers: Headers,
): unknown => {
	const rawHeaders = getRequestHeadersObject(headers);
	if (headersSpec.type === "Standard") {
		return rawHeaders;
	}

	const parsedHeaders: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rawHeaders)) {
		parsedHeaders[key] =
			value === undefined ? undefined : parseStructuredDataValue(headersSpec, value);
	}
	return parsedHeaders;
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
	app.on(method.toUpperCase(), toHonoPath(pathTemplate), handler);
};
