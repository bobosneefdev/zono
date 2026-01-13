import { io, Socket, SocketOptions } from "socket.io-client";
import z from "zod";
import { ZonoSocket } from "../shared/socket.js";

export class ZonoSocketClient<T extends ZonoSocket = ZonoSocket> {
	readonly definition: T;
	readonly socket: Socket;
	private readonly handlers: Record<string, Map<string, (data: any) => void>> = {};

	constructor(definition: T, options: ZonoSocketClientOptions) {
		this.definition = definition;
		this.socket = io(options.url, options);
		this.socket.onAny(async (event, socket) => {
			const handlers = this.handlers[event];
			if (!handlers || handlers.size === 0) return;
			const schema = this.definition.serverEvents[event];
			if (!schema) return;
			const parsed = await schema.safeParseAsync(socket);
			if (!parsed.success) {
				console.error(`Ignoring invalid "${event}" event data: ${parsed.error}`);
				return;
			}
			for (const [_, handler] of handlers) {
				handler(parsed.data as any);
			}
		});
	}

	emit<K extends keyof T["clientEvents"] & string>(ev: K, data: z.input<T["clientEvents"][K]>) {
		this.socket.emit(ev, data);
	}

	/**
	 * Add a listener for an event from the server
	 * @returns ID of the listener
	 */
	listen<U extends "once" | "on", K extends keyof T["serverEvents"] & string>(
		type: U,
		ev: K,
		fn: (data: z.output<T["serverEvents"][K]>) => void,
	): U extends "once" ? void : string {
		if (type === "once") {
			this.socket.once(ev, fn as any);
			return undefined as any;
		}
		if (!this.handlers[ev]) {
			this.handlers[ev] = new Map();
		}
		const id = crypto.randomUUID();
		this.handlers[ev].set(id, fn);
		return id as any;
	}

	/**
	 * Remove a listener given an ID
	 * @returns true if the listener was removed, false if it was not found
	 * */
	removeHandler(event: keyof T["serverEvents"] & string, id: string) {
		const handlers = this.handlers[event];
		if (!handlers) return false;
		return handlers.delete(id);
	}
}

export type ZonoSocketClientOptions = SocketOptions & {
	url: string;
};
