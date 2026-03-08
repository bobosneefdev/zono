import type {
	ContractMethodDefinition,
	Contracts,
	ContractsTree,
	HTTPMethod,
	InferContractRequestData,
} from "../contract/contract.types.js";
import type { Middlewares } from "../middleware/middleware.types.js";
import type { ErrorMode } from "../server/server.types.js";
import {
	appendQueryParams,
	interpolatePathTemplate,
	normalizeHeaderValues,
	parseSerializedResponse,
} from "../shared/shared.js";
import type { Shape } from "../shared/shared.types.js";
import type { Client, ClientFetchMethod } from "./client.types.js";

type RequestEnvelope = {
	pathParams?: unknown;
	query?: unknown;
	headers?: unknown;
	body?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

const toPathParams = (value: unknown): Record<string, string> | undefined => {
	if (!isRecord(value)) {
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

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
	return isRecord(value) ? value : undefined;
};

const buildRequest = (
	baseUrl: string,
	path: string,
	method: HTTPMethod,
	data?: RequestEnvelope,
): { url: URL; init: RequestInit } => {
	const resolvedPath = interpolatePathTemplate(path, toPathParams(data?.pathParams));
	const url = new URL(resolvedPath, baseUrl);
	appendQueryParams(url, toRecord(data?.query));

	const headers = normalizeHeaderValues(toRecord(data?.headers));
	const init: RequestInit = {
		method: method.toUpperCase(),
		headers,
	};

	if (data && "body" in data && data.body !== undefined) {
		const body = data.body;
		if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
			init.body = body;
		} else if (body instanceof URLSearchParams) {
			headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
			init.body = body.toString();
		} else {
			headers.set("content-type", "application/json");
			init.body = JSON.stringify(body);
		}
	}

	return { url, init };
};

const toRequestEnvelope = <TMethodDefinition extends ContractMethodDefinition>(
	data: InferContractRequestData<TMethodDefinition> | undefined,
): RequestEnvelope | undefined => {
	if (!data) {
		return undefined;
	}
	return {
		pathParams: "pathParams" in data ? data.pathParams : undefined,
		query: "query" in data ? data.query : undefined,
		headers: "headers" in data ? data.headers : undefined,
		body: "body" in data ? data.body : undefined,
	};
};

export const createClient = <
	TShape extends Shape,
	TContracts extends Contracts<TShape> & ContractsTree,
	TMiddlewares extends Middlewares<TShape>,
	TErrorMode extends ErrorMode,
>(
	baseUrl: string,
): Client<TContracts, TMiddlewares, TErrorMode> => {
	const fetchMethod: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode> = async (
		path,
		method,
		data,
	) => {
		const request = buildRequest(baseUrl, path, method, toRequestEnvelope(data));
		const response = await fetch(request.url, request.init);
		const responseCopy = response.clone();
		const parsed = await parseSerializedResponse(response);
		return {
			status: response.status,
			response: responseCopy,
			data: parsed.data,
		} as Awaited<ReturnType<typeof fetchMethod>>;
	};

	return {
		fetch: fetchMethod,
	};
};
