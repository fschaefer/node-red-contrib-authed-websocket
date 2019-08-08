const http = require("http")
const WebSocket = require("ws")
const url = require('url')
const uuidv4 = require('uuid/v4')


function normalizePath(path: string) {
    return "/" + String(path).split(/[/\\]+/).filter(String).join("/")
}

let clientHashMap: any = {}

module.exports = function (RED: any) {

    function AuthedWebsocketInputNode(this: any, config: any) {

        RED.nodes.createNode(this, config)

        const webserver = RED.nodes.getNode(config.webserver)
        const wss = new WebSocket.Server({ noServer: true })

        wss.on("connection", (ws: any, request: any, clientId: string) => {

            clientHashMap[clientId].connection.socket = ws

            ws.on("close", () => {
                delete clientHashMap[clientId]
            })

            ws.on("message", (message: any) => {
                console.log(`Received message ${message} from user ${clientId}`)
                let msg = {
                    "payload": message,
                    "_clientid": clientId,
                }
                try {
                    msg.payload = JSON.parse(message)
                }
                catch(e) {}
                this.send([undefined, msg])
            })
        })

        webserver.server.on('upgrade', (request: any, socket: any, head: any) => {
            const clientId = uuidv4()
            const headers = request.headers
            const parsedUrl = url.parse(request.url)

            let msg: any = {
                "payload": "connect",
                "_clientid": clientId,
                "_headers": headers
            }

            Object.keys(parsedUrl).forEach((prop: string) => {
                if (typeof parsedUrl[prop] == "string") {
                    msg["_" + prop] = (prop == "pathname")
                        ? normalizePath(parsedUrl[prop])
                        : parsedUrl[prop]
                }
            })

            clientHashMap[clientId] = {
                "upgrade":  {
                    "request": request,
                    "socket": socket,
                    "head": head
                },
                "connection": {
                    "socket": undefined
                }
            }

            this.send([msg, undefined])
        })

        this.on('input', (message: any) => {
            let clientId = message._clientid
            if (clientId && clientHashMap[clientId] && clientHashMap[clientId].upgrade) {
                let request = clientHashMap[clientId].upgrade.request
                let socket = clientHashMap[clientId].upgrade.socket
                let head = clientHashMap[clientId].upgrade.head
                if (message.payload == "reject") {
                    socket.destroy()
                    delete clientHashMap[clientId]
                }
                else {
                    wss.handleUpgrade(request, socket, head, (ws: any) => {
                        wss.emit('connection', ws, request, clientId)
                    })
                }
            }
        })
    }

    RED.nodes.registerType("authed-websocket-input-node", AuthedWebsocketInputNode)


    function AuthedWebsocketOutputNode(this: any, config: any) {

        RED.nodes.createNode(this, config)

        this.on('input', (message: any) => {
            let ws
            if (!message) {
                /* no message */
            }
            else if (!clientHashMap[message._clientid]) {
                /* client not in hashmap? */
            }
            else if (!clientHashMap[message._clientid].connection) {
                /* no websocket connection object in hasmap? */
            }
            else if ((ws = clientHashMap[message._clientid].connection.socket) == null) {
                /* no websocket */
            }
            else if (ws.readyState != WebSocket.OPEN) {
                /* not open */
            }
            else {
                let msg = typeof message.payload == "object"
                    ? JSON.stringify(message.payload)
                    : message.payload

                if (message.terminate) {
                    ws.terminate()
                }
                else {
                    ws.send(msg)
                }
            }
        })

    }

    RED.nodes.registerType("authed-websocket-output-node", AuthedWebsocketOutputNode)


    function RemoteWebServerNode(this: any, config: any) {
        RED.nodes.createNode(this, config)
        this.port = config.port

        this.server = http.createServer()
        this.server.listen(this.port)

        this.on("close", () => {
            Object.keys(clientHashMap).forEach((clientId: string) => {
                if (clientHashMap[clientId] && clientHashMap[clientId].connection && clientHashMap[clientId].connection.socket) {
                    clientHashMap[clientId].connection.socket.terminate()
                }
                else if (clientHashMap[clientId] && clientHashMap[clientId].upgrade && clientHashMap[clientId].upgrade.socket) {
                    clientHashMap[clientId].upgrade.socket.destroy()
                }
            })
            this.server.close()
        })
    }

    RED.nodes.registerType("authed-websocket-remote-webserver", RemoteWebServerNode)
}

