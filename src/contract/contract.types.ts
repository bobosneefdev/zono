import z from "zod";
import { Shape } from "../shared/shared.types.js";

export type CompiledContractRoute = {
	pathTemplate: string;
	honoPath: string;
	method: HTTPMethod;
	methodDefinition: ContractMethodDefinition;
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

export type Contract = Partial<Record<HTTPMethod, ContractMethodDefinition>>;

export type HTTPMethod = "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

export type ContractMethodDefinition = {
	responses: Record<number, ContractResponseSchema>;
	query?: ContractQuerySchema;
	body?: ContractBodySchema;
	headers?: ContractHeadersSchema;
	pathParams?: z.ZodType<Record<string, string>, Record<string, string>>;
};

export type ContractPathParamsGivenDynamicPaths<TDynamicPaths extends string> = z.ZodType<
	Record<TDynamicPaths, string>,
	Record<TDynamicPaths, string>
>;

export type ContractHeadersSchema =
	| ContractStandardHeadersSchema
	| ContractJSONHeadersSchema
	| ContractSuperJSONHeadersSchema;

export type ResponseSchemaFieldKey = "body" | "schema";

type SchemaContainerByField<TField extends ResponseSchemaFieldKey, TOutput> = TField extends "body"
	? { body: z.ZodType<TOutput, unknown> }
	: { schema: z.ZodType<TOutput, unknown> };

export type ContractStandardHeadersSchema = {
	type: "Standard";
	headers: z.ZodType<Record<string, string | undefined>, Record<string, string | undefined>>;
};

export type ContractJSONHeadersSchema = {
	type: "JSON";
	headers: z.ZodType<
		Record<string, JSONValue | undefined>,
		Record<string, JSONValue | undefined>
	>;
};

export type ContractSuperJSONHeadersSchema = {
	type: "SuperJSON";
	headers: z.ZodType<
		Record<string, SuperJSONValue | undefined>,
		Record<string, SuperJSONValue | undefined>
	>;
};

export type ResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	headers?: ContractHeadersSchema;
} & (
	| ContractJSONResponseSchema<TField>
	| ContractSuperJSONResponseSchema<TField>
	| ContractTextResponseSchema<TField>
	| ContractContentlessResponseSchema
	| ContractFormDataResponseSchema<TField>
	| ContractBlobResponseSchema<TField>
	| ContractBytesResponseSchema<TField>
);

export type ContractResponseSchema = ResponseSchema<"body">;

export type ContractJSONResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	type: "JSON";
} & SchemaContainerByField<TField, JSONValue>;

export type ContractSuperJSONResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	type: "SuperJSON";
} & SchemaContainerByField<TField, SuperJSONValue>;

export type ContractTextResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	type: "Text";
} & SchemaContainerByField<TField, string>;

export type ContractContentlessResponseSchema = {
	type: "Contentless";
	body?: undefined;
};

export type ContractFormDataResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	type: "FormData";
} & SchemaContainerByField<TField, FormData>;

export type ContractBlobResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	type: "Blob";
} & SchemaContainerByField<TField, Blob>;

export type ContractBytesResponseSchema<TField extends ResponseSchemaFieldKey = "body"> = {
	type: "Bytes";
} & SchemaContainerByField<TField, Uint8Array>;

export type RuntimeResponseSchema = ResponseSchema<ResponseSchemaFieldKey>;

export type ContractQuerySchema =
	| ContractStandardQuerySchema
	| ContractJSONQuerySchema
	| ContractSuperJSONQuerySchema;

export type ContractStandardQuerySchema = {
	type: "Standard";
	query: z.ZodType<Record<string, string | undefined>, Record<string, string | undefined>>;
};

export type ContractJSONQuerySchema = {
	type: "JSON";
	query: z.ZodType<Record<string, JSONValue | undefined>, Record<string, JSONValue | undefined>>;
};

export type ContractSuperJSONQuerySchema = {
	type: "SuperJSON";
	query: z.ZodType<
		Record<string, SuperJSONValue | undefined>,
		Record<string, SuperJSONValue | undefined>
	>;
};

export type ContractBodySchema =
	| ContractJSONBodySchema
	| ContractSuperJSONBodySchema
	| ContractFormDataBodySchema
	| ContractURLSearchParamsBodySchema
	| ContractTextBodySchema
	| ContractBlobBodySchema;

export type ContractJSONBodySchema = {
	type: "JSON";
	body: z.ZodType<JSONValue, JSONValue>;
};

export type ContractSuperJSONBodySchema = {
	type: "SuperJSON";
	body: z.ZodType<SuperJSONValue, SuperJSONValue>;
};

export type ContractFormDataBodySchema = {
	type: "FormData";
	body: z.ZodType<FormData, FormData>;
};

export type ContractURLSearchParamsBodySchema = {
	type: "URLSearchParams";
	body: z.ZodType<URLSearchParams, URLSearchParams>;
};

export type ContractTextBodySchema = {
	type: "Text";
	body: z.ZodType<string, string>;
};

export type ContractBlobBodySchema = {
	type: "Blob";
	body: z.ZodType<Blob, Blob>;
};

type ExtractPathParamName<TKey extends string> = TKey extends `$${infer TPathParamName}`
	? TPathParamName
	: never;

type ContractMethodDefinitionWithPathParams<TPathParams extends string> = Omit<
	ContractMethodDefinition,
	"pathParams"
> &
	([TPathParams] extends [never]
		? { pathParams?: undefined }
		: { pathParams: ContractPathParamsGivenDynamicPaths<TPathParams> });

type ContractForPathParams<TPathParams extends string> = Partial<
	Record<HTTPMethod, ContractMethodDefinitionWithPathParams<TPathParams>>
>;

type ContractsFromShape<TShape extends Shape, TPathParams extends string = never> = {
	[K in keyof TShape]: K extends "CONTRACT"
		? TShape[K] extends true
			? ContractForPathParams<TPathParams>
			: never
		: K extends "SHAPE"
			? TShape[K] extends Record<string, Shape>
				? {
						[ChildKey in keyof TShape[K]]: TShape[K][ChildKey] extends Shape
							? ContractsFromShape<
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

export type Contracts<TShape extends Shape> = ContractsFromShape<TShape>;

export type ContractsTree = {
	CONTRACT?: Contract;
	SHAPE?: Record<string, ContractsTree>;
};

export type InferRuntimeResponseData<TResponseSchema extends RuntimeResponseSchema> =
	TResponseSchema extends { body: z.ZodType<infer TOutput, unknown> }
		? TOutput
		: TResponseSchema extends { schema: z.ZodType<infer TOutput, unknown> }
			? TOutput
			: undefined;

export type InferContractResponseData<TResponseSchema extends ContractResponseSchema> =
	InferRuntimeResponseData<TResponseSchema>;

type EmptyRecord = Record<never, never>;

export type InferContractRequestData<TMethodDefinition extends ContractMethodDefinition> =
	(TMethodDefinition extends { pathParams: z.ZodType<infer TPathParams, unknown> }
		? { pathParams: TPathParams }
		: EmptyRecord) &
		(TMethodDefinition extends {
			query: { query: z.ZodType<infer TQuery, unknown> };
		}
			? { query: TQuery }
			: EmptyRecord) &
		(TMethodDefinition extends { body: { body: z.ZodType<infer TBody, unknown> } }
			? { body: TBody }
			: EmptyRecord) &
		(TMethodDefinition extends {
			headers: { headers: z.ZodType<infer THeaders, unknown> };
		}
			? { headers: THeaders }
			: EmptyRecord);

type JoinPath<TPrefix extends string, TSegment extends string> = TPrefix extends ""
	? `/${TSegment}`
	: `${TPrefix}/${TSegment}`;

type NormalizePath<TPath extends string> = TPath extends "" ? "/" : TPath;

export type ContractRouteEntry<TPath extends string, TContract extends Contract> = {
	path: NormalizePath<TPath>;
	contract: TContract;
};

export type ContractRouteEntries<
	TContracts extends ContractsTree,
	TPrefix extends string = "",
> = TContracts extends {
	CONTRACT: infer TContract;
}
	? TContract extends Contract
		?
				| ContractRouteEntry<TPrefix, TContract>
				| (TContracts extends { SHAPE: infer TShape }
						? TShape extends Record<string, ContractsTree>
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
		? TShape extends Record<string, ContractsTree>
			? {
					[K in keyof TShape & string]: ContractRouteEntries<
						TShape[K],
						JoinPath<TPrefix, K>
					>;
				}[keyof TShape & string]
			: never
		: never;

export type ContractPath<TContracts extends ContractsTree> =
	ContractRouteEntries<TContracts>["path"];

export type ContractAtPath<
	TContracts extends ContractsTree,
	TPath extends ContractPath<TContracts>,
> = Extract<ContractRouteEntries<TContracts>, { path: TPath }>["contract"];

export type ContractMethodAtPath<
	TContracts extends ContractsTree,
	TPath extends ContractPath<TContracts>,
	TMethod extends keyof ContractAtPath<TContracts, TPath> & HTTPMethod,
> = NonNullable<ContractAtPath<TContracts, TPath>[TMethod]>;

type InferContractResponseUnionInternal<TResponses extends Record<number, ContractResponseSchema>> =
	{
		[TStatus in keyof TResponses & number]: {
			status: TStatus;
			type: TResponses[TStatus]["type"];
			data: InferContractResponseData<TResponses[TStatus]>;
		};
	}[keyof TResponses & number];

export type InferContractResponseUnion<TMethodDefinition extends ContractMethodDefinition> =
	TMethodDefinition extends { responses: infer TResponses }
		? TResponses extends Record<number, ContractResponseSchema>
			? InferContractResponseUnionInternal<TResponses>
			: never
		: never;
