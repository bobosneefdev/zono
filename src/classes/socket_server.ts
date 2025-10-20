import {
    ServerOptions as SocketIOServerOptions,
    Server as SocketIOServer,
} from "socket.io";
import { Server as Engine } from "@socket.io/bun-engine";
import z from "zod";
import { ZonoSocketDefinition } from "../lib_types.js";

export class ZonoSocketServer<T extends ZonoSocketDefinition = ZonoSocketDefinition> {
    readonly definition: T;
    readonly io: SocketIOServer;
    readonly engine: Engine;
    readonly serverOpts: ZonoSocketServerOptions<T>

    constructor(
        definition: T,
        serverOpts: ZonoSocketServerOptions<T>
    ) {
        this.definition = definition;
        this.serverOpts = serverOpts;
        this.io = new SocketIOServer(serverOpts);
        this.engine = new Engine();
        this.io.bind(this.engine);
        for (const middleware of serverOpts.middleware ?? []) {
            this.io.use(middleware);
        }

        this.io.on("connection", (socket) => {
            socket.onAny((event, data) => {
                const handler = serverOpts.handlers[event];
                if (!handler) return;
                const schema = definition.clientEvents[event];
                if (!schema) return;
                const parsed = schema.safeParse(data);
                if (!parsed.success) {
                    console.error(`Ignoring invalid "${event}" event data: ${parsed.error}`);
                    return;
                }
                handler(parsed.data as any);
            });
        });
    }

    /** Broadcast an event to all connected clients */
    emit<K extends keyof T["serverEvents"] & string>(
        event: K,
        data: z.input<T["serverEvents"][K]>,
    ) {
        this.io.emit(event, data);
    }

}

export type ZonoSocketServerOptions<T extends ZonoSocketDefinition = ZonoSocketDefinition> = Partial<SocketIOServerOptions> & {
    middleware?: Array<Parameters<SocketIOServer["use"]>[0]>;
    handlers: {
        [K in keyof T["clientEvents"]]: (data: z.output<T["clientEvents"][K]>) => void;
    }
};