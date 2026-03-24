export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.clients = [];
    this.users = new Map();
    this.subscribers = [];
  }

  async fetch(request, env) {

    const url = new URL(request.url);

    // 🔔 SUBSCRIBE PUSH
    if (request.method === "POST" && url.pathname === "/subscribe") {
      const sub = await request.json();
      this.subscribers.push(sub);
      return new Response("ok");
    }

    // 💬 WEBSOCKET
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      await this.handleSession(server, env);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response("OK");
  }

  async handleSession(ws, env) {
    ws.accept();
    this.clients.push(ws);

    const history = (await this.state.storage.get("messages")) || [];
    history.forEach(m => ws.send(JSON.stringify(m)));

    ws.onmessage = async (e) => {
      let data = JSON.parse(e.data);

      if (data.type === "ping") return;

      if (data.type === "join") {
        this.users.set(ws, data.user);
        this.broadcast({
          type:"system",
          msg:`${data.user} joined`,
          users:this.users.size
        });
        return;
      }

      if (data.type === "typing") {
        this.broadcast(data, ws);
        return;
      }

      if (data.type === "message" || data.type === "image") {

        const msgData = {
          ...data,
          time: new Date().toLocaleTimeString().slice(0,5)
        };

        const history = (await this.state.storage.get("messages")) || [];
        history.push(msgData);
        if (history.length > 100) history.shift();
        await this.state.storage.put("messages", history);

        this.broadcast(msgData);

        // 🔔 PUSH NOTIF
        await this.sendPush(msgData);
      }
    };

    ws.onclose = () => {
      const user = this.users.get(ws);
      this.users.delete(ws);
      this.clients = this.clients.filter(c => c !== ws);

      this.broadcast({
        type:"system",
        msg:`${user} left`,
        users:this.users.size
      });
    };
  }

  broadcast(data, sender=null) {
    this.clients.forEach(c => {
      if (c !== sender) {
        try { c.send(JSON.stringify(data)); } catch {}
      }
    });
  }

  async sendPush(msg) {
    for (let sub of this.subscribers) {
      try {
        await fetch(sub.endpoint, {
          method:"POST",
          headers:{
            "TTL":"60",
            "Content-Type":"application/json"
          },
          body: JSON.stringify({
            title: msg.user,
            body: msg.msg || "📷 Image"
          })
        });
      } catch {}
    }
  }
}

export default {
  fetch(request, env) {
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};
