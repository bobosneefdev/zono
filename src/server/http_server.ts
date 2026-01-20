import { Server, serve } from "bun";
import { Context, Handler, Hono, MiddlewareHandler, Next } from "hono";
import { ContentfulStatusCode, SuccessStatusCode } from "hono/utils/http-status";
import z from "zod";
import { createDocument, ZodOpenApiOperationObject, ZodOpenApiPathsObject } from "zod-openapi";
import {
	AllKeysAreOptional,
	AreTypesEqual,
	NestObjectConditional,
	OptionalPromise,
	PathString,
} from "../internal/types.js";
import { typedObjectEntries, typedPick } from "../internal/util.js";
import { ZonoEndpoint, ZonoEndpointHeaders, ZonoEndpointRecord } from "../shared/endpoint.js";
import { ZonoSocketServer } from "./socket_server.js";

export class ZonoHttpServer<
	T extends ZonoEndpointRecord,
	U extends ZonoHttpServerConfig<T>,
	V extends ZonoHttpServerOptions<T, U>,
> {
	readonly endpoints: T;
	readonly endpointPaths: Record<keyof T, PathString>;
	readonly conf: U;
	readonly opts: V;
	private _server: Server<any> | null = null;

	constructor(endpoints: T, conf: U, opts: V) {
		this.endpoints = endpoints;
		this.conf = conf;
		this.opts = opts;
		this.endpointPaths = this.initPaths(endpoints);
	}

	private initPaths(endpoints: T): Record<keyof T, PathString> {
		const paths = {} as Record<keyof T, PathString>;
		for (const [endpointName, endpoint] of typedObjectEntries(endpoints)) {
			paths[endpointName] = this.getPath(endpoint);
		}
		return paths;
	}

	private getPath(endpoint: ZonoEndpoint): PathString {
		let path: PathString = `${this.conf.basePath ?? ""}${endpoint.path}`;

		if (endpoint.additionalPaths) {
			const pathParts = endpoint.additionalPaths._zod.def.items;
			for (let i = 0; i < pathParts.length; i++) {
				path += `/:${i}`;
			}
		}

		return path;
	}

	start(): Server<any> {
		if (this._server) throw new Error("Server already started");

		const app = new Hono();

		const middleware = this.createMiddleware();
		if (middleware) {
			for (const mw of middleware) {
				app.use(mw);
			}
		}

		const seenCoveredPaths = new Set();
		for (const [endpointName, endpoint] of typedObjectEntries(this.endpoints)) {
			const endpointPath = this.endpointPaths[endpointName];
			const coveredPath = `${endpoint.method} ${endpointPath}`;
			if (seenCoveredPaths.has(coveredPath)) {
				throw new Error(`Path ${coveredPath} is already covered`);
			}
			seenCoveredPaths.add(coveredPath);

			const instantiator = app[endpoint.method].bind(app);
			const handler = this.createEndpointHandler(endpointName);
			instantiator(endpointPath, handler);
		}

		if (this.opts.openApiOptions) {
			app.get(`${this.opts.openApiOptions.path}.json`, (c) => c.json(this.getOpenApiJson()));
			app.get(this.opts.openApiOptions.path, (c) => c.html(this.getOpenApiHtml()));
		}

		const socket = this.conf.socket;
		const { websocket } = socket?.engine.handler() ?? {};

		const baseOptions = {
			fetch(req: Request, server: Server<any>) {
				if (socket) {
					const url = new URL(req.url);
					const socketStart = socket.serverOpts.path ?? "/socket.io";
					if (url.pathname.startsWith(socketStart)) {
						return socket.engine.handleRequest(req, server);
					}
				}
				return app.fetch(req, server);
			},
			port: this.conf.port,
			hostname: this.conf.bind,
			idleTimeout: 30,
		};

		this._server = websocket ? serve({ ...baseOptions, websocket }) : serve(baseOptions);
		return this._server;
	}

	get server() {
		return this._server;
	}

	async stop(closeActiveConnections = false) {
		if (!this._server) return;
		await this._server.stop(closeActiveConnections);
		this._server = null;
	}

	private createEndpointHandler<K extends keyof T & string>(endpointName: K): Handler {
		return async (ctx) => {
			try {
				const options = {
					...this.opts.globalHandlerOpts,
					...this.opts.specificHandlerOpts?.[endpointName],
				};

				const parsedPath = await this.parseAdditionalPath(endpointName, options, ctx);
				if (!parsedPath.valid) return this.jsonResponseFail(ctx, parsedPath.response);

				const parsedBody = await this.parseBody(endpointName, options, ctx);
				if (!parsedBody.valid) return this.jsonResponseFail(ctx, parsedBody.response);

				const parsedQuery = await this.parseQuery(endpointName, options, ctx);
				if (!parsedQuery.valid) return this.jsonResponseFail(ctx, parsedQuery.response);

				const parsedHeaders = await this.parseHeaders(endpointName, options, ctx);
				if (!parsedHeaders.valid) return this.jsonResponseFail(ctx, parsedHeaders.response);

				const fn = this.conf.handlers[endpointName];
				const response = await fn({
					body: parsedBody.data,
					query: parsedQuery.data,
					headers: parsedHeaders.data,
					additionalPaths: parsedPath.data,
				} as any);

				if (!response.success) {
					return this.jsonResponseFail(ctx, response);
				}

				return this.jsonResponseSuccess(ctx, response);
			} catch (error) {
				console.debug(error);
				return this.jsonResponseFail(ctx, { status: 500, error: "Internal server error" });
			}
		};
	}

	private async parseAdditionalPath<K extends keyof T & string>(
		endpointName: K,
		endpointOptions: ZonoEndpointHandlerOptions,
		ctx: Context,
	): Promise<ZonoHttpServerParseHelperReturn<T[K]["additionalPaths"]>> {
		const endpoint = this.endpoints[endpointName];
		if (!endpoint.additionalPaths) return { valid: true };

		const removeApiBase = this.conf.basePath
			? ctx.req.path.replace(this.conf.basePath, "")
			: ctx.req.path;
		const removeEndpointBase = removeApiBase.replace(endpoint.path, "");

		const parts = removeEndpointBase.split("/").slice(1);
		const parsed = await endpoint.additionalPaths.safeParseAsync(parts);
		if (!parsed.success) {
			return {
				valid: false,
				response: {
					status: 400,
					error: "Invalid path",
					zodError: endpointOptions?.obfuscate
						? undefined
						: JSON.parse(parsed.error.message),
				},
			};
		}

		return {
			valid: true,
			data: parsed.data as any,
		};
	}

	private async parseBody<K extends keyof T & string>(
		endpointName: K,
		endpointOptions: ZonoEndpointHandlerOptions,
		ctx: Context,
	): Promise<ZonoHttpServerParseHelperReturn<T[K]["body"]>> {
		const endpoint = this.endpoints[endpointName];
		if (!endpoint.body) return { valid: true };

		const body = await ctx.req.json();
		const parsed = await endpoint.body.safeParseAsync(body);
		if (!parsed.success) {
			return {
				valid: false,
				response: {
					status: 400,
					error: "Invalid body",
					...(endpointOptions.obfuscate
						? {}
						: { zodError: JSON.parse(parsed.error.message) }),
				},
			};
		}

		return {
			valid: true,
			data: parsed.data as any,
		};
	}

	private async parseQuery<K extends keyof T & string>(
		endpointName: K,
		endpointOptions: ZonoEndpointHandlerOptions,
		ctx: Context,
	): Promise<ZonoHttpServerParseHelperReturn<T[K]["query"]>> {
		const endpoint = this.endpoints[endpointName];
		if (!endpoint.query) return { valid: true };

		const raw = ctx.req.queries();
		const converters = this.getConverters(endpointName);
		const converter = converters.query;
		const toParse = converter ? converter(raw) : raw;

		const parsed = await endpoint.query.safeParseAsync(toParse);
		if (!parsed.success) {
			return {
				valid: false,
				response: {
					status: 400,
					error: "Invalid query parameters",
					...(endpointOptions.obfuscate
						? {}
						: { zodError: JSON.parse(parsed.error.message) }),
				},
			};
		}

		return {
			valid: true,
			data: parsed.data as any,
		};
	}

	private async parseHeaders<K extends keyof T & string>(
		endpointName: K,
		endpointOptions: ZonoEndpointHandlerOptions,
		ctx: Context,
	): Promise<ZonoHttpServerParseHelperReturn<T[K]["headers"]>> {
		const endpoint = this.endpoints[endpointName];
		if (!endpoint.headers) return { valid: true };

		const raw = ctx.req.header();

		const converters = this.getConverters(endpointName);
		const converter = converters.headers;
		const toParse = converter ? converter(raw) : raw;

		const parsed = await endpoint.headers.safeParseAsync(toParse);
		if (!parsed.success) {
			return {
				valid: false,
				response: {
					status: 400,
					error: "Invalid headers",
					...(endpointOptions.obfuscate
						? {}
						: { zodError: JSON.parse(parsed.error.message) }),
				},
			};
		}

		return {
			valid: true,
			data: parsed.data as any,
		};
	}

	private createMiddleware(): Array<MiddlewareHandler> | null {
		if (!this.opts.middleware) return null;

		const formatted: Array<MiddlewareHandler> = [];
		for (const middleware of this.opts.middleware) {
			formatted.push(async (ctx, next) => {
				const middlewareHeadersConfig = this.conf.middlewareHeaders;
				if (!middlewareHeadersConfig) {
					return (middleware as any)(ctx, next);
				}

				const rawHeaders = ctx.req.header();
				const headersSchema = middlewareHeadersConfig.schema;
				const converter = middlewareHeadersConfig.opts?.converter;
				const toParse = converter ? converter(rawHeaders) : rawHeaders;

				const parsed = await headersSchema.safeParseAsync(toParse);
				if (!parsed.success) {
					return ctx.json(
						{
							error: "Invalid middleware headers",
							zodError: JSON.parse(parsed.error.message),
						},
						400,
					);
				}

				return (middleware as any)(ctx, next, parsed.data);
			});
		}
		return formatted;
	}

	private getConverters(endpointName: string) {
		const converters = this.conf.converters[endpointName as keyof typeof this.conf.converters];
		return converters ?? {};
	}

	private jsonResponseFail(ctx: Context, data: Omit<ZonoEndpointHandlerOutputFail, "success">) {
		return ctx.json(
			{
				...typedPick(data, ["error", "zodError"]),
			},
			data.status,
		);
	}

	private jsonResponseSuccess<T extends ZonoEndpointHandlerOutputSuccess<any>>(
		ctx: Context,
		data: Omit<T, "success">,
	) {
		return ctx.json(data.data, data.status);
	}

	private getOpenApiJson() {
		if (!this.opts.openApiOptions) {
			throw new Error("OpenAPI options are not set");
		}
		const docs = createDocument({
			openapi: "3.0.0",
			info: {
				title: this.opts.openApiOptions.title,
				version: this.opts.openApiOptions.version,
			},
			paths: typedObjectEntries(this.endpoints).reduce((p, [name, opts]) => {
				p[this.endpointPaths[name]] = {
					[opts.method]: this.getOpenApiEndpointData(name),
				};
				return p;
			}, {} as ZodOpenApiPathsObject),
		});

		return docs;
	}

	private getOpenApiEndpointData(endpointName: keyof T & string): ZodOpenApiOperationObject {
		const endpoint = this.endpoints[endpointName];
		const moreInfo = this.opts.openApiOptions?.descriptions?.[endpointName];
		const data: ZodOpenApiOperationObject = {
			...moreInfo,
			responses: {
				"200": {
					description: "Success",
					content: {
						"application/json": {
							schema: endpoint.response,
						},
					},
				},
			},
		};

		if (endpoint.body) {
			data.requestBody = {
				content: {
					"application/json": {
						schema: endpoint.body,
					},
				},
			};
		}

		const warningLines = [
			"ZONO OPENAPI ENDPOINT ISSUE!",
			"OpenAPI documentation not fully supported!",
			`Endpoint: ${endpoint.method.toUpperCase()} ${endpoint.path}`,
			"Reasons:",
		];
		const defaultWarningLinesLength = warningLines.length;

		if (endpoint.query) {
			data.requestParams ??= {};
			if (endpoint.query instanceof z.ZodObject) {
				data.requestParams.query = endpoint.query;
			} else {
				warningLines.push("- Query parameters only supported for ZodObjects");
			}
		}

		if (endpoint.headers) {
			data.requestParams ??= {};
			if (endpoint.headers instanceof z.ZodObject) {
				data.requestParams.header = endpoint.headers;
			} else {
				warningLines.push("- Headers only supported for ZodObjects");
			}
		}

		if (warningLines.length > defaultWarningLinesLength) {
			console.warn(warningLines.join("\n"));
		}

		return data;
	}

	private getOpenApiHtml() {
		if (!this.opts.openApiOptions) {
			throw new Error("OpenAPI options are not set");
		}
		const str = `
            <!DOCTYPE html>
            <html>
                <head>
                    <title>${this.opts.openApiOptions.title} Docs</title>
                    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
                </head>
                <body>
                    <div id="swagger-ui"></div>
                    <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
                    <script>
                        window.onload = () => {
                            SwaggerUIBundle({
                                url: '${this.opts.openApiOptions.path}.json',
                                dom_id: '#swagger-ui',
                            })
                        }
                    </script>
                </body>
            </html>
        `;

		return str;
	}
}

export type ZonoHttpServerConfig<T extends ZonoEndpointRecord> = {
	bind: string;
	port: number;
	handlers: ZonoHttpServerHandlers<T>;
	converters: ZonoEndpointConvertersRecord<T>;
	basePath?: PathString;
	socket?: ZonoSocketServer;
	/**
	 * Use the `createZonoHttpServerMiddlewareHeaders` function to create this value.
	 */
	middlewareHeaders?: ZonoHttpServerMiddlewareHeadersAny;
};

export type ZonoHttpServerHandlers<T extends ZonoEndpointRecord> = {
	[K in keyof T]: ZonoEndpointHandler<T[K]>;
};

export type ZonoEndpointHandler<T extends ZonoEndpoint = ZonoEndpoint> = (
	options: ZonoEndpointHandlerInput<T>,
) => OptionalPromise<ZonoEndpointHandlerOutput<T>>;

export type ZonoEndpointHandlerOutput<T extends ZonoEndpoint = ZonoEndpoint> =
	| ZonoEndpointHandlerOutputSuccess<T>
	| ZonoEndpointHandlerOutputFail;

export type ZonoEndpointHandlerOutputSuccess<T extends ZonoEndpoint> = {
	success: true;
	status: ContentfulStatusCode & SuccessStatusCode;
	data: z.input<T["response"]>;
};

export type BaseZonoEndpointHandlerOutputFail = {
	status: Exclude<ContentfulStatusCode, SuccessStatusCode>;
	error: string;
	zodError?: z.ZodError;
};

export type ZonoEndpointHandlerOutputFail = {
	success: false;
} & BaseZonoEndpointHandlerOutputFail;

export type ZonoEndpointHandlerOptions = {
	obfuscate?: boolean;
};

export type ZonoEndpointHandlerInput<T extends ZonoEndpoint> = NestObjectConditional<
	T["body"],
	z.ZodType,
	"body",
	z.input<T["body"]>
> &
	NestObjectConditional<T["query"], z.ZodType, "query", z.input<T["query"]>> &
	NestObjectConditional<T["headers"], z.ZodType, "headers", z.input<T["headers"]>> &
	NestObjectConditional<
		T["additionalPaths"],
		z.ZodType,
		"additionalPaths",
		z.input<T["additionalPaths"]>
	>;

/**
 * Functions that converts the HTTP-friendly output back to the zod parsable input if the two differ.
 */
export type ZonoEndpointConvertersRecord<T extends ZonoEndpointRecord> = {
	[K in keyof T as AllKeysAreOptional<ZonoEndpointConverters<T[K]>> extends true
		? never
		: K]: ZonoEndpointConverters<T[K]>;
};

export type ZonoEndpointConverters<T extends ZonoEndpoint> = NestObjectConditional<
	ZodOutToInConverter<T["headers"]>,
	NonNullable<ZodOutToInConverter<T["headers"]>>,
	"headers",
	ZodOutToInConverter<T["headers"]>
> &
	NestObjectConditional<
		ZodOutToInConverter<T["query"]>,
		NonNullable<ZodOutToInConverter<T["query"]>>,
		"query",
		ZodOutToInConverter<T["query"]>
	> &
	NestObjectConditional<
		ZodOutToInConverter<T["additionalPaths"]>,
		NonNullable<ZodOutToInConverter<T["additionalPaths"]>>,
		"additionalPaths",
		ZodOutToInConverter<T["additionalPaths"]>
	>;

type ZodOutToInConverter<T extends z.ZodType | undefined> = T extends undefined
	? never
	: AreTypesEqual<z.output<T>, z.input<T>> extends true
		? never
		: Converter<z.output<T>, z.input<T>>;

type Converter<T, U> = (input: Readonly<T>) => U;

export type ZonoHttpServerOptions<
	T extends ZonoEndpointRecord,
	U extends ZonoHttpServerConfig<T>,
> = {
	globalHandlerOpts?: ZonoEndpointHandlerOptions;
	specificHandlerOpts?: Partial<Record<keyof T, ZonoEndpointHandlerOptions>>;
	openApiOptions?: ZonoHttpServerOpenApiOptions<T>;
	middleware?: Array<ZonoMiddleware<U["middlewareHeaders"]>>;
};

type ZonoHttpServerMiddlewareHeadersAny = Omit<MiddlewareHeaders<ZonoEndpointHeaders>, "opts"> & {
	opts?: Omit<MiddlewareHeadersOptions<ZonoEndpointHeaders>, "converter"> &
		(
			| {
					converter?: undefined;
			  }
			| {
					converter: Converter<any, any>;
			  }
		);
};

type MiddlewareHeaders<T extends ZonoEndpointHeaders> = {
	schema: T;
} & NestObjectConditional<
	AreTypesEqual<z.output<T>, z.input<T>>,
	false,
	"opts",
	MiddlewareHeadersOptions<T>
>;

type MiddlewareHeadersOptions<T extends ZonoEndpointHeaders> = NestObjectConditional<
	AreTypesEqual<z.output<T>, z.input<T>>,
	false,
	"converter",
	ZodOutToInConverter<T>
>;

type MiddlewareHeadersOptionsList<T extends ZonoEndpointHeaders> =
	AreTypesEqual<z.output<T>, z.input<T>> extends true
		? [opts?: MiddlewareHeadersOptions<T>]
		: [opts: MiddlewareHeadersOptions<T>];

export function createZonoHttpServerMiddlewareHeaders<T extends ZonoEndpointHeaders>(
	headers: T,
	...opts: MiddlewareHeadersOptionsList<T>
): MiddlewareHeaders<T> {
	return {
		schema: headers,
		opts: opts[0],
	} as any;
}

export type ZonoMiddleware<T extends ZonoHttpServerMiddlewareHeadersAny | undefined = undefined> = (
	c: Context,
	next: Next,
	...args: ZonoMiddlewarePassIns<T>
) => OptionalPromise<Response | undefined>;

type ZonoMiddlewarePassIns<T extends ZonoHttpServerMiddlewareHeadersAny | undefined> =
	T extends ZonoHttpServerMiddlewareHeadersAny ? [middlewareHeaders: z.output<T["schema"]>] : [];

export type ZonoHttpServerOpenApiOptions<T extends ZonoEndpointRecord> = {
	title: string;
	version: string;
	path: string;
	descriptions?: {
		[K in keyof T]?: Pick<
			ZodOpenApiOperationObject,
			"deprecated" | "summary" | "description" | "tags"
		>;
	};
};

type ZonoHttpServerParseHelperReturn<T extends z.ZodType | undefined> =
	| {
			valid: true;
			data?: T extends z.ZodType ? z.output<T> : undefined;
	  }
	| {
			valid: false;
			response: BaseZonoEndpointHandlerOutputFail;
	  };
