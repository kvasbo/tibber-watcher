import mqtt from 'mqtt';
import * as dotenv from 'dotenv';

dotenv.config();

const MQTT_URL = process.env.MQTT_URL as string;
const MQTT_PORT = process.env.MQTT_PORT as string;
const MQTT_USER = process.env.MQTT_USER as string;
const MQTT_PASS = process.env.MQTT_PASS as string;

const options: mqtt.IClientOptions = {
    host: MQTT_URL,
    port: Number(MQTT_PORT),
    protocol: 'mqtts',
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: 'tellulf-' + Math.random().toString(16).substring(2, 8),
};

export class MqttClient {
    public client: mqtt.MqttClient;

    // Connect to MQTT broker
    constructor() {
        this.client = mqtt.connect(options);
        this.client
            .on('connect', () => {
                this.log(`${options.clientId} connected to ${options.host}`);
                this.client.subscribe('#');
                this.client.publish(
                    'tellulf/poll',
                    'Tellulf is online and polling'
                );
            })
            .on('error', (error) => {
                this.log('MQTT Error', error.message);
            });
    }

    /**
     * Publish a message to the MQTT broker
     * @param topic
     * @param message
     */
    public publish(topic: string, message: string | number | null | undefined) {
        if (message !== null && message !== undefined) {
            this.client.publish(topic, message.toString());
        }
    }

    /**
     * Just a central place to log MQTT messages!
     * @param message
     * @param value
     */
    public log(message: string, value: number | string | undefined = '') {
        const d = new Date();
        const t = d.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });
        console.log(t, 'MQTT ' + message, value);
    }
}
