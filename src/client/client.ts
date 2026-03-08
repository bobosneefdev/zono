import type {
	ContractCallRoutes,
	ContractTree,
	ContractTreeFor,
	HTTPMethod,
	RequestData,
} from "../contract/contract.js";
import type { MiddlewareSpec, MiddlewareTreeFor } from "../middleware/middleware.js";
import type { ErrorMode } from "../server/server.js";
import { toPathParamsRecord, toRecordObject, toRequestParts } from "../shared/shared.internal.js";
import {
	type ApiShape,
	appendQueryParams,
	type ExpandUnion,
	type FetchResponse,
	interpolatePathTemplate,
	normalizeHeaderValues,
	parseSerializedResponse,
	type TypedFetch,
} from "../shared/shared.js";

type ClientFetchRoutes<
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = ContractCallRoutes<TContracts> extends infer TRoute
	? TRoute extends {
			path: infer TPath extends string;
			method: infer TMethod extends HTTPMethod;
			request: infer TRequest;
			response: infer TResponse;
		}
		? {
				path: TPath;
				method: TMethod;
				request: TRequest;
				response: ExpandUnion<
					FetchResponse<
						| TResponse
						| import("../middleware/middleware.js").InferAllMiddlewareResponseUnion<TMiddlewares>
						| import("../server/server.js").ErrorResponse<TErrorMode>
					>
				>;
			}
		: never
	: never;

export type ClientFetchMethod<
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = TypedFetch<ClientFetchRoutes<TContracts, TMiddlewares, TErrorMode>>;

export type Client<
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = {
	fetch: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode>;
};

const buildRequest = (
	baseUrl: string,
	path: string,
	method: HTTPMethod,
	data?: RequestData<import("../contract/contract.js").ContractMethod>,
): { url: URL; init: RequestInit } => {
	const requestParts = toRequestParts(data);
	const resolvedPath = interpolatePathTemplate(
		path,
		toPathParamsRecord(requestParts?.pathParams),
	);
	const url = new URL(resolvedPath, baseUrl);
	appendQueryParams(url, toRecordObject(requestParts?.query));

	const headers = normalizeHeaderValues(toRecordObject(requestParts?.headers));
	const init: RequestInit = {
		method: method.toUpperCase(),
		headers,
	};

	if (requestParts?.body !== undefined) {
		const body = requestParts.body;
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
		} as Awaited<ReturnType<typeof fetchMethod>>;
	};

	return {
		fetch: fetchMethod,
	};
};
