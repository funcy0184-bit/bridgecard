import { DurableObject } from "cloudflare:workers";
export declare class GameRoom extends DurableObject {}
export declare function cleanName(raw: unknown, seat: number): string;
