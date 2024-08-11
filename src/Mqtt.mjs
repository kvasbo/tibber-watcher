import * as mqtt from "mqtt"
import * as dotenv from "dotenv"

dotenv.config()

const MQTT_HOST = process.env.MQTT_HOST
const MQTT_USER = process.env.MQTT_USER
const MQTT_PASS = process.env.MQTT_PASS

const options = {
  username: MQTT_USER,
  password: MQTT_PASS,
  clientId:
    "tellulf-" +
    Math.random()
      .toString(16)
      .substring(2, 8),
  rejectUnauthorized: false
}

export class MqttClient {
  // Connect to MQTT broker
  constructor() {
    this.log(`${options.clientId} connecting to ${MQTT_HOST}`)
    this.client = mqtt.connect(MQTT_HOST, options)
    this.client
      .on("connect", () => {
        this.log(`${options.clientId} connected to ${MQTT_HOST}`)
      })
      .on("error", error => {
        this.log("MQTT Error", error.message)
      })
  }

  /**
   * Publish a message to the MQTT broker
   * @param topic
   * @param message
   */
  async publish(topic, message) {
    if (message !== null && message !== undefined) {
      this.client.publish(topic, message.toString())
      this.log(`Published to ${topic}`)
    }
  }

  /**
   * Just a central place to log MQTT messages!
   * @param message
   * @param value
   */
  log(message, value = "") {
    const d = new Date()
    const t = d.toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })
    console.info(t, "MQTT " + message, value)
  }
}
