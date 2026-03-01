import type { ErrorMode } from "~/contract/contract.error.js";
import type { AdditionalHandlerParamsFn, HonoContextParams } from "~/hono/hono.types.js";

export type GatewayServiceInput = {
	routes: unknown;
	middleware?: unknown;
};

export type GatewayInput = Record<string, GatewayServiceInput>;

export type GeneratedGatewayRoutes<T extends GatewayInput> = {
	ROUTER: {
		[K in keyof T & string]: T[K]["routes"];
	};
};

export type GeneratedGatewayMiddleware<T extends GatewayInput> = {
	ROUTER: {
		[K in keyof T & string]: T[K] extends { middleware: infer M } ? M : Record<never, never>;
	};
};

export type GeneratedGateway<T extends GatewayInput> = {
	routes: GeneratedGatewayRoutes<T>;
	middleware: GeneratedGatewayMiddleware<T>;
};

export type GatewayOptions<TRoutes, TContextParams extends HonoContextParams = []> = {
	additionalHandlerParams?: AdditionalHandlerParamsFn<TContextParams>;
	services: TRoutes extends { ROUTER: infer R extends Record<string, unknown> }
		? { [K in keyof R & string]: string }
		: Record<string, string>;
	errorMode?: ErrorMode;
	basePath?: string;
};
