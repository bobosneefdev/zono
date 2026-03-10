import superjson from "superjson";
import type {
	ClientRequestData,
	ContractCallRoutes,
	ContractTree,
	ContractTreeFor,
	HTTPMethod,
} from "../contract/contract.js";
import type {
	InferMiddlewareResponseUnionAtPath,
	MiddlewareTree,
	MiddlewareTreeFor,
} from "../middleware/middleware.js";
import type { ErrorMode } from "../server/server.js";
import {
	type ApiShape,
	appendQueryParams,
	interpolatePathTemplate,
	type MapFetchRouteResponse,
	normalizeHeaderValues,
	parseSerializedResponse,
	serializeStructuredData,
	type TypedFetch,
	toPathParamsRecord,
	toRequestParts,
	ZONO_HEADER_DATA_HEADER,
	ZONO_QUERY_DATA_KEY,
} from "../shared/shared.js";

type ClientFetchRoutes<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ErrorMode,
> = ContractCallRoutes<TContracts> extends infer TRoute
	? TRoute extends {
			path: infer TPath extends string;
			method: infer _TMethod extends HTTPMethod;
			request: infer _TRequest;
			response: infer _TResponse;
		}
		? MapFetchRouteResponse<
				TRoute,
				| InferMiddlewareResponseUnionAtPath<TMiddlewares, TPath>
				| import("../server/server.js").ErrorResponse<TErrorMode>
			>
		: never
	: never;

export type ClientFetchMethod<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ErrorMode,
> = TypedFetch<ClientFetchRoutes<TContracts, TMiddlewares, TErrorMode>>;

export type Client<
	TContracts extends ContractTree,
	TMiddlewares extends MiddlewareTree,
	TErrorMode extends ErrorMode,
> = {
	fetch: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode>;
};

const buildRequest = (
	baseUrl: string,
	path: string,
	method: HTTPMethod,
	data?: ClientRequestData<import("../contract/contract.js").ContractMethod>,
): { url: URL; init: RequestInit } => {
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
		const body = requestParts.body as { type: string; data: unknown };
		switch (body.type) {
			case "FormData":
			case "Blob":
			case "Text":
				init.body = body.data as FormData | Blob | string;
				break;
			case "URLSearchParams":
				headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
				init.body = (body.data as URLSearchParams).toString();
				break;
			case "SuperJSON":
				headers.set("content-type", "application/json");
				init.body = superjson.stringify(body.data);
				break;
			case "JSON":
				headers.set("content-type", "application/json");
				init.body = JSON.stringify(body.data);
				break;
		}
	}

	return { url, init };
};

export const createClient = <
	TShape extends ApiShape,
	TContracts extends ContractTreeFor<TShape> & ContractTree,
	TMiddlewares extends MiddlewareTreeFor<TShape>,
	TErrorMode extends ErrorMode,
>(
	baseUrl: string,
): Client<TContracts, TMiddlewares, TErrorMode> => {
	const fetchMethod: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode> = async (
		path,
		method,
		data,
	) => {
		const request = buildRequest(baseUrl, path, method, data);
		const response = await fetch(request.url, request.init);
		const responseCopy = response.clone();
		const parsed = await parseSerializedResponse(response);
		return {
			status: response.status,
			response: responseCopy,
			data: parsed.data,
			headers: parsed.headers,
		} as Awaited<ReturnType<typeof fetchMethod>>;
	};

	return {
		fetch: fetchMethod,
	};
};
