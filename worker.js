export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.clients = new Map(); // ws -> user
  }

  async fetch(request, env) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      await this.handle(server);

      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("OK");
  }

  async handle(ws) {
    ws.accept();

    ws.onmessage = async (e) => {
      const data = JSON.parse(e.data);

      // JOIN
      if (data.type === "join") {
        this.clients.set(ws, data.user);
        return;
      }

      // TYPING
      if (data.type === "typing") {
        this.broadcast(data, ws);
        return;
      }

      // MESSAGE / AUDIO
      if (["message","audio"].includes(data.type)) {

        const msg = {
          ...data,
          status:"sent",
          time:new Date().toLocaleTimeString().slice(0,5)
        };

        // broadcast ke semua
        this.broadcast(msg);

        // ACK ke sender (delivered)
        ws.send(JSON.stringify({
          type:"ack",
          id:data.id,
          status:"delivered"
        }));

        // simulate read (1 detik)
        setTimeout(()=>{
          ws.send(JSON.stringify({
            type:"ack",
            id:data.id,
            status:"read"
          }));
        },1000);
      }
    };

    ws.onclose = ()=>{
      this.clients.delete(ws);
    };
  }

  broadcast(data, sender=null){
    for (let [client] of this.clients) {
      if (client !== sender) {
        try{
          client.send(JSON.stringify(data));
        }catch{}
      }
    }
  }
}

export default {
  fetch(request, env) {
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};
