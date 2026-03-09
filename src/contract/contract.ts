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

type SchemaCarrier<TType extends string, TOutput, TInput = TOutput> = {
	type: TType;
	schema: z.ZodType<TOutput, TInput>;
};

export type HeadersSpec = StandardHeadersSpec | JSONHeadersSpec | SuperJSONHeadersSpec;

export type StandardHeadersSpec = SchemaCarrier<"Standard", Record<string, string | undefined>>;

export type JSONHeadersSpec = SchemaCarrier<"JSON", JSONValue | undefined>;

export type SuperJSONHeadersSpec = SchemaCarrier<"SuperJSON", SuperJSONValue | undefined>;

export type ResponseSchema = {
	headers?: HeadersSpec;
} & (
	| JSONResponseSpec
	| SuperJSONResponseSpec
	| TextResponseSpec
	| ContentlessResponseSpec
	| FormDataResponseSpec
	| BlobResponseSpec
	| BytesResponseSpec
);

export type ResponseSpec = ResponseSchema;

export type JSONResponseSpec = SchemaCarrier<"JSON", JSONValue, unknown>;

export type SuperJSONResponseSpec = SchemaCarrier<"SuperJSON", SuperJSONValue, unknown>;

export type TextResponseSpec = SchemaCarrier<"Text", string, unknown>;

export type ContentlessResponseSpec = {
	type: "Contentless";
	schema?: undefined;
};

export type FormDataResponseSpec = SchemaCarrier<"FormData", FormData, unknown>;

export type BlobResponseSpec = SchemaCarrier<"Blob", Blob, unknown>;

export type BytesResponseSpec = SchemaCarrier<"Bytes", Uint8Array, unknown>;

export type QuerySpec = StandardQuerySpec | JSONQuerySpec | SuperJSONQuerySpec;

export type StandardQuerySpec = SchemaCarrier<"Standard", Record<string, string | undefined>>;

export type JSONQuerySpec = SchemaCarrier<"JSON", JSONValue | undefined>;

export type SuperJSONQuerySpec = SchemaCarrier<"SuperJSON", SuperJSONValue | undefined>;

export type BodySpec =
	| JSONBodySpec
	| SuperJSONBodySpec
	| FormDataBodySpec
	| URLSearchParamsBodySpec
	| TextBodySpec
	| BlobBodySpec;

export type JSONBodySpec = SchemaCarrier<"JSON", JSONValue>;

export type SuperJSONBodySpec = SchemaCarrier<"SuperJSON", SuperJSONValue>;

export type FormDataBodySpec = SchemaCarrier<"FormData", FormData>;

export type URLSearchParamsBodySpec = SchemaCarrier<"URLSearchParams", URLSearchParams>;

export type TextBodySpec = SchemaCarrier<"Text", string>;

export type BlobBodySpec = SchemaCarrier<"Blob", Blob>;

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

export type InferRuntimeResponseData<TResponseSpec extends ResponseSpec> =
	InferSchemaData<TResponseSpec>;

export type InferContractResponseData<TResponseSpec extends ResponseSpec> =
	InferRuntimeResponseData<TResponseSpec>;

type RequestPartOutputs<TMethod extends ContractMethod> = {
	pathParams: TMethod extends { pathParams: z.ZodType<infer TData, unknown> } ? TData : never;
	query: TMethod extends { query: { schema: z.ZodType<infer TData, unknown> } } ? TData : never;
	body: TMethod extends { body: { schema: z.ZodType<infer TData, unknown> } } ? TData : never;
	headers: TMethod extends { headers: { schema: z.ZodType<infer TData, unknown> } }
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

type QueryClientInput<TQuerySpec extends QuerySpec> = TQuerySpec extends StandardQuerySpec
	? { type: "Standard"; data: InferSchemaData<TQuerySpec> }
	: TQuerySpec extends JSONQuerySpec
		? { type: "JSON"; data: InferSchemaData<TQuerySpec> }
		: TQuerySpec extends SuperJSONQuerySpec
			? { type: "SuperJSON"; data: InferSchemaData<TQuerySpec> }
			: never;

type HeadersClientInput<THeadersSpec extends HeadersSpec> = THeadersSpec extends StandardHeadersSpec
	? { type: "Standard"; data: InferSchemaData<THeadersSpec> }
	: THeadersSpec extends JSONHeadersSpec
		? { type: "JSON"; data: InferSchemaData<THeadersSpec> }
		: THeadersSpec extends SuperJSONHeadersSpec
			? { type: "SuperJSON"; data: InferSchemaData<THeadersSpec> }
			: never;

type BodyClientInput<TBodySpec extends BodySpec> = TBodySpec extends JSONBodySpec
	? { type: "JSON"; data: InferSchemaData<TBodySpec> }
	: TBodySpec extends SuperJSONBodySpec
		? { type: "SuperJSON"; data: InferSchemaData<TBodySpec> }
		: TBodySpec extends FormDataBodySpec
			? { type: "FormData"; data: InferSchemaData<TBodySpec> }
			: TBodySpec extends URLSearchParamsBodySpec
				? { type: "URLSearchParams"; data: InferSchemaData<TBodySpec> }
				: TBodySpec extends TextBodySpec
					? { type: "Text"; data: InferSchemaData<TBodySpec> }
					: TBodySpec extends BlobBodySpec
						? { type: "Blob"; data: InferSchemaData<TBodySpec> }
						: never;

type ClientRequestPartOutputs<TMethod extends ContractMethod> = {
	pathParams: TMethod extends { pathParams: z.ZodType<infer TData, unknown> } ? TData : never;
	query: TMethod extends { query: infer TQuerySpec extends QuerySpec }
		? QueryClientInput<TQuerySpec>
		: never;
	body: TMethod extends { body: infer TBodySpec extends BodySpec }
		? BodyClientInput<TBodySpec>
		: never;
	headers: TMethod extends { headers: infer THeadersSpec extends HeadersSpec }
		? HeadersClientInput<THeadersSpec>
		: never;
};

type OptionalClientRequestKeys<TMethod extends ContractMethod> = {
	[TKey in keyof ClientRequestPartOutputs<TMethod>]: ClientRequestPartOutputs<TMethod>[TKey] extends {
		data: infer TData;
	}
		? undefined extends TData
			? TKey
			: never
		: never;
}[keyof ClientRequestPartOutputs<TMethod>];

type RequiredClientRequestKeys<TMethod extends ContractMethod> = Exclude<
	{
		[TKey in keyof ClientRequestPartOutputs<TMethod>]: [
			ClientRequestPartOutputs<TMethod>[TKey],
		] extends [never]
			? never
			: TKey;
	}[keyof ClientRequestPartOutputs<TMethod>],
	OptionalClientRequestKeys<TMethod>
>;

export type ClientRequestData<TMethod extends ContractMethod> = Expand<
	{
		[TKey in RequiredClientRequestKeys<TMethod>]: ClientRequestPartOutputs<TMethod>[TKey];
	} & {
		[TKey in OptionalClientRequestKeys<TMethod>]?: ClientRequestPartOutputs<TMethod>[TKey];
	}
>;

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
						request: ClientRequestData<NonNullable<TContract[TMethod]>>;
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
): ResponseSpec | undefined => {
	return methodDefinition.responses[status];
};

export const validateContractResponseType = (
	responseSchema: ResponseSpec,
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
