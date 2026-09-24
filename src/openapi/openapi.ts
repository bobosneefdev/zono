import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Hono } from "hono";
import { stringify } from "yaml";
import {
	type AnyApiDefinition,
	type CompiledContractRoute,
	type ContractMethod,
	compileContractRoutes,
	type ResponseSpec,
} from "../contract/contract.js";
import { type GatewayMiddlewares, type GatewayServices } from "../gateway/gateway.js";
import { applyGatewayServiceMask, namespaceGatewayPath } from "../gateway/gateway_routes.js";
import type { MiddlewareTree } from "../middleware/middleware.js";
import { collectShapePathNodes, isRecordObject } from "../shared/shared.js";

type SplitPath<TPath extends string> = TPath extends ""
	? []
	: TPath extends `${infer TFirst}/${infer TRest}`
		? [TFirst, ...SplitPath<TRest>]
		: [TPath];

type PathSegments<TPath extends string> = TPath extends `/${infer TRest}`
	? SplitPath<TRest>
	: SplitPath<TPath>;

type MatchesRoute<TRoute extends Array<string>, TPath extends Array<string>> = TRoute extends [
	infer TRouteSegment extends string,
	...infer TRestRoute extends Array<string>,
]
	? TPath extends [infer TPathSegment extends string, ...infer TRestPath extends Array<string>]
		? TRouteSegment extends `$${string}`
			? MatchesRoute<TRestRoute, TRestPath>
			: TRouteSegment extends TPathSegment
				? MatchesRoute<TRestRoute, TRestPath>
				: false
		: false
	: TPath extends []
		? true
		: false;

type Occupied<TPath extends string, TRoutes extends string> = true extends (
	TRoutes extends string
		? MatchesRoute<PathSegments<TRoutes>, PathSegments<TPath>>
		: never
)
	? true
	: false;

type SafeOpenApiPath<TPath extends string, TRoutes extends string> = string extends TPath
	? never
	: TPath extends `/${string}`
		? TPath extends `//${string}` | `${string}${"?" | "#" | ":" | "$" | "*" | "\\"}${string}`
			? never
			: Occupied<TPath, TRoutes> extends true
				? never
				: TPath
		: never;

export type OpenApiEndpointConfig<
	TGetPaths extends string,
	TYamlPath extends string,
	TUiPath extends string,
> = {
	yamlPath: SafeOpenApiPath<TYamlPath, TGetPaths>;
	uiPath?: TUiPath & SafeOpenApiPath<TUiPath, TGetPaths | TYamlPath>;
	title: string;
	version: string;
};

export type OpenApiDocumentInfo = { title: string; version: string };

type JsonSchema = Record<string, unknown>;
type OpenApiObject = Record<string, unknown>;

type DocumentRoute = {
	compiled: CompiledContractRoute;
	path: string;
	middlewareNodes: Array<unknown>;
	errorMode: "opaque" | "detailed";
};

const escapePointer = (value: string): string => value.replace(/~/g, "~0").replace(/\//g, "~1");

const createSchemaRegistry = () => {
	const schemas: Record<string, JsonSchema> = {};
	let count = 0;

	const add = (source: JsonSchema): { $ref: string } => {
		const name = `Schema${++count}`;
		const definitions = isRecordObject(source.$defs) ? source.$defs : {};
		const names = new Map(
			Object.keys(definitions).map((key, index) => [key, `${name}Def${index + 1}`]),
		);
		const rewrite = (value: unknown): unknown => {
			if (Array.isArray(value)) return value.map(rewrite);
			if (!isRecordObject(value)) return value;
			const result: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(value)) {
				if (key === "$schema" || key === "$defs") continue;
				if (key === "$ref" && typeof child === "string" && child.startsWith("#/")) {
					const def = child.match(/^#\/\$defs\/([^/]+)(.*)$/);
					const defName =
						def && names.get(def[1]?.replace(/~1/g, "/").replace(/~0/g, "~") ?? "");
					result[key] = defName
						? `#/components/schemas/${defName}${def?.[2] ?? ""}`
						: `#/components/schemas/${name}${child.slice(1)}`;
				} else {
					result[key] = rewrite(child);
				}
			}
			return result;
		};
		schemas[name] = rewrite(source) as JsonSchema;
		for (const [key, definition] of Object.entries(definitions)) {
			const definitionName = names.get(key);
			if (definitionName && isRecordObject(definition)) {
				schemas[definitionName] = rewrite(definition) as JsonSchema;
			}
		}
		return { $ref: `#/components/schemas/${name}` };
	};
	return { schemas, add };
};

const convertSchema = (
	schema: StandardSchemaV1,
	direction: "input" | "output",
	location: string,
	allowFallback = false,
): JsonSchema | undefined => {
	const standard = schema["~standard"];
	const converter = isRecordObject(standard) ? standard.jsonSchema : undefined;
	const method = isRecordObject(converter) ? converter[direction] : undefined;
	if (typeof method !== "function") {
		if (allowFallback) return undefined;
		throw new Error(
			`Cannot generate OpenAPI schema for ${location}: Standard JSON Schema conversion is unavailable`,
		);
	}
	try {
		const converted: unknown = method({ target: "draft-2020-12" });
		if (!isRecordObject(converted))
			throw new Error("converter did not return a JSON Schema object");
		return converted;
	} catch (error) {
		if (allowFallback) return undefined;
		throw new Error(`Cannot generate OpenAPI schema for ${location}: ${String(error)}`);
	}
};

const superJsonSchema = (payload?: JsonSchema): JsonSchema => ({
	type: "object",
	properties: {
		json: payload ?? {},
		meta: {
			type: "object",
			properties: {
				values: { oneOf: [{ type: "object" }, { type: "array" }] },
				referentialEqualities: { oneOf: [{ type: "object" }, { type: "array" }] },
				v: { type: "integer" },
			},
		},
	},
	required: ["json"],
});

const responseMediaType = (spec: ResponseSpec): string | undefined => {
	switch (spec.type) {
		case "JSON":
		case "SuperJSON":
			return spec.contentType ?? "application/json";
		case "Text":
			return spec.contentType ?? "text/plain";
		case "Blob":
		case "Bytes":
			return spec.contentType ?? "application/octet-stream";
		case "FormData":
			return "multipart/form-data";
		case "Contentless":
			return undefined;
	}
};

const bodyMediaType = (body: NonNullable<ContractMethod["body"]>): string => {
	switch (body.type) {
		case "JSON":
		case "SuperJSON":
			return body.contentType ?? "application/json";
		case "Text":
			return body.contentType ?? "text/plain";
		case "Blob":
			return body.contentType ?? "application/octet-stream";
		case "URLSearchParams":
			return body.contentType ?? "application/x-www-form-urlencoded";
		case "FormData":
			return "multipart/form-data";
	}
};

const documentFromRoutes = (routes: Array<DocumentRoute>, info: OpenApiDocumentInfo): string => {
	const registry = createSchemaRegistry();
	const paths: Record<string, Record<string, unknown>> = {};
	const operationIds = new Set<string>();

	const forSpec = (
		spec: { type: string; schema?: StandardSchemaV1 },
		direction: "input" | "output",
		location: string,
	): JsonSchema => {
		if (spec.type === "SuperJSON") {
			const payload = spec.schema
				? convertSchema(spec.schema, direction, location, true)
				: undefined;
			return registry.add(superJsonSchema(payload ? registry.add(payload) : undefined));
		}
		if (spec.type === "Blob" || spec.type === "Bytes")
			return { type: "string", format: "binary" };
		if (spec.type === "FormData" || spec.type === "URLSearchParams") return { type: "object" };
		if (spec.type === "Text" && spec.schema) {
			return registry.add(convertSchema(spec.schema, direction, location) ?? {});
		}
		if (!spec.schema) return {};
		return registry.add(convertSchema(spec.schema, direction, location) ?? {});
	};

	for (const route of routes) {
		const methodDefinition = route.compiled.methodDefinition;
		const label = `${route.compiled.method.toUpperCase()} ${route.path}`;
		const operation: OpenApiObject = {};
		const metadata = methodDefinition.openapi;
		if (metadata?.summary) operation.summary = metadata.summary;
		if (metadata?.description) operation.description = metadata.description;
		if (metadata?.tags) operation.tags = metadata.tags;
		if (metadata?.operationId) {
			if (operationIds.has(metadata.operationId)) {
				throw new Error(`Duplicate OpenAPI operationId '${metadata.operationId}'`);
			}
			operationIds.add(metadata.operationId);
			operation.operationId = metadata.operationId;
		}

		const parameters: Array<OpenApiObject> = [];
		const pathParamNames = Array.from(
			route.path.matchAll(/\$([a-zA-Z0-9_]+)/g),
			(match) => match[1] ?? "",
		);
		if (pathParamNames.length > 0 && methodDefinition.pathParams) {
			const raw =
				convertSchema(methodDefinition.pathParams, "input", `${label} pathParams`) ?? {};
			const root = registry.add(raw);
			const properties = isRecordObject(raw.properties) ? raw.properties : {};
			for (const name of pathParamNames) {
				parameters.push({
					name,
					in: "path",
					required: true,
					schema:
						properties[name] !== undefined
							? { $ref: `${root.$ref}/properties/${escapePointer(name)}` }
							: { type: "string" },
				});
			}
		}
		for (const [part, spec] of [
			["query", methodDefinition.query],
			["header", methodDefinition.headers],
		] as const) {
			if (!spec) continue;
			if (spec.type === "Standard") {
				const raw = convertSchema(spec.schema, "input", `${label} ${part}`) ?? {};
				const root = registry.add(raw);
				const properties = isRecordObject(raw.properties) ? raw.properties : {};
				const required = Array.isArray(raw.required) ? raw.required : [];
				if (part === "query" && Object.keys(properties).length === 0) {
					parameters.push({
						name: "query",
						in: "querystring",
						required: false,
						content: { "application/x-www-form-urlencoded": { schema: root } },
					});
				}
				for (const name of Object.keys(properties)) {
					parameters.push({
						name,
						in: part,
						required: required.includes(name),
						schema: { $ref: `${root.$ref}/properties/${escapePointer(name)}` },
					});
				}
			} else {
				parameters.push({
					name: part === "query" ? "_zono" : "x-zono-data",
					in: part,
					required: false,
					content: {
						"application/json": { schema: forSpec(spec, "input", `${label} ${part}`) },
					},
				});
			}
		}
		if (parameters.length > 0) operation.parameters = parameters;

		if (methodDefinition.body) {
			operation.requestBody = {
				required: true,
				content: {
					[bodyMediaType(methodDefinition.body)]: {
						schema: forSpec(methodDefinition.body, "input", `${label} body`),
					},
				},
			};
		}

		const byStatus = new Map<number, Array<OpenApiObject>>();
		const addResponse = (status: number, response: OpenApiObject): void => {
			const variants = byStatus.get(status) ?? [];
			variants.push(response);
			byStatus.set(status, variants);
		};
		const fromSpec = (spec: ResponseSpec, location: string, source: string): OpenApiObject => {
			const headers: Record<string, OpenApiObject> = {
				"x-zono-response-type": { schema: { type: "string", const: spec.type } },
				"x-zono-response-source": { schema: { type: "string", const: source } },
			};
			if (spec.type === "SuperJSON") {
				headers["x-zono-superjson"] = { schema: { type: "string", const: "1" } };
			}
			if (spec.headers) {
				headers["x-zono-data-type"] = {
					schema: { type: "string", const: spec.headers.type },
				};
				headers["x-zono-data"] = {
					content: {
						"application/json": {
							schema: forSpec(spec.headers, "output", `${location} headers`),
						},
					},
				};
				if (spec.headers.type === "Standard") {
					const raw =
						convertSchema(spec.headers.schema, "output", `${location} headers`) ?? {};
					const root = registry.add(raw);
					const properties = isRecordObject(raw.properties) ? raw.properties : {};
					for (const name of Object.keys(properties)) {
						headers[name] = {
							schema: { $ref: `${root.$ref}/properties/${escapePointer(name)}` },
						};
					}
				}
			}
			const mediaType = responseMediaType(spec);
			return {
				headers,
				...(mediaType
					? { content: { [mediaType]: { schema: forSpec(spec, "output", location) } } }
					: {}),
			};
		};
		for (const [status, spec] of Object.entries(methodDefinition.responses)) {
			addResponse(Number(status), fromSpec(spec, `${label} response ${status}`, "contract"));
		}
		for (const node of route.middlewareNodes) {
			if (!isRecordObject(node) || !isRecordObject(node.MIDDLEWARE)) continue;
			for (const [middlewareName, definition] of Object.entries(node.MIDDLEWARE)) {
				if (!isRecordObject(definition)) continue;
				for (const [status, spec] of Object.entries(definition)) {
					addResponse(
						Number(status),
						fromSpec(
							spec as ResponseSpec,
							`${label} middleware ${middlewareName} ${status}`,
							"middleware",
						),
					);
				}
			}
		}
		const errorSchema = (message: string): JsonSchema => ({
			type: "object",
			properties: {
				message:
					route.errorMode === "opaque"
						? { type: "string", const: message }
						: { type: "string" },
				...(route.errorMode === "detailed"
					? { issues: { type: "array" }, stack: { type: "string" } }
					: {}),
			},
			required: ["message"],
		});
		for (const [status, message] of [
			...(methodDefinition.pathParams ||
			methodDefinition.query ||
			methodDefinition.headers ||
			methodDefinition.body
				? ([[400, "Invalid request"]] as const)
				: []),
			...(methodDefinition.body?.contentType
				? ([[415, "Unsupported media type"]] as const)
				: []),
			[500, "Internal server error"] as const,
		]) {
			addResponse(status, {
				headers: {
					"x-zono-response-type": { schema: { type: "string", const: "JSON" } },
					"x-zono-response-source": { schema: { type: "string", const: "error" } },
				},
				content: { "application/json": { schema: registry.add(errorSchema(message)) } },
			});
		}
		const responses: Record<string, OpenApiObject> = {};
		for (const [status, variants] of byStatus) {
			const content: Record<string, { schema: unknown }> = {};
			const headers: Record<string, OpenApiObject> = {};
			for (const variant of variants) {
				if (isRecordObject(variant.headers)) {
					for (const [name, value] of Object.entries(variant.headers)) {
						if (!isRecordObject(value)) continue;
						const existing = headers[name];
						if (!existing) {
							headers[name] = value;
						} else if (JSON.stringify(existing) !== JSON.stringify(value)) {
							const previousSchema = isRecordObject(existing.schema)
								? existing.schema
								: undefined;
							const nextSchema = isRecordObject(value.schema)
								? value.schema
								: undefined;
							headers[name] =
								previousSchema && nextSchema
									? {
											schema: {
												oneOf: [
													...(Array.isArray(previousSchema.oneOf)
														? previousSchema.oneOf
														: [previousSchema]),
													nextSchema,
												],
											},
										}
									: { schema: { type: "string" } };
						}
					}
				}
				if (!isRecordObject(variant.content)) continue;
				for (const [mediaType, value] of Object.entries(variant.content)) {
					if (!isRecordObject(value)) continue;
					const existing = content[mediaType];
					content[mediaType] = existing
						? {
								schema: {
									oneOf: [
										...(isRecordObject(existing.schema) &&
										Array.isArray(existing.schema.oneOf)
											? existing.schema.oneOf
											: [existing.schema]),
										value.schema,
									],
								},
							}
						: { schema: value.schema };
				}
			}
			responses[String(status)] = {
				description: `HTTP ${status} response`,
				...(Object.keys(headers).length > 0 ? { headers } : {}),
				...(Object.keys(content).length > 0 ? { content } : {}),
			};
		}
		operation.responses = responses;
		const openApiPath = route.path.replace(/\$([a-zA-Z0-9_]+)/g, "{$1}");
		const pathItem = paths[openApiPath] ?? {};
		pathItem[route.compiled.method] = operation;
		paths[openApiPath] = pathItem;
	}

	return stringify({
		openapi: "3.2.1",
		info,
		paths,
		...(Object.keys(registry.schemas).length > 0
			? { components: { schemas: registry.schemas } }
			: {}),
	});
};

export const generateServerOpenApiYaml = (
	api: AnyApiDefinition,
	info: OpenApiDocumentInfo,
): string => {
	return documentFromRoutes(
		compileContractRoutes(api.contracts).map((compiled) => ({
			compiled,
			path: compiled.pathTemplate,
			middlewareNodes: collectShapePathNodes(api.middlewares, compiled.pathTemplate),
			errorMode: api.errorMode,
		})),
		info,
	);
};

export const generateGatewayOpenApiYaml = <TServices extends GatewayServices>(
	services: TServices,
	info: OpenApiDocumentInfo,
	gatewayMiddlewares?: GatewayMiddlewares<TServices> & MiddlewareTree,
): string => {
	const routes: Array<DocumentRoute> = [];
	for (const [serviceName, service] of Object.entries(services)) {
		const masked = applyGatewayServiceMask(service.mask, service.api.contracts);
		for (const compiled of compileContractRoutes(masked)) {
			const serviceMiddlewares = gatewayMiddlewares?.SHAPE?.[serviceName];
			routes.push({
				compiled,
				path: namespaceGatewayPath(serviceName, compiled.pathTemplate),
				middlewareNodes: [
					...collectShapePathNodes(service.api.middlewares, compiled.pathTemplate),
					gatewayMiddlewares,
					...(serviceMiddlewares
						? collectShapePathNodes(serviceMiddlewares, compiled.pathTemplate)
						: []),
				],
				errorMode: service.api.errorMode,
			});
		}
	}
	return documentFromRoutes(routes, info);
};

const SWAGGER_UI_VERSION = "5.33.0";

export const openApiUiHtml = (yamlPath: string): string => {
	const url = JSON.stringify(yamlPath).replace(/</g, "\\u003c");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swagger UI</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:${url},dom_id:'#swagger-ui',validatorUrl:null})</script></body></html>`;
};

export const registerOpenApiRoutes = (
	app: Hono,
	config: { yamlPath: string; uiPath?: string },
	yaml: string,
): void => {
	app.get(config.yamlPath, async (ctx, next) => {
		if (ctx.req.method !== "GET") return next();
		return new Response(yaml, {
			headers: { "content-type": "application/yaml; charset=utf-8" },
		});
	});
	if (config.uiPath) {
		const html = openApiUiHtml(config.yamlPath);
		app.get(config.uiPath, async (ctx, next) => {
			if (ctx.req.method !== "GET") return next();
			return new Response(html, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		});
	}
};
