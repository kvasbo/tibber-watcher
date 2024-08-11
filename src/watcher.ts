import { MqttClient } from './Mqtt';
import { Tibber } from './Tibber';

console.log('Starting Tibber Watcher');
const mqttClient = new MqttClient();
const t = new Tibber(mqttClient);
