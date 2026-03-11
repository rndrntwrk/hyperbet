import WebSocket from "ws";

export class HyperbetStreamClient {
    private ws: WebSocket | null = null;
    public callbacks: Array<(data: any) => void> = [];

    constructor(public url: string) {}

    public connect() {
        this.ws = new WebSocket(this.url);
        
        this.ws.on("message", (data) => {
            try {
                const parsed = JSON.parse(data.toString());
                this.callbacks.forEach(cb => cb(parsed));
            } catch (e) {
                console.error("HyperbetStreamClient parse error:", e);
            }
        });

        this.ws.on("error", (err) => {
            console.error("HyperbetStreamClient ws error:", err);
        });

        this.ws.on("close", () => {
             // Optional auto-reconnect logic could go here
        });
    }

    public subscribe(cb: (data: any) => void) {
        this.callbacks.push(cb);
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
