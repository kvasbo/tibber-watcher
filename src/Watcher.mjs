import { MqttClient } from "./Mqtt.mjs"
import { Tibber } from "./Tibber.mjs"

console.log("Starting Tibber Watcher")
const mqttClient = new MqttClient()

new Tibber(mqttClient)
