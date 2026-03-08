import z from "zod";
import { ensurePath, isRecordObject, joinPath } from "../shared/shared.internal.js";
import {
	type ApiShape,
	type Expand,
	type FetchRoute,
	type InferSchemaData,
	type StatusMapToResponseUnion,
	toHonoPath,
} from "../shared/shared.js";

export type CompiledContractRoute = {
	pathTemplate: string;
	honoPath: string;
	method: HTTPMethod;
	methodDefinition: ContractMethod;
};

export type JSONPrimitive = string | number | boolean | null;

export type JSONValue = JSONPrimitive | { [key: string]: JSONValue } | Array<JSONValue>;

export type SuperJSONPrimitive = JSONPrimitive | undefined | bigint | Date;

export type SuperJSONValue =
	| SuperJSONPrimitive
	| { [key: string]: SuperJSONValue }
	| Array<SuperJSONValue>
	| Map<SuperJSONValue, SuperJSONValue>
	| Set<SuperJSONValue>
	| RegExp;

export type ContractMethods = Partial<Record<HTTPMethod, ContractMethod>>;

export type HTTPMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ContractMethod = {
	responses: Record<number, ResponseSpec>;
	query?: QuerySpec;
	body?: BodySpec;
	headers?: HeadersSpec;
	pathParams?: z.ZodType<Record<string, string>, Record<string, string>>;
};

export type PathParamsFor<TDynamicPaths extends string> = z.ZodType<
	Record<TDynamicPaths, string>,
	Record<TDynamicPaths, string>
>;

export type HeadersSpec = StandardHeadersSpec | JSONHeadersSpec | SuperJSONHeadersSpec;

export type ResponseSpecFieldKey = "body" | "schema";

type SchemaContainerByField<TField extends ResponseSpecFieldKey, TOutput> = TField extends "body"
	? { body: z.ZodType<TOutput, unknown> }
	: { schema: z.ZodType<TOutput, unknown> };

export type StandardHeadersSpec = {
	type: "Standard";
	headers: z.ZodType<Record<string, string | undefined>, Record<string, string | undefined>>;
};

export type JSONHeadersSpec = {
	type: "JSON";
	headers: z.ZodType<
		Record<string, JSONValue | undefined>,
		Record<string, JSONValue | undefined>
	>;
};

export type SuperJSONHeadersSpec = {
	type: "SuperJSON";
	headers: z.ZodType<
		Record<string, SuperJSONValue | undefined>,
		Record<string, SuperJSONValue | undefined>
	>;
};

export type ResponseSchema<TField extends ResponseSpecFieldKey = "body"> = {
	headers?: HeadersSpec;
} & (
	| JSONResponseSpec<TField>
	| SuperJSONResponseSpec<TField>
	| TextResponseSpec<TField>
	| ContentlessResponseSpec
	| FormDataResponseSpec<TField>
	| BlobResponseSpec<TField>
	| BytesResponseSpec<TField>
);

export type ResponseSpec = ResponseSchema<"body">;

export type JSONResponseSpec<TField extends ResponseSpecFieldKey = "body"> = {
	type: "JSON";
} & SchemaContainerByField<TField, JSONValue>;

export type SuperJSONResponseSpec<TField extends ResponseSpecFieldKey = "body"> = {
	type: "SuperJSON";
} & SchemaContainerByField<TField, SuperJSONValue>;

export type TextResponseSpec<TField extends ResponseSpecFieldKey = "body"> = {
	type: "Text";
} & SchemaContainerByField<TField, string>;

export type ContentlessResponseSpec = {
	type: "Contentless";
	body?: undefined;
};

export type FormDataResponseSpec<TField extends ResponseSpecFieldKey = "body"> = {
	type: "FormData";
} & SchemaContainerByField<TField, FormData>;

export type BlobResponseSpec<TField extends ResponseSpecFieldKey = "body"> = {
	type: "Blob";
} & SchemaContainerByField<TField, Blob>;

export type BytesResponseSpec<TField extends ResponseSpecFieldKey = "body"> = {
	type: "Bytes";
} & SchemaContainerByField<TField, Uint8Array>;

export type RuntimeResponseSpec = ResponseSchema<ResponseSpecFieldKey>;

export type QuerySpec = StandardQuerySpec | JSONQuerySpec | SuperJSONQuerySpec;

export type StandardQuerySpec = {
	type: "Standard";
	query: z.ZodType<Record<string, string | undefined>, Record<string, string | undefined>>;
};

export type JSONQuerySpec = {
	type: "JSON";
	query: z.ZodType<Record<string, JSONValue | undefined>, Record<string, JSONValue | undefined>>;
};

export type SuperJSONQuerySpec = {
	type: "SuperJSON";
	query: z.ZodType<
		Record<string, SuperJSONValue | undefined>,
		Record<string, SuperJSONValue | undefined>
	>;
};

export type BodySpec =
	| JSONBodySpec
	| SuperJSONBodySpec
	| FormDataBodySpec
	| URLSearchParamsBodySpec
	| TextBodySpec
	| BlobBodySpec;

export type JSONBodySpec = {
	type: "JSON";
	body: z.ZodType<JSONValue, JSONValue>;
};

export type SuperJSONBodySpec = {
	type: "SuperJSON";
	body: z.ZodType<SuperJSONValue, SuperJSONValue>;
};

export type FormDataBodySpec = {
	type: "FormData";
	body: z.ZodType<FormData, FormData>;
};

export type URLSearchParamsBodySpec = {
	type: "URLSearchParams";
	body: z.ZodType<URLSearchParams, URLSearchParams>;
};

export type TextBodySpec = {
	type: "Text";
	body: z.ZodType<string, string>;
};

export type BlobBodySpec = {
	type: "Blob";
	body: z.ZodType<Blob, Blob>;
};

type ExtractPathParamName<TKey extends string> = TKey extends `$${infer TPathParamName}`
	? TPathParamName
	: never;

type ContractMethodWithPathParams<TPathParams extends string> = Omit<ContractMethod, "pathParams"> &
	([TPathParams] extends [never]
		? { pathParams?: undefined }
		: { pathParams: PathParamsFor<TPathParams> });

type ContractMethodsForPath<TPathParams extends string> = Partial<
	Record<HTTPMethod, ContractMethodWithPathParams<TPathParams>>
>;

type ContractTreeFromShape<TShape extends ApiShape, TPathParams extends string = never> = {
	[K in keyof TShape]: K extends "CONTRACT"
		? TShape[K] extends true
			? ContractMethodsForPath<TPathParams>
			: never
		: K extends "SHAPE"
			? TShape[K] extends Record<string, ApiShape>
				? {
						[ChildKey in keyof TShape[K]]: TShape[K][ChildKey] extends ApiShape
							? ContractTreeFromShape<
									TShape[K][ChildKey],
									| TPathParams
									| (ChildKey extends string
											? ExtractPathParamName<ChildKey>
											: never)
								>
							: never;
					}
				: never
			: never;
};

export type ContractTreeFor<TShape extends ApiShape> = ContractTreeFromShape<TShape>;

export type ContractTree = {
	CONTRACT?: ContractMethods;
	SHAPE?: Record<string, ContractTree>;
};

export type InferRuntimeResponseData<TResponseSpec extends RuntimeResponseSpec> =
	InferSchemaData<TResponseSpec>;

export type InferContractResponseData<TResponseSpec extends ResponseSpec> =
	InferRuntimeResponseData<TResponseSpec>;

type RequestPartOutputs<TMethod extends ContractMethod> = {
	pathParams: TMethod extends { pathParams: z.ZodType<infer TData, unknown> } ? TData : never;
	query: TMethod extends { query: { query: z.ZodType<infer TData, unknown> } } ? TData : never;
	body: TMethod extends { body: { body: z.ZodType<infer TData, unknown> } } ? TData : never;
	headers: TMethod extends { headers: { headers: z.ZodType<infer TData, unknown> } }
		? TData
		: never;
};

export type RequestData<TMethod extends ContractMethod> = Expand<{
	[TKey in keyof RequestPartOutputs<TMethod> as [RequestPartOutputs<TMethod>[TKey]] extends [
		never,
	]
		? never
		: TKey]: RequestPartOutputs<TMethod>[TKey];
}>;

type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? `/${TSegment}`
	: `${TPrefix}/${TSegment}`;

type NormalizePath<TPath extends string> = TPath extends "" ? "/" : TPath;

export type ContractRouteEntry<TPath extends string, TContract extends ContractMethods> = {
	path: NormalizePath<TPath>;
	contract: TContract;
};

export type ContractRouteEntries<
	TContracts extends ContractTree,
	TPrefix extends string = "",
> = TContracts extends {
	CONTRACT: infer TContract;
}
	? TContract extends ContractMethods
		?
				| ContractRouteEntry<TPrefix, TContract>
				| (TContracts extends { SHAPE: infer TShape }
						? TShape extends Record<string, ContractTree>
							? {
									[K in keyof TShape & string]: ContractRouteEntries<
										TShape[K],
										JoinPath<TPrefix, K>
									>;
								}[keyof TShape & string]
							: never
						: never)
		: never
	: TContracts extends { SHAPE: infer TShape }
		? TShape extends Record<string, ContractTree>
			? {
					[K in keyof TShape & string]: ContractRouteEntries<
						TShape[K],
						JoinPath<TPrefix, K>
					>;
				}[keyof TShape & string]
			: never
		: never;

export type ContractPath<TContracts extends ContractTree> =
	ContractRouteEntries<TContracts>["path"];

export type ContractAtPath<
	TContracts extends ContractTree,
	TPath extends ContractPath<TContracts>,
> = Extract<ContractRouteEntries<TContracts>, { path: TPath }>["contract"];

export type ContractMethodAtPath<
	TContracts extends ContractTree,
	TPath extends ContractPath<TContracts>,
	TMethod extends keyof ContractAtPath<TContracts, TPath> & HTTPMethod,
> = NonNullable<ContractAtPath<TContracts, TPath>[TMethod]>;

export type InferContractResponseUnion<TMethod extends ContractMethod> = TMethod extends {
	responses: infer TResponses;
}
	? TResponses extends Record<number, ResponseSpec>
		? StatusMapToResponseUnion<TResponses>
		: never
	: never;

type ContractCallsFromRouteEntry<TRouteEntry> = TRouteEntry extends {
	path: infer TPath extends string;
	contract: infer TContract extends ContractMethods;
}
	? {
			[TMethod in keyof TContract & HTTPMethod]: NonNullable<
				TContract[TMethod]
			> extends ContractMethod
				? {
						path: TPath;
						method: TMethod;
						request: RequestData<NonNullable<TContract[TMethod]>>;
						response: InferContractResponseUnion<NonNullable<TContract[TMethod]>>;
					}
				: never;
		}[keyof TContract & HTTPMethod]
	: never;

export type ContractCallRoute = FetchRoute;

export type ContractCallRoutes<TContracts extends ContractTree> = ContractCallsFromRouteEntry<
	ContractRouteEntries<TContracts>
>;

const isHTTPMethod = (value: string): value is HTTPMethod => {
	return (
		value === "get" ||
		value === "post" ||
		value === "put" ||
		value === "delete" ||
		value === "patch" ||
		value === "options" ||
		value === "head"
	);
};

export const compileContractRoutes = <TContracts extends ContractTree>(
	contracts: TContracts,
): Array<CompiledContractRoute> => {
	const routes: Array<CompiledContractRoute> = [];

	const walk = (node: unknown, pathPrefix: string): void => {
		if (!isRecordObject(node)) {
			return;
		}

		if (isRecordObject(node.CONTRACT)) {
			for (const [candidateMethod, candidateMethodDefinition] of Object.entries(
				node.CONTRACT,
			)) {
				if (!isHTTPMethod(candidateMethod) || !isRecordObject(candidateMethodDefinition)) {
					continue;
				}

				const pathTemplate = ensurePath(pathPrefix);
				routes.push({
					pathTemplate,
					honoPath: toHonoPath(pathTemplate),
					method: candidateMethod,
					methodDefinition: candidateMethodDefinition as ContractMethod,
				});
			}
		}

		if (!isRecordObject(node.SHAPE)) {
			return;
		}

		for (const [segment, childNode] of Object.entries(node.SHAPE)) {
			walk(childNode, joinPath(pathPrefix, segment));
		}
	};

	walk(contracts, "");
	return routes;
};

export const getContractRequestParsers = (
	methodDefinition: ContractMethod,
): {
	pathParams?: ContractMethod["pathParams"];
	query?: QuerySpec;
	body?: BodySpec;
	headers?: HeadersSpec;
} => {
	return {
		pathParams: methodDefinition.pathParams,
		query: methodDefinition.query,
		body: methodDefinition.body,
		headers: methodDefinition.headers,
	};
};

export const getContractResponseSchema = (
	methodDefinition: ContractMethod,
	status: number,
): RuntimeResponseSpec | undefined => {
	return methodDefinition.responses[status];
};

export const validateContractResponseType = (
	responseSchema: RuntimeResponseSpec,
	type: string,
): boolean => {
	return responseSchema.type === type;
};

export const isContractLike = (value: unknown): value is ContractMethods => {
	if (!isRecordObject(value)) {
		return false;
	}

	for (const [key, methodDefinition] of Object.entries(value)) {
		if (!isHTTPMethod(key)) {
			return false;
		}
		if (methodDefinition !== undefined && !isRecordObject(methodDefinition)) {
			return false;
		}
	}

	return true;
};
