import { MqttClient } from './Mqtt';
import { Tibber } from './Tibber';

console.log('Starting Tibber Watcher');

const mqttClient = new MqttClient();
new Tibber(mqttClient);
