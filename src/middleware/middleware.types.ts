import type { InferRuntimeResponseData, ResponseSchema } from "../contract/contract.types.js";
import type { Shape } from "../shared/shared.types.js";

declare const MIDDLEWARE_SHAPE_BRAND: unique symbol;

export type MiddlewareResponseSchema = ResponseSchema<"schema">;

export type MiddlewareDefinition = Record<number, MiddlewareResponseSchema>;

export type Middlewares<TShape extends Shape> = {
	MIDDLEWARE: Record<string, MiddlewareDefinition>;
	readonly [MIDDLEWARE_SHAPE_BRAND]?: TShape;
};

export type MiddlewareName<
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
> = keyof TMiddlewares["MIDDLEWARE"] & string;

export type MiddlewareStatusCodes<TDefinition extends MiddlewareDefinition> = keyof TDefinition &
	number;

export type MiddlewareSchemaAtStatus<
	TDefinition extends MiddlewareDefinition,
	TStatus extends MiddlewareStatusCodes<TDefinition>,
> = TDefinition[TStatus];

export type InferMiddlewareResponseData<TSchema extends MiddlewareResponseSchema> =
	InferRuntimeResponseData<TSchema>;

export type InferMiddlewareResponseUnion<TDefinition extends MiddlewareDefinition> = {
	[TStatus in keyof TDefinition & number]: {
		status: TStatus;
		type: TDefinition[TStatus]["type"];
		data: InferMiddlewareResponseData<TDefinition[TStatus]>;
	};
}[keyof TDefinition & number];

export type InferAllMiddlewareResponseUnion<
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
> = {
	[TName in keyof TMiddlewares["MIDDLEWARE"]]: InferMiddlewareResponseUnion<
		TMiddlewares["MIDDLEWARE"][TName]
	>;
}[keyof TMiddlewares["MIDDLEWARE"]];
